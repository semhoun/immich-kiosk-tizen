import test from 'node:test';
import assert from 'node:assert/strict';
import { fullURL } from '../app/full.js';

test('Full preserves native layout and repeated filters without local photo overrides', () => {
  const url = fullURL({ url: 'https://kiosk.test/?album=a&album=b&layout=split&show_time=true', mode: 'full' }, 'https://app.test');
  assert.equal(url, 'https://kiosk.test/?album=a&album=b&layout=split&show_time=true');
});

test('Full encodes native password query without mutating clean settings or filters', () => {
  const settings = { url: 'https://kiosk.test/?album=a&album=b', password: 'a+b &?=#é' };
  const url = new URL(fullURL(settings, 'https://app.test'));
  assert.equal(url.searchParams.get('password'), settings.password);
  assert.deepEqual(url.searchParams.getAll('album'), ['a', 'b']);
  assert.equal(url.hash, '');
  assert.equal(settings.url, 'https://kiosk.test/?album=a&album=b');
  const extracted = new URL(fullURL({ url: 'https://kiosk.test/?password=old&password=new' }, 'https://app.test'));
  assert.deepEqual(extracted.searchParams.getAll('password'), ['new']);
});

test('Full refuses unsafe URLs and a same-origin remote document', () => {
  for (const settings of [
    { url: 'https://user:secret@kiosk.test/' },
    { url: 'javascript:alert(1)' },
    { url: 'https://app.test/untrusted' }
  ]) assert.throws(() => fullURL(settings, 'https://app.test'));
});
