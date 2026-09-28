import test from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../app/player.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture(overrides = {}) {
  const timers = new Map();
  const disposed = [];
  const shown = [];
  let sequence = 0;
  let timer = 0;
  const client = { connect: async () => ({}), photo: async () => {
    const id = ++sequence;
    return { url: String(id), dispose: () => disposed.push(id) };
  } };
  const clock = { setTimeout(fn) { timers.set(++timer, fn); return timer; }, clearTimeout(id) { timers.delete(id); } };
  const player = new Player({ client, clock, decode: async photo => photo.url, show: image => shown.push(image), ...overrides });
  return { player, client, timers, disposed, shown, tick: async () => {
    const [id, fn] = timers.entries().next().value;
    timers.delete(id); fn(); await flush();
  } };
}
test('decoded display, one preload, bounded ten-image history and complete disposal', async () => {
  const f = fixture();
  f.player.start(); await flush();
  assert.deepEqual(f.shown, ['1']);
  assert.equal(f.player.preloaded.image, '2');
  for (let i = 0; i < 15; i++) { f.player.next(); await flush(); assert.equal(f.timers.size, 1); }
  assert.equal(f.player.history.length, 10);
  assert.equal(f.disposed.length, 6);
  f.player.previous(); assert.equal(f.shown.at(-1), '15');
  f.player.next(); assert.equal(f.shown.at(-1), '16');
  f.player.stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.disposed.length, 17);
  assert.equal(new Set(f.disposed).size, 17);
});
test('single in-flight request and stale response disposed on stop', async () => {
  let resolve;
  let calls = 0;
  let disposed = 0;
  const f = fixture({ client: { connect: async () => {}, photo: () => { calls++; return new Promise(r => { resolve = r; }); } } });
  f.player.start(); await flush();
  f.player.next(); f.player.next();
  assert.equal(calls, 1);
  f.player.stop();
  resolve({ url: 'late', dispose: () => disposed++ }); await flush();
  assert.equal(disposed, 1); assert.equal(f.shown.length, 0);
});
test('failed decoding never replaces current image and disposes failed photo', async () => {
  const errors = [];
  const f = fixture({ decode: async photo => {
    if (photo.url === '2') throw Object.assign(new Error(), { code: 'IMAGE' });
    return photo.url;
  }, error: error => errors.push(error.code) });
  f.player.start(); await flush();
  assert.deepEqual(f.shown, ['1']); assert.deepEqual(f.disposed, [2]);
  assert.deepEqual(errors, ['IMAGE']); assert.equal(f.timers.size, 0);
  f.player.stop();
});
test('network retries are bounded to three and auth never retries', async () => {
  for (const code of ['NETWORK', 'AUTH']) {
    let calls = 0;
    const f = fixture({ client: { connect: async () => { calls++; throw Object.assign(new Error(), { code }); } } });
    f.player.start(); await flush();
    while (f.timers.size) await f.tick();
    assert.equal(calls, code === 'AUTH' ? 1 : 4);
    f.player.stop();
  }
});
test('pause and background clear timer, background aborts and resumes without overlap', async () => {
  let release;
  let signal;
  let calls = 0;
  const f = fixture({ client: { connect: async () => {}, photo: s => {
    signal = s; calls++;
    return new Promise(resolve => { release = resolve; });
  } } });
  f.player.start(); await flush();
  f.player.suspend(true); assert.equal(signal.aborted, true);
  f.player.suspend(false); assert.equal(calls, 1);
  release({ url: 'old', dispose() {} }); await flush();
  assert.equal(calls, 2); assert.equal(f.shown.length, 0);
  f.player.stop(); release({ url: 'last', dispose() {} }); await flush();
  const g = fixture(); g.player.start(); await flush();
  g.player.pause(); assert.equal(g.timers.size, 0);
  g.player.pause(false); assert.equal(g.timers.size, 1);
  g.player.stop();
});

test('pause cancels a timed transition while a preload is still decoding', async () => {
  let release;
  const f = fixture({ decode: photo => photo.url === '2' ? new Promise(resolve => { release = resolve; }) : Promise.resolve(photo.url) });
  f.player.start(); await flush();
  assert.deepEqual(f.shown, ['1']);
  await f.tick();
  assert.equal(f.player.wantNext, true);
  f.player.pause(true);
  release('2'); await flush();
  assert.deepEqual(f.shown, ['1']);
  assert.equal(f.player.preloaded.image, '2');
  assert.equal(f.timers.size, 0);
  f.player.next();
  assert.deepEqual(f.shown, ['1', '2']);
  assert.equal(f.player.paused, true);
  f.player.stop(); await flush();
});
