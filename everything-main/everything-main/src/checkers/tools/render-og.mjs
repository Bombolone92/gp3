/**
 * Renders tools/og-image.html to public/og-image.png.
 *
 * Shot at 2× and downsampled, which antialiases the text and board edges
 * better than rendering at 1× does. Playwright is only needed to regenerate
 * the picture, so it is not a project dependency:
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run dev                      # serves the fonts and icon
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

// Fonts and the brand icon must be in before the shutter. The board's
// pieces are drawn in CSS (no images to wait on — see tools/og-image.html).
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
// ImageMagick is optional: sips alone still produces a correct, valid PNG,
// just a somewhat larger one, so a missing `magick` binary is not fatal.
try {
  execFileSync('magick', [
    out,
    '-strip',
    '-define',
    'png:compression-level=9',
    '-define',
    'png:compression-filter=5',
    out,
  ]);
} catch (e) {
  console.warn(`magick not available, skipping lossless re-encode (${e.message})`);
}

console.log(`wrote ${out}`);
