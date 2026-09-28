import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('fullscreen surfaces use Chromium 85 physical offsets, not inset shorthand', async () => {
  const css = await readFile(new URL('../app/styles.css', import.meta.url), 'utf8');
  for (const selector of ['#viewer', '.modal', '#full-view']) {
    const declarations = css.slice(css.indexOf(`${selector} {`)).split('}')[0];
    for (const offset of ['top', 'right', 'bottom', 'left']) assert.ok(declarations.includes(`${offset}: 0;`));
  }
  assert.doesNotMatch(css, /\binset\s*:/);
});
