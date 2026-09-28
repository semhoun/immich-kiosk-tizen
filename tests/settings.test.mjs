import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, loadSettings, saveSettings, forgetPassword, clearSettings } from '../app/settings.js';

function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key), data };
}

test('preserves base paths and repeated filters; extracts password without persisting it', () => {
  const settings = normalizeSettings({ url: 'https://example.test/kiosk/?album=a&album=b&password=secret#ignored' });
  assert.equal(settings.url, 'https://example.test/kiosk/?album=a&album=b');
  assert.equal(settings.password, 'secret');
  assert.equal(settings.duration, 15);
  const store = storage();
  saveSettings(store, settings);
  assert.equal(JSON.stringify([...store.data.values()]).includes('secret'), false);
  assert.equal(loadSettings(store).password, '');
});

test('password persistence is opt-in and immediately revocable', () => {
  const store = storage();
  const settings = normalizeSettings({ url: 'http://example.test', password: 'secret', remember: true });
  saveSettings(store, settings);
  assert.equal(loadSettings(store).password, 'secret');
  forgetPassword(store);
  assert.equal(loadSettings(store).password, '');
  assert.equal(loadSettings(store).remember, false);
  clearSettings(store);
  assert.equal(loadSettings(store), null);
});

test('rejects dangerous URLs, embedded credentials and bad duration', () => {
  for (const url of ['javascript:alert(1)', 'file:///a', 'https://user:secret@example.test', 'nonsense']) {
    assert.throws(() => normalizeSettings({ url }));
  }
  for (const duration of [0, -1, 2, 1.5, 3601, 'bad']) {
    assert.throws(() => normalizeSettings({ url: 'https://example.test', duration }));
  }
});

test('corrupt storage and persisted query secrets are handled safely', () => {
  const store = storage();
  store.setItem('immich-kiosk-tizen.settings.v1', '{');
  assert.equal(loadSettings(store), null);
  store.setItem('immich-kiosk-tizen.settings.v1', JSON.stringify({ url: 'https://example.test/?password=old', remember: false }));
  assert.equal(loadSettings(store).password, '');
  assert.equal(loadSettings(store).url.includes('password'), false);
});

test('presentation mode persists and older settings default to simple', () => {
  const store = storage();
  for (const mode of ['simple', 'enriched', 'full']) {
    saveSettings(store, { url: 'https://example.test', mode });
    assert.equal(loadSettings(store).mode, mode);
  }
  assert.equal(normalizeSettings({ url: 'https://example.test' }).mode, 'simple');
  assert.equal(normalizeSettings({ url: 'https://example.test', mode: '<script>' }).mode, 'simple');
});
