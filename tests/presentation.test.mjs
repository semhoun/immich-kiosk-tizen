import test from 'node:test';
import assert from 'node:assert/strict';
import { Presentation } from '../app/presentation.js';

function fixture() {
  const children = [];
  const container = {
    get firstChild() { return children[0] || null; },
    removeChild(node) { children.splice(children.indexOf(node), 1); },
    appendChild(node) { children.push(node); },
  };
  const overlay = { hidden: false };
  const time = { textContent: '' };
  const date = { textContent: '' };
  const timers = new Map();
  let id = 0;
  let current = new Date(2026, 8, 28, 12, 34, 45, 250);
  const clock = {
    setTimeout(fn, delay) { timers.set(++id, { fn, delay }); return id; },
    clearTimeout(timer) { timers.delete(timer); },
  };
  const presentation = new Presentation({ container, overlay, time, date, clock, now: () => current });
  return { presentation, children, overlay, time, date, timers,
    setNow(value) { current = value; },
    tick() {
      const [timer, { fn }] = timers.entries().next().value;
      timers.delete(timer);
      fn();
    },
  };
}

function image() {
  const classes = new Set(['preserved', 'photo-enter']);
  const events = [];
  return {
    classes, events,
    classList: {
      remove(value) { events.push('remove'); classes.delete(value); },
      add(value) { events.push('add'); classes.add(value); },
    },
    get offsetWidth() { events.push('reflow'); return 1920; },
  };
}

test('simple presentation has no overlay, clock or image animation', () => {
  const f = fixture();
  assert.equal(f.overlay.hidden, true);
  f.presentation.start('simple');
  const photo = image();
  f.presentation.show(photo);
  assert.deepEqual(f.children, [photo]);
  assert.deepEqual([...photo.classes], ['preserved']);
  assert.deepEqual(photo.events, ['remove']);
  assert.equal(f.overlay.hidden, true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.time.textContent, '');
});

test('enriched clock uses French text and one timeout aligned to each minute', () => {
  const f = fixture();
  f.presentation.start('enriched');
  assert.equal(f.overlay.hidden, false);
  assert.equal(f.time.textContent, '12:34');
  assert.equal(f.date.textContent, 'lundi 28 septembre 2026');
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 14750);
  f.presentation.start('enriched');
  assert.equal(f.timers.size, 1);
  f.setNow(new Date(2026, 8, 29, 0, 0, 0, 0));
  f.tick();
  assert.equal(f.time.textContent, '00:00');
  assert.equal(f.date.textContent, 'mardi 29 septembre 2026');
  assert.equal(f.timers.size, 1);
  assert.equal([...f.timers.values()][0].delay, 60000);
});

test('enriched replaces only the displayed node and restarts fade on reused history nodes', () => {
  const f = fixture();
  const first = image();
  const second = image();
  f.presentation.start('enriched');
  f.presentation.show(first);
  f.presentation.show(second);
  assert.deepEqual(f.children, [second]);
  f.presentation.show(first);
  assert.deepEqual(f.children, [first]);
  assert.deepEqual(first.events, ['remove', 'reflow', 'add', 'remove', 'reflow', 'add']);
  assert.equal(first.classes.has('preserved'), true);
  f.presentation.start('simple');
  f.presentation.show(first);
  assert.equal(first.classes.has('photo-enter'), false);
  assert.equal(f.timers.size, 0);
});

test('background and stop cancel clock; return refreshes only active enriched mode', () => {
  const f = fixture();
  f.presentation.start('enriched');
  f.presentation.suspend(true);
  assert.equal(f.timers.size, 0);
  f.setNow(new Date(2026, 8, 28, 14, 2));
  f.presentation.suspend(false);
  assert.equal(f.time.textContent, '14:02');
  assert.equal(f.timers.size, 1);
  f.presentation.suspend(false);
  assert.equal(f.timers.size, 1);
  f.presentation.show(image());
  f.presentation.stop();
  assert.equal(f.timers.size, 0);
  assert.equal(f.overlay.hidden, true);
  assert.deepEqual(f.children, []);
  f.presentation.suspend(false);
  f.presentation.show(image());
  assert.equal(f.timers.size, 0);
  assert.deepEqual(f.children, []);
  f.presentation.start('simple');
  f.presentation.suspend(true);
  f.presentation.suspend(false);
  assert.equal(f.timers.size, 0);
});

test('start while hidden defers clock updates until return and rejects full mode', () => {
  const f = fixture();
  f.presentation.suspend(true);
  f.presentation.start('enriched');
  assert.equal(f.timers.size, 0);
  assert.equal(f.time.textContent, '');
  f.presentation.suspend(false);
  assert.equal(f.timers.size, 1);
  assert.throws(() => f.presentation.start('full'), TypeError);
  f.presentation.stop();
});
