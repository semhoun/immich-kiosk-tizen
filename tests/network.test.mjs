import test from 'node:test';
import assert from 'node:assert/strict';
import { baseURL, imageURL, request, readLimited } from '../app/network.js';

test('base path normalized as directory with repeated query parameters', () => {
  assert.equal(baseURL('https://kiosk.test/frame?album=a&album=b&password=secret').href, 'https://kiosk.test/frame/?album=a&album=b');
  const base = baseURL('https://kiosk.test/frame');
  assert.equal(imageURL('assets/photo.jpg', base).href, 'https://kiosk.test/frame/assets/photo.jpg');
  for (const url of ['https://other.test/a', '//other.test/a', '../outside.jpg', 'javascript:alert(1)', 'file:///a', 'https://user:secret@kiosk.test/frame/a', '?password=secret']) {
    assert.throws(() => imageURL(url, base), { code: 'SECURITY' });
  }
});

test('request uses header only, rejects redirects and omits ambient credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://kiosk.test/');
    assert.equal(options.headers['X-Api-Key'], 'secret');
    assert.equal(options.redirect, 'error');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response('ok', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  try { assert.equal((await request(new URL('https://kiosk.test'), { password: 'secret' })).type, 'text/html'); }
  finally { globalThis.fetch = original; }
});

test('auth, HTTP failure, opaque network failure and timeout remain distinct', async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [500, 'NETWORK'], [404, 'INCOMPATIBLE']]) {
      globalThis.fetch = async () => new Response('', { status });
      await assert.rejects(request(new URL('https://kiosk.test')), { code });
    }
    globalThis.fetch = async () => { throw new TypeError('secret backend detail'); };
    await assert.rejects(request(new URL('https://kiosk.test')), error => error.code === 'NETWORK' && !error.message.includes('secret'));
    globalThis.fetch = (_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    await assert.rejects(request(new URL('https://kiosk.test'), { timeout: 5 }), { code: 'TIMEOUT' });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(request(new URL('https://kiosk.test'), { signal: controller.signal }), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});

test('streaming body size is bounded even without Content-Length', async () => {
  await assert.rejects(readLimited(new Response('12345'), 4), { code: 'INCOMPATIBLE' });
  await assert.rejects(readLimited(new Response('1', { headers: { 'Content-Length': '100' } }), 4), { code: 'INCOMPATIBLE' });
  assert.equal(new TextDecoder().decode(await readLimited(new Response('1234'), 4)), '1234');
});

test('rejected headers abort unread streams before releasing cancellation ownership', async () => {
  const original = globalThis.fetch;
  let signal;
  let cancelled = false;
  globalThis.fetch = async (_, options) => {
    signal = options.signal;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    signal.addEventListener('abort', () => { body.cancel(); });
    return new Response(body, { status: 500 });
  };
  try {
    await assert.rejects(request(new URL('https://kiosk.test')), { code: 'NETWORK' });
    assert.equal(signal.aborted, true);
    assert.equal(cancelled, true);
  } finally { globalThis.fetch = original; }
  cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readLimited(new Response(body, { headers: { 'Content-Length': '999' } }), 4), { code: 'INCOMPATIBLE' });
  assert.equal(cancelled, true);
});
