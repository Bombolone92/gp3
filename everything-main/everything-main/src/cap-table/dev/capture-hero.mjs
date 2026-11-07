/** Capture the actual sample-data UI for the public hero. Start Vite first.
 * Run with PLAYWRIGHT_MODULE=/path/to/playwright node dev/capture-hero.mjs.
 * Uses only /mock.html and its in-memory storage, never a real Puter account.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const origin = process.env.ASSET_ORIGIN || 'http://127.0.0.1:5174';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
await mkdir(output, { recursive: true });
try {
  for (const [name, width, height] of [['desktop', 1440, 960], ['mobile', 430, 920]]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/Vancouver' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/mock.html`);
    await page.getByRole('button', { name: 'Explore with sample data' }).click();
    const loaded = page.getByText('Sample data loaded. Wipe it anytime from the banner');
    await loaded.waitFor({ state: 'visible' });
    // A pointer over the toast pauses its dismissal, especially on mobile.
    await page.mouse.move(0, 0);
    await loaded.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${output}/cap-table-${name}.png`, animations: 'disabled' });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`Captured ${name}: ${width} × ${height}`);
    await context.close();
  }
} finally { await browser.close(); }
