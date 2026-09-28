import test from 'node:test';
import assert from 'node:assert/strict';
import { dataImage, photoParams } from '../app/kiosk.js';

test('photo-only form preserves repeated filters and excludes passwords', () => {
  const params = photoParams({ url: 'https://example.test/base/?album=a&album=b&show_videos=true&password=secret' });
  assert.deepEqual(params.getAll('album'), ['a', 'b']);
  assert.equal(params.has('password'), false);
  assert.equal(params.get('show_videos'), 'false');
  assert.equal(params.get('show_animated_gifs'), 'false');
  assert.equal(params.get('live_photos'), 'false');
  assert.equal(params.get('layout'), 'single');
  assert.equal(params.get('client_width'), '1920');
});

test('data photo rejects SVG, GIF, misleading MIME, malformed and oversize input', () => {
  for (const source of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/gif;base64,R0lGODlh', 'data:image/jpeg;base64,PHN2Zz4=', 'data:image/jpeg;base64,?', 'data:image/png;base64,' + 'A'.repeat(24 * 1024 * 1024)]) {
    assert.throws(() => dataImage(source), { code: 'IMAGE' });
  }
  assert.equal(dataImage('data:image/jpeg;base64,/9j/').type, 'image/jpeg');
});
