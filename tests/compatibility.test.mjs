import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fullscreen surfaces use Chromium 69 physical offsets, not inset shorthand', async () => {
  const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
  for (const selector of ['#viewer', '.modal', '#full-view']) {
    const declarations = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    for (const offset of ['top', 'right', 'bottom', 'left']) assert.ok(declarations.includes(`${offset}: 0;`));
  }
  assert.doesNotMatch(css, /\binset\s*:/);
});

test('widget targets Tizen 5.5 without changing its installed application identity', async () => {
  const xml = await readFile(new URL('../app/config.xml', import.meta.url), 'utf8');
  assert.match(xml, /required_version="5\.5"/);
  assert.match(xml, /id="ImmichKios\.Kiosk" package="ImmichKios"/);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(xml.match(/<widget\b[^>]*\bversion="([^"]+)"/)[1], metadata.version);
});

test('legacy CSS has readable type sizes and flex spacing without modern support', async () => {
  const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
  for (const selector of ['h1', '#clock-time', '#clock-date']) {
    const declarations = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    assert.match(declarations, /font-size: \d+px; font-size: clamp\(/);
  }
  const actions = css.slice(css.indexOf('.actions {')).split('}')[0];
  assert.doesNotMatch(actions, /\bgap:/);
  assert.match(css, /\.actions > button \{ margin: 8px;/);
});
