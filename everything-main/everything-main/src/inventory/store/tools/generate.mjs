import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { capture } from './capture.mjs';
import { slides, composition } from '../source/composition.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const base = process.env.STORE_APP_URL || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const ui = process.argv.includes('--reuse-captures')
    ? JSON.parse(await readFile(`${root}/source/ui/manifest.json`, 'utf8'))
    : await capture(browser, base, root);
  console.log('UI captures ready', Object.fromEntries(Object.entries(ui).map(([k,v]) => [k, `${v.width}x${v.height}`])));
  const page = await browser.newPage({ deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'reduce' });
  // Use a clean document at the same origin. The app's asynchronous onboarding
  // must never run in the separate marketing composition document.
  await page.route('**/store-render', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto(`${base}/store-render`);
  const manifest = [];
  for (const [width, height] of [[1920,1080], [1024,768], [1080,2280]]) {
    await mkdir(`${root}/screenshots/${width}x${height}`, { recursive: true });
    await mkdir(`${root}/source/compositions/${width}x${height}`, { recursive: true });
    await page.setViewportSize({ width, height });
    for (let index = 0; index < slides.length; index++) {
      const filename = `${String(index + 1).padStart(2, '0')}-${slides[index].slug}`;
      const html = composition({ index, width, height, ui }).replace(/[\t ]+$/gm, '');
      await writeFile(`${root}/source/compositions/${width}x${height}/${filename}.html`, html);
      await page.setContent(html);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.images].map(img => img.decode()));
      });
      const checks = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };
        const nodes = [...document.querySelectorAll('.ui,.brand,.page-number,h1,.sub,.eyebrow,.product-label')]
          .filter(el => getComputedStyle(el).display !== 'none');
        const bad = nodes.filter(el => { const r=rect(el); return r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1; });
        return { outsideCanvas: bad.map(el=>({tag:el.className,rect:rect(el)})),
          rects: nodes.map(el=>({class:el.className,rect:rect(el)})) };
      });
      const path = `${root}/screenshots/${width}x${height}/${filename}.png`;
      await page.screenshot({ path, animations: 'disabled' });
      manifest.push({ file: `screenshots/${width}x${height}/${filename}.png`, width, height,
        headline: slides[index].title.replace('<br>', ' '), subhead: slides[index].sub, ...checks });
      console.log(`${width}x${height}/${filename}: ${checks.outsideCanvas.length ? JSON.stringify(checks.outsideCanvas) : 'inside canvas'}`);
    }
  }
  await writeFile(`${root}/source/asset-manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
  await page.close();
} finally { await browser.close(); }
