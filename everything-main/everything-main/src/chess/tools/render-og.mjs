/**
 * Renders tools/og-image.html to public/og-image.png.
 *
 * Shot at 2× and downsampled, which antialiases the text and board edges
 * better than rendering at 1× does. Playwright and ImageMagick are only
 * needed to regenerate the picture, so neither is a project dependency:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run dev                      # serves the fonts, icon, and pieces
 *   node tools/render-og.mjs [port]
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const port = process.argv[2] || '5173';
const out = new URL('../public/og-image.png', import.meta.url).pathname;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});

page.on('pageerror', (e) => {
  throw e;
});

const response = await page.goto(`http://localhost:${port}/tools/og-image.html`);
if (!response?.ok()) {
  throw new Error(`Dev server not reachable on port ${port} — run \`npm run dev\` first.`);
}

// Fonts and all 20 piece SVGs must be in before the shutter.
await page.waitForFunction(
  () =>
    document.fonts.status === 'loaded' &&
    [...document.images].every((img) => img.complete && img.naturalWidth > 0),
);

await page.locator('.card').screenshot({ path: out });
await browser.close();

execFileSync('sips', ['-z', '630', '1200', out], { stdio: 'ignore' });

// Losslessly re-encode. WhatsApp only builds a preview for images under
// ~300 KB, and the straight capture lands just the wrong side of that.
execFileSync('magick', [
  out,
  '-strip',
  '-define',
  'png:compression-level=9',
  '-define',
  'png:compression-filter=5',
  out,
]);

console.log(`wrote ${out}`);
