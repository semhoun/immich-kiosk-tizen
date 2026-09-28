import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { testTLS } from './tls.mjs';

const root = await readFile(new URL('./fixtures/root.html', import.meta.url), 'utf8');
const photo = await readFile(new URL('./fixtures/photo.html', import.meta.url), 'utf8');
const png = Buffer.from(photo.match(/base64,([^"]+)/)[1], 'base64');
let mode = 'data';
let stolen = 0;
let assetCalls = 0;
let actualCalls = 0;
let siteCalls = 0;
let preflights = 0;
let lastDevice = '';
const clients = new Set();
function server(handler, tls) {
  const callback = (req, res) => Promise.resolve(handler(req, res)).catch(() => {
    res.writeHead(500); res.end('Test server failure');
  });
  const instance = tls ? createSecureServer(tls, callback) : createServer(callback);
  clients.add(instance);
  return new Promise(resolve => instance.listen(0, '127.0.0.1', () => resolve({ instance, origin: `${tls ? 'https' : 'http'}://127.0.0.1:${instance.address().port}` })));
}
const trap = await server((req, res) => { stolen++; res.end('unexpected request'); });
const kiosk = await server(async (req, res) => {
  const url = new URL(req.url, 'http://test');
  if (url.pathname !== '/site/') assert.equal(url.searchParams.has('password'), false);
  assert.equal(url.searchParams.has('authsecret'), false);
  if (req.method === 'OPTIONS') {
    preflights++;
    assert.equal(req.headers['x-api-key'], undefined);
    if (mode === 'preflight-auth') { res.writeHead(401); res.end(); return; }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.writeHead(204); res.end(); return;
  }
  actualCalls++;
  if (req.headers.origin) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  if (mode === 'auth' || (req.headers['x-api-key'] && req.headers['x-api-key'] !== 'test-secret')) {
    res.writeHead(401, { 'Content-Type': 'text/html' }); res.end('<h1>Unauthorized</h1>'); return;
  }
  if (url.pathname === '/site/') {
    siteCalls++;
    if (mode === 'full-auth' && url.searchParams.get('password') !== 'full +&?#=secret') {
      res.writeHead(401, { 'Content-Type': 'text/html' }); res.end('Unauthorized'); return;
    }
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers.referer, undefined);
    assert.deepEqual(url.searchParams.getAll('album'), ['one', 'two']);
    assert.equal(url.searchParams.get('layout'), 'split');
    res.setHeader('Content-Type', 'text/html');
    if (mode === 'frame-denied') res.setHeader('X-Frame-Options', 'DENY');
    res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="native-site">Présentation Kiosk originale</h1><script>document.body.dataset.executed="yes";try{parent.document.body.dataset.compromised="yes"}catch(e){document.body.dataset.isolated="yes"}</script></body></html>');
    return;
  }
  if (url.pathname === '/base/') {
    res.setHeader('Content-Type', 'text/html'); res.end(root); return;
  }
  if (url.pathname === '/base/asset/new') {
    assetCalls++;
    assert.equal(req.method, 'POST');
    let body = '';
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);
    assert.deepEqual(params.getAll('album'), ['one', 'two']);
    assert.equal(params.has('password'), false);
    assert.equal(params.get('show_videos'), 'false');
    assert.equal(params.get('layout'), 'single');
    assert.ok(req.headers['kiosk-device-id']);
    lastDevice = req.headers['kiosk-device-id'];
    res.setHeader('Content-Type', 'text/html');
    if (mode === 'empty') { res.end('<div class="frame frame-error">No photos or upstream error</div>'); return; }
    if (mode === 'video') { res.end('<div class="frame"><video src="/video?password=never-follow"></video></div>'); return; }
    if (mode === 'no-content') { res.writeHead(204); res.end(); return; }
    if (mode === 'slow') { setTimeout(() => res.end(photo), 300); return; }
    if (mode === 'data') { res.end(photo); return; }
    const src = mode === 'external' ? `${trap.origin}/steal` : mode === 'redirect' ? 'redirect' : 'image/test.png';
    res.end(`<div class="frame"><div class="frame--image"><img src="${src}"></div></div>`); return;
  }
  if (url.pathname === '/base/redirect') { res.writeHead(302, { Location: `${trap.origin}/steal` }); res.end(); return; }
  if (url.pathname === '/base/image/test.png') {
    if (mode === 'protected') assert.equal(req.headers['x-api-key'], 'test-secret');
    res.setHeader('Content-Type', 'image/png'); res.end(mode === 'broken' ? Buffer.from('bad bytes') : png); return;
  }
  res.writeHead(404); res.end();
});
const app = await server(async (req, res) => {
  const path = new URL(req.url, 'http://app').pathname;
  if (path === '/harness') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Adapter tests</title>'); return; }
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!/^[\w.-]+$/.test(file)) { res.writeHead(404); res.end(); return; }
  try {
    const content = await readFile(new URL(`../dist/${file}`, import.meta.url));
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html');
    // Mask the unsupported global in application modules, not in Playwright's
    // own runtime, which requires it even when evaluating a test expression.
    const classic = file === 'main.js' || file === 'startup.js';
    res.end(file.endsWith('.js') ? (classic ? '(function () { const globalThis = undefined;\n' + content + '\n})();' : 'const globalThis = undefined;\n' + content) : content);
  } catch (_) { res.writeHead(404); res.end(); }
});
let browser;
let tls;
try {
  tls = await testTLS();
  const secureKiosk = await server(kiosk.instance.listeners('request')[0], tls.trusted);
  const untrustedKiosk = await server(kiosk.instance.listeners('request')[0], tls.untrusted);
  browser = await chromium.launch({ headless: true, env: { ...process.env, HOME: tls.home } });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.origin}/harness`);
  await page.evaluate(async () => { window.adapter = await import('/kiosk.js'); });
  const makeClient = async (password = '', origin = kiosk.origin) => page.evaluate(({ url, password }) => {
    window.client = new window.adapter.KioskClient({ url, password });
  }, { url: `${origin}/base?album=one&album=two`, password });
  const load = () => page.evaluate(async () => {
    try {
      await window.client.connect();
      const image = await window.client.photo();
      try { const decoded = new Image(); decoded.src = image.url; await decoded.decode(); }
      finally { image.dispose(); }
      return 'OK';
    } catch (error) { return error.code || error.name; }
  });

  const parsed = await page.evaluate(({ root, photo, trap }) => {
    const { parseMetadata, parsePhoto } = window.adapter;
    const malicious = `<script>window.compromised=true</script><iframe src="${trap}/frame"></iframe><img src="${trap}/image" onerror="window.compromised=true">`;
    const source = parsePhoto(photo + malicious);
    const version = parseMetadata(root + malicious).version;
    const codes = [];
    for (const html of ['', '<div class="frame"></div>', '<div class="frame frame-error">x</div>', '<video></video>']) {
      try { parsePhoto(html); } catch (error) { codes.push(error.code); }
    }
    let unsupported;
    try { parseMetadata(root.replace(/v0\.44\.1/g, 'v99.0.0')); } catch (error) { unsupported = error.code; }
    return { source, version, codes, unsupported, compromised: Boolean(window.compromised) };
  }, { root, photo, trap: trap.origin });
  assert.ok(parsed.source.startsWith('data:image/png;'));
  assert.equal(parsed.version, 'v0.44.1');
  assert.equal(parsed.compromised, false);
  assert.deepEqual(parsed.codes, Array(4).fill('INCOMPATIBLE'));
  assert.equal(parsed.unsupported, 'INCOMPATIBLE');
  assert.equal(stolen, 0);
  console.log('PASS inert parsing, exact contract and malicious markup');

  for (const password of ['', 'test-secret']) {
    mode = 'data';
    await makeClient(password);
    assert.equal(await load(), 'OK');
  }
  const previousDevice = lastDevice;
  mode = 'protected';
  await makeClient('test-secret');
  assert.equal(await load(), 'OK');
  assert.notEqual(lastDevice, previousDevice);
  assert.ok(preflights > 0);
  console.log('PASS HTTP with/without password, base path, repeated filters, protected images and device isolation');

  for (const password of ['', 'test-secret']) {
    mode = 'data';
    await makeClient(password, secureKiosk.origin);
    assert.equal(await load(), 'OK', 'trusted HTTPS');
  }
  await makeClient('test-secret', untrustedKiosk.origin);
  assert.equal(await load(), 'NETWORK', 'untrusted certificate must fail');
  for (const origin of [kiosk.origin, secureKiosk.origin]) {
    await makeClient('wrong-secret', origin);
    assert.equal(await load(), 'AUTH', 'observable invalid password');
  }
  mode = 'protected';
  await makeClient('test-secret', secureKiosk.origin);
  assert.equal(await load(), 'OK', 'protected image over HTTPS');
  console.log('PASS HTTPS with/without password and rejection of untrusted TLS, without bypass');

  for (const [scenario, expected] of [['external', 'SECURITY'], ['redirect', 'NETWORK'], ['broken', 'IMAGE'], ['video', 'INCOMPATIBLE'], ['empty', 'INCOMPATIBLE'], ['no-content', 'INCOMPATIBLE'], ['auth', 'AUTH']]) {
    mode = scenario;
    await makeClient('test-secret');
    assert.equal(await load(), expected, scenario);
  }
  assert.equal(stolen, 0);
  console.log('PASS third-origin/redirect secret isolation and explicit error classes');

  // A fresh browser context avoids a successful earlier preflight cache entry.
  const blocked = await browser.newContext();
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(`${app.origin}/harness`);
  mode = 'preflight-auth';
  const before = assetCalls;
  const blockedCode = await blockedPage.evaluate(async url => {
    const { KioskClient } = await import('/kiosk.js');
    try { await new KioskClient({ url, password: 'test-secret' }).connect(); }
    catch (error) { return error.code; }
  }, `${kiosk.origin}/base/?album=one&album=two`);
  assert.equal(blockedCode, 'NETWORK');
  assert.equal(assetCalls, before);
  await blocked.close();
  console.log('PASS simulated upstream auth-before-CORS failure without unsafe workaround');

  mode = 'slow';
  await makeClient();
  assert.equal(await page.evaluate(async () => {
    await window.client.connect();
    const abort = new AbortController();
    const pending = window.client.photo(abort.signal);
    abort.abort();
    try { await pending; } catch (error) { return error.name; }
  }), 'AbortError');
  console.log('PASS cancellation');

  mode = 'data';
  await page.goto(app.origin);
  await page.locator('#url-activate').waitFor();
  await page.locator('#mode:focus').waitFor();
  const logo = await page.locator('#app-logo').evaluate(async image => { await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; });
  assert.deepEqual(logo, { width: 483, height: 483 });
  const icon = await readFile(new URL('../app/icon.png', import.meta.url));
  assert.equal(icon.readUInt32BE(16), 117);
  assert.equal(icon.readUInt32BE(20), 117);
  const manifest = await readFile(new URL('../app/config.xml', import.meta.url), 'utf8');
  const version = manifest.match(/<widget\b[^>]*\bversion="([^"]+)"/)[1];
  assert.equal(await page.locator('#app-version').textContent(), `Version ${version}`);
  assert.equal(await page.locator('#app-version').isVisible(), true);
  assert.equal(await page.locator('script[src="main.js"][type="module"]').count(), 0);
  assert.equal(await page.locator('#startup-status').isVisible(), false);
  assert.equal(await page.locator('#show-password').isChecked(), false);
  const remote = code => page.evaluate(code => {
    const event = new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: code, which: code, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event.defaultPrevented;
  }, code);
  await remote(39);
  assert.equal(await page.locator('#mode').inputValue(), 'simple');
  await remote(37);
  assert.equal(await page.locator('#mode').inputValue(), 'simple');
  await remote(13);
  assert.equal(await page.locator('#mode').inputValue(), 'enriched');
  await remote(13);
  assert.equal(await page.locator('#mode').inputValue(), 'full');
  assert.equal(await page.locator('#local-options').isVisible(), false);
  assert.equal(await page.locator('#start').isVisible(), false);
  await remote(13);
  assert.equal(await page.locator('#mode').inputValue(), 'simple');
  assert.equal(await page.locator('#local-options').isVisible(), true);
  assert.equal(await page.locator('#start').isVisible(), true);
  const initialViewport = page.viewportSize();
  for (const width of [1920, 720]) {
    await page.setViewportSize({ width, height: 1080 });
    const rememberBox = await page.locator('#remember').boundingBox();
    const revealBox = await page.locator('#show-password').boundingBox();
    assert.ok(Math.abs(rememberBox.y - revealBox.y) < 1);
    assert.ok(revealBox.x > rememberBox.x);
    await page.locator('#remember').focus();
    await remote(39);
    assert.equal(await page.locator('#show-password').evaluate(el => el === document.activeElement), true);
    await remote(37);
    assert.equal(await page.locator('#remember').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#remember').isChecked(), false);
    assert.equal(await page.locator('#show-password').isChecked(), false);
    await page.locator('#connect').focus();
    await remote(39);
    assert.equal(await page.locator('#start').evaluate(el => el === document.activeElement), true);
    await remote(39);
    assert.equal(await page.locator('#clear').evaluate(el => el === document.activeElement), true);
    await remote(39);
    assert.equal(await page.locator('#clear').evaluate(el => el === document.activeElement), true);
    await remote(37);
    await remote(37);
    assert.equal(await page.locator('#connect').evaluate(el => el === document.activeElement), true);
    await remote(37);
    assert.equal(await page.locator('#connect').evaluate(el => el === document.activeElement), true);
    await page.locator('#duration').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#fit').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#duration').inputValue(), '15');
    assert.equal(await page.locator('#fit').inputValue(), 'contain');
    await remote(13);
    assert.equal(await page.locator('#fit').inputValue(), 'cover');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#duration').evaluate(el => el === document.activeElement), true);
    assert.equal(await page.locator('#duration').inputValue(), '15');
    await remote(13);
    assert.equal(await page.locator('#duration').inputValue(), '30');
    await page.locator('#mode').selectOption('full');
    assert.equal(await page.locator('label[for="duration"]').isVisible(), false);
    assert.equal(await page.locator('label[for="fit"]').isVisible(), false);
    await page.locator('#connect').focus();
    await remote(39);
    assert.equal(await page.locator('#clear').evaluate(el => el === document.activeElement), true);
    await remote(37);
    assert.equal(await page.locator('#connect').evaluate(el => el === document.activeElement), true);
    await page.locator('#mode').selectOption('simple');
    assert.equal(await page.locator('#duration').inputValue(), '30');
    assert.equal(await page.locator('#fit').inputValue(), 'cover');
    await page.locator('#duration').selectOption('15');
    await page.locator('#fit').selectOption('contain');
  }
  await page.setViewportSize(initialViewport);
  await page.locator('#mode').focus();
  console.log('PASS horizontal button/option navigation, OK-only changes, Full hidden controls and retained settings');
  await remote(40);
  assert.equal(await page.locator('#url-activate').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#url').isVisible(), false);
  await remote(40);
  assert.equal(await page.locator('#password-activate').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#password').isVisible(), false);
  await remote(38);
  assert.equal(await page.locator('#url-activate').evaluate(el => el === document.activeElement), true);
  await remote(13);
  assert.equal(await page.locator('#url').evaluate(el => el === document.activeElement && !el.readOnly), true);
  assert.equal(await remote(13), false, 'Native IME Enter must not be cancelled');
  await page.locator('#url').pressSequentially('https://typed.invalid/');
  assert.equal(await page.locator('#url').inputValue(), 'https://typed.invalid/');
  assert.equal(await remote(37), false, 'Text cursor movement belongs to the IME');
  await remote(65376);
  assert.equal(await page.locator('#url-activate').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#url').isVisible(), false);
  assert.equal(await page.locator('#url-activate').textContent(), 'https://typed.invalid/');
  await remote(40);
  await remote(13);
  await page.locator('#password').pressSequentially('temporary');
  assert.equal(await page.locator('#password').inputValue(), 'temporary');
  assert.equal(await remote(38), false);
  assert.equal(await page.locator('#url-activate').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#password').isVisible(), false);
  assert.equal(await page.locator('#password-activate').textContent(), '********');
  assert.equal(await page.locator('#password').inputValue(), 'temporary');
  await page.locator('#show-password').focus();
  await remote(13);
  assert.equal(await page.locator('#show-password').isChecked(), true);
  assert.equal(await page.locator('#password-activate').textContent(), 'temporary');
  assert.equal(await page.locator('#password').getAttribute('type'), 'text');
  assert.equal(await page.locator('#password').isVisible(), false);
  await page.locator('#password-activate').click();
  assert.equal(await page.locator('#password').evaluate(el => el === document.activeElement && el.type === 'text'), true);
  await remote(65376);
  await page.locator('#show-password').focus();
  await remote(13);
  assert.equal(await page.locator('#password-activate').textContent(), '********');
  assert.equal(await page.locator('#password').getAttribute('type'), 'password');
  await page.locator('#show-password').check();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('#show-password').isChecked(), false);
  assert.equal(await page.locator('#password-activate').textContent(), '********');
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  await page.locator('#url-activate').focus();
  console.log('PASS explicit password visibility, remote toggle, editing and automatic background masking');
  await remote(40);
  assert.equal(await page.locator('#password-activate').evaluate(el => el === document.activeElement), true);
  await remote(13);
  assert.equal(await page.locator('#password').evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Unidentified', keyCode: 38, isComposing: true, bubbles: true, cancelable: true
  })));
  assert.equal(await page.locator('#password').evaluate(el => el === document.activeElement), true);
  await remote(40);
  assert.equal(await page.locator('#remember').evaluate(el => el === document.activeElement), true);
  await remote(38);
  assert.equal(await page.locator('#password-activate').evaluate(el => el === document.activeElement), true);
  await remote(13);
  assert.equal(await page.locator('#password').evaluate(el => el === document.activeElement), true);
  await page.locator('#password').fill('');
  await remote(65385);
  assert.equal(await page.locator('#modal').isVisible(), false);
  assert.equal(await page.locator('#password-activate').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#password').isVisible(), false);
  await page.locator('#remember').focus();
  await remote(13);
  assert.equal(await page.locator('#remember').isChecked(), true);
  await remote(13);
  assert.equal(await page.locator('#remember').isChecked(), false);
  await page.locator('#clear').focus();
  await remote(13);
  await page.locator('#modal:not([hidden])').waitFor();
  await remote(13);
  assert.equal(await page.locator('#modal').isVisible(), false);
  await page.locator('#mode').focus();
  console.log('PASS classic startup, numeric navigation without IME, explicit OK/click editing and Done/Cancel');
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'url-activate');
  await page.locator('#url-activate').click();
  await page.locator('#url').fill(`${kiosk.origin}/base?album=one&album=two&password=test-secret`);
  await page.keyboard.press('Enter');
  const beforeConfirmation = actualCalls;
  await page.locator('#start').click();
  await page.locator('#modal:not([hidden])').waitFor();
  assert.equal(actualCalls, beforeConfirmation);
  assert.equal((await page.locator('#url').inputValue()).includes('password'), false);
  await page.locator('#cancel').click();
  assert.equal(actualCalls, beforeConfirmation);
  await page.locator('#start').click();
  await page.locator('#confirm').click();
  await page.locator('#photo img').waitFor();
  assert.equal(await page.locator('#photo-overlay').isVisible(), false);
  assert.equal(await page.locator('#photo img').evaluate(el => el.classList.contains('photo-enter')), false);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('test-secret')), false);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#viewer').evaluate(el => el.classList.contains('paused')), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#viewer').evaluate(el => el.classList.contains('paused')), false);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.locator('#settings:not([hidden])').waitFor();
  await page.locator('#remember').check();
  await page.locator('#show-password').check();
  assert.equal(await page.locator('#password-activate').textContent(), 'test-secret');
  await page.locator('#connect').click();
  await page.locator('#message').filter({ hasText: 'réussie' }).waitFor();
  assert.equal(await page.locator('#show-password').isChecked(), false);
  assert.equal(await page.locator('#password-activate').textContent(), '********');
  assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('immich-kiosk-tizen.settings.v1'))).some(key => /show|visible/i.test(key))), false);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('test-secret')), true);
  await page.locator('#remember').uncheck();
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('test-secret')), false);
  await page.locator('#clear').click();
  await page.locator('#confirm').click();
  assert.equal(await page.locator('#url').inputValue(), '');
  assert.equal(await page.locator('#password').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  await page.keyboard.press('Escape');
  await page.locator('#modal:not([hidden])').waitFor();
  await page.locator('#cancel').click();
  await mkdir('artifacts', { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: 'artifacts/settings-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/settings-mobile.png', fullPage: true });
  console.log('PASS UI remote keys, HTTP confirmation, decoded slideshow, secret removal, clear and responsive layout');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('#url-activate').click();
  await page.locator('#url').fill(`${kiosk.origin}/base?album=one&album=two`);
  await page.keyboard.press('Enter');
  await page.locator('#mode').selectOption('enriched');
  await page.locator('#start').click();
  await page.locator('#photo img.photo-enter').waitFor();
  assert.equal(await page.locator('#photo-overlay').isVisible(), true);
  assert.match(await page.locator('#clock-time').textContent(), /\d{2}:\d{2}/);
  assert.ok((await page.locator('#clock-date').textContent()).length > 5);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('immich-kiosk-tizen.settings.v1')).mode), 'enriched');
  await page.screenshot({ path: 'artifacts/enriched-desktop.png' });
  await page.reload();
  await page.locator('#photo img.photo-enter').waitFor();
  await page.keyboard.press('ArrowUp');
  await page.locator('#settings:not([hidden])').waitFor();
  assert.equal(await page.locator('#mode').inputValue(), 'enriched');
  await page.locator('#mode').selectOption('simple');
  await page.locator('#start').click();
  await page.locator('#photo img').waitFor();
  assert.equal(await page.locator('#photo-overlay').isVisible(), false);
  await page.keyboard.press('Escape');
  console.log('PASS Simple/Enriched switch, localized clock/date, fade and persisted mode');

  await page.locator('#mode').selectOption('full');
  assert.equal(await page.locator('#duration').isDisabled(), true);
  assert.equal(await page.locator('#fit').isDisabled(), true);
  assert.equal(await page.locator('#local-options').isVisible(), false);
  assert.equal(await page.locator('#start').isVisible(), false);
  assert.equal(await page.locator('#connect').textContent(), 'Ouvrir le site Full');
  assert.doesNotMatch(await page.locator('#mode-help').textContent(), /expérimental|non garanti/i);
  assert.doesNotMatch(await page.locator('#mode option[value="full"]').textContent(), /expérimental/i);
  await page.locator('#url-activate').click();
  await page.locator('#url').fill(`${kiosk.origin}/site/?album=one&album=two&layout=split`);
  await page.keyboard.press('Enter');
  const beforeFull = assetCalls;
  await page.locator('#connect').click();
  await page.locator('#modal:not([hidden])').waitFor();
  assert.equal(siteCalls, 0);
  await page.locator('#cancel').click();
  assert.equal(siteCalls, 0);
  await page.locator('#connect').click();
  await page.locator('#confirm').click();
  const native = page.frameLocator('#full-frame iframe');
  await native.locator('body[data-executed="yes"][data-isolated="yes"]').waitFor();
  assert.equal(await page.locator('#app-version').isVisible(), false);
  assert.equal(assetCalls, beforeFull);
  assert.equal(await page.locator('#full-frame iframe').getAttribute('tabindex'), '-1');
  assert.equal(await page.locator('#full-frame iframe').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  assert.equal(await page.locator('body').getAttribute('data-compromised'), null);
  assert.equal(await page.locator('#full-view').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#full-view button, #full-info, .full-toolbar').count(), 0);
  assert.deepEqual(await page.locator('#full-frame iframe').boundingBox(), { x: 0, y: 0, width: 1920, height: 1080 });
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#full-view').evaluate(el => el === document.activeElement), true);
  await page.screenshot({ path: 'artifacts/full-desktop.png' });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('#full-frame iframe').count(), 0);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await native.locator('#native-site').waitFor();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#full-frame iframe').count(), 0);
  await page.locator('#settings:not([hidden])').waitFor();
  mode = 'frame-denied';
  await page.locator('#connect').click();
  await page.locator('#confirm').click();
  await page.locator('#full-view:focus').waitFor();
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.locator('#full-frame iframe').count(), 0);
  console.log('PASS Full consent, native layout, isolated frame, background cleanup and Return');

  mode = 'full-auth';
  for (const origin of [kiosk.origin, secureKiosk.origin]) {
    await page.locator('#url-activate').click();
    await page.locator('#url').fill(`${origin}/site/?album=one&album=two&layout=split&password=${encodeURIComponent('full +&?#=secret')}`);
    await page.keyboard.press('Enter');
    const beforeConsent = siteCalls;
    await page.locator('#connect').click();
    await page.locator('#modal:not([hidden])').waitFor();
    assert.match(await page.locator('#modal-text').textContent(), /journaux/);
    assert.doesNotMatch(await page.locator('#modal-text').textContent(), /full \+|Chromium 106|Tizen 6\.5/);
    if (origin.startsWith('http:')) assert.match(await page.locator('#modal-text').textContent(), /HTTP n’est pas chiffré/);
    assert.equal((await page.locator('#url').inputValue()).includes('password='), false);
    assert.equal(siteCalls, beforeConsent);
    await page.locator('#cancel').click();
    assert.equal(siteCalls, beforeConsent);
    await page.locator('#connect').click();
    await page.locator('#confirm').click();
    await native.locator('#native-site').waitFor();
    const address = new URL(await page.locator('#full-frame iframe').getAttribute('src'));
    assert.equal(address.searchParams.get('password'), 'full +&?#=secret');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('immich-kiosk-tizen.settings.v1')));
    assert.equal(new URL(stored.url).searchParams.has('password'), false);
    assert.equal(stored.password, '');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('#full-frame iframe').count(), 0);
  }
  console.log('PASS Full password URL authentication over HTTP/HTTPS after consent, encoding and clean persistence');
  await page.locator('#remember').check();
  await page.locator('#connect').click();
  await page.locator('#confirm').click();
  await native.locator('#native-site').waitFor();
  await page.reload();
  await native.locator('#native-site').waitFor();
  assert.equal(await page.locator('#modal').isVisible(), false);
  assert.equal(await page.locator('#full-view').isVisible(), true);
  assert.equal(new URL(await page.locator('#full-frame iframe').getAttribute('src')).searchParams.get('password'), 'full +&?#=secret');
  await page.keyboard.press('ArrowUp');
  await page.locator('#url-activate').click();
  await page.locator('#url').fill(`${kiosk.origin}/site/?album=one&album=two&layout=split`);
  await page.keyboard.press('Enter');
  await page.locator('#connect').click();
  await page.locator('#confirm').click();
  await native.locator('#native-site').waitFor();
  const beforeAutoHTTP = siteCalls;
  await page.reload();
  await page.locator('#modal:not([hidden])').waitFor();
  assert.match(await page.locator('#modal-text').textContent(), /HTTP n’est pas chiffré/);
  assert.equal(siteCalls, beforeAutoHTTP);
  await page.locator('#cancel').click();
  assert.equal(await page.locator('#full-frame iframe').count(), 0);
  console.log('PASS Full automatic HTTPS startup with remembered password, keeping HTTP secret confirmation');
  console.log('Browser validation uses container Chromium with globalThis masked in app modules, NOT Tizen 5.5/Chromium 69 hardware.');
} finally {
  if (browser) await browser.close();
  for (const instance of clients) {
    instance.closeAllConnections();
    await new Promise(resolve => instance.close(resolve));
  }
  if (tls) await tls.cleanup();
}
