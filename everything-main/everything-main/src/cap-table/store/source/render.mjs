import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = process.env.PLAYWRIGHT_MODULE
  ? require(process.env.PLAYWRIGHT_MODULE) : require('playwright');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const origin = process.env.ASSET_ORIGIN || 'http://127.0.0.1:5174';
const formats = [
  { key: 'desktop', width: 1920, height: 1080 },
  { key: 'tablet', width: 1024, height: 768 },
  { key: 'mobile', width: 1080, height: 2280 },
];
const features = ['ownership', 'fundraising', 'hiring', 'exit'];
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const format of formats) {
    const context = await browser.newContext({
      viewport: { width: format.width, height: format.height },
      deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce',
      locale: 'en-US', timezoneId: 'America/Vancouver',
    });
    // Stable dates across all real app views, including iframe renderers.
    await context.addInitScript(() => {
      const NativeDate = Date;
      const fixed = NativeDate.parse('2026-09-05T12:00:00Z');
      window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [fixed])); }
        static now() { return fixed; }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const [index, feature] of features.entries()) {
      await page.goto(`${origin}/store/source/artwork.html?feature=${feature}&format=${format.key}`);
      await page.waitForFunction(() => window.assetReady, { timeout: 20000 });
      await page.locator('iframe').evaluate(frame => frame.contentDocument.fonts.ready);
      const dir = path.join(repo, 'store/screenshots', `${format.width}x${format.height}`);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `0${index + 1}-${feature}.png`);
      const qa = await page.evaluate(() => {
        const bounds = element => {
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        };
        const frame = document.querySelector('iframe');
        const doc = frame.contentDocument;
        return {
          title: document.querySelector('h1').innerText,
          text: document.body.innerText + '\n' + doc.body.innerText,
          headline: bounds(document.querySelector('h1')),
          copy: bounds(document.querySelector('.copy')),
          showcase: bounds(document.querySelector('.showcase')),
          ui: bounds(document.querySelector('.ui-frame')),
          theme: doc.documentElement.dataset.theme,
          truncated: [...doc.querySelectorAll('.name, .v, .val, .shares')]
            .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent),
        };
      });
      if (qa.theme !== 'light' || qa.truncated.length || errors.length) {
        throw new Error(JSON.stringify({ feature, format, qa, errors }));
      }
      if (qa.showcase.bottom > format.height - 25 || qa.showcase.right > format.width) {
        throw new Error(`Artwork exceeds canvas: ${feature}/${format.key}: ${JSON.stringify(qa.showcase)}`);
      }
      await page.screenshot({ path: file, animations: 'disabled' });
      report.push({ file: path.relative(repo, file), width: format.width, height: format.height, ...qa });
      console.log(`Rendered ${path.relative(repo, file)}`);
    }
    await context.close();
  }
  await writeFile(path.join(repo, 'store/source/render-report.json'), JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser.close();
}
