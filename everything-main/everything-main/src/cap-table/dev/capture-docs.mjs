/** Capture real sample-company workflows. Start Vite first, then run with
 * PLAYWRIGHT_MODULE=/path/to/playwright node dev/capture-docs.mjs.
 * All actions use the in-memory mock account.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const origin = process.env.ASSET_ORIGIN || 'http://127.0.0.1:5174';
const captures = [];
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  await mkdir(output, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/Vancouver' });
  page.setDefaultTimeout(10000);
  await page.route('https://plausible.io/**', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/mock.html`);
  await page.getByRole('button', { name: 'Explore with sample data' }).click();
  const loaded = page.getByText('Sample data loaded. Wipe it anytime from the banner');
  await loaded.waitFor({ state: 'visible' });
  await page.mouse.move(0, 0);
  await loaded.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Reports', exact: true }).click();
  await page.getByRole('heading', { name: 'Reports', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  captures.push(['stock-compensation-report.png', await page.screenshot({ animations: 'disabled' })]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Share classes', exact: true }).click();
  const hiring = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Hiring plan', exact: true }) });
  await hiring.waitFor();
  await hiring.getByRole('button', { name: 'Add role', exact: true }).click();
  const hireForm = page.getByRole('dialog', { name: 'Plan a grant', exact: true });
  await hireForm.getByLabel('Role', { exact: true }).fill('Software engineer');
  await hireForm.getByLabel('How many', { exact: true }).fill('4');
  await hireForm.getByLabel('Shares per hire', { exact: true }).fill('40000');
  await hireForm.getByRole('button', { name: 'Add role', exact: true }).click();
  await hireForm.waitFor({ state: 'hidden' });
  captures.push(['hiring-plan.png', await hiring.screenshot({ animations: 'disabled' })]);
  await page.getByRole('button', { name: 'Securities', exact: true }).click();
  await page.getByRole('button', { name: 'Lifecycle actions for OPT-1', exact: true }).click();
  await page.getByText('Record exercise', { exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Exercise OPT-1', exact: true }) });
  await dialog.waitFor();
  captures.push(['option-exercise.png', await dialog.screenshot({ animations: 'disabled' })]);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Captured stock compensation, hiring plan, and option exercise workflows.');
} finally { await browser.close(); }

// Write after browser capture so Vite asset reloads cannot reset the mock data.
for (const [name, bytes] of captures) await writeFile(`${output}/${name}`, bytes);
