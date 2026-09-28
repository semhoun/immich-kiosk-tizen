import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile('app/icon.svg');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1 });
  await page.setContent('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:">' +
    `<img id="icon" width="117" height="117" src="data:image/svg+xml;base64,${svg.toString('base64')}">`);
  await page.locator('#icon').evaluate(image => image.decode());
  await page.locator('#icon').screenshot({ path: 'app/icon.png', omitBackground: true });
  console.log('Rendered app/icon.png (117 x 117) from the upstream SVG.');
} finally {
  await browser.close();
}
