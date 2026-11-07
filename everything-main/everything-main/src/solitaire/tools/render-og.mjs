/**
 * Renders tools/og-image.html to public/og-image.png.
 *
 * Shot at 2x and downsampled, which antialiases the text, card edges, and
 * felt gradient better than rendering at 1x does. Playwright is only needed
 * to regenerate the picture, so it is not a project dependency:
 *
 *   npm i --no-save playwright sharp
 *   npx playwright install chromium
 *   npm run dev                      # serves the icons and the vendored deck
 *   node tools/render-og.mjs [port]
 */
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const port = process.argv[2] || '5173';
const out = new URL('../public/og-image.png', import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});

page.on('pageerror', e => {
  throw e;
});

const response = await page.goto(`http://localhost:${port}/tools/og-image.html`);
if (!response?.ok()) {
  throw new Error(`Dev server not reachable on port ${port} — run \`npm run dev\` first.`);
}

// Wait for the mini-board script to finish building the DOM, the brand icon
// to load, and every card face's data-URI <img> to actually finish
// decoding -- data URIs never hit the network, but decode() is still async,
// and drawing/painting an undecoded image is silently blank.
await page.waitForFunction(() => document.body.dataset.sceneBuilt === 'true');
await page.waitForFunction(
  () =>
    document.fonts.status === 'loaded' &&
    [...document.images, ...document.querySelectorAll('playing-card img')].every(
      img => img.complete && img.naturalWidth > 0
    )
);

const buffer = await page.locator('.card').screenshot();
await browser.close();

// Downsample the 2400x1260 capture to the canonical 1200x630 and re-encode
// losslessly. WhatsApp only builds a preview for images under ~300 KB.
const resized = await sharp(buffer)
  .resize(1200, 630, { kernel: sharp.kernel.lanczos3 })
  .png({ effort: 10 })
  .toBuffer();

await writeFile(out, resized);
console.log(`wrote ${out.pathname}`);
