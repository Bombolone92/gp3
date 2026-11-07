/** Render real app UI with local fixtures, then compose the five store stories. */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
function dependency(name) {
  try { return require(name); } catch {
    const dir = process.env.STORE_NODE_MODULES || path.join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
    return require(path.join(dir, name));
  }
}
const { chromium } = dependency('playwright');
const sharp = dependency('sharp');
const base = process.env.STORE_APP_URL || 'http://127.0.0.1:5174';
const scratch = process.env.STORE_CAPTURE_DIR || await mkdtemp(path.join(tmpdir(), 'pos-store-'));
const browser = await chromium.launch({ headless: true, channel: process.env.STORE_BROWSER || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1040, height: 472 }, deviceScaleFactor: 4, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/Vancouver' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.setFixedTime(new Date('2026-09-05T15:00:00-07:00'));
// Sample account identity, confined to this isolated browser context.
await page.route('**/dev/puter-mock.js', async route => {
  const response = await route.fetch();
  await route.fulfill({ response, body: (await response.text()).replace("username: 'demo'", "username: 'Maya'") });
});
const ui = {};
async function settle() {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
}
async function prepare() {
  await page.waitForFunction(() => window.__pos?.store?.settings?.onboarded);
  await page.addStyleTag({ content: 'html{scrollbar-gutter:auto}*{scrollbar-width:none}*::-webkit-scrollbar{display:none}' });
  await settle();
}
async function capture(name, locator) {
  await settle();
  const png = locator ? await locator.screenshot({ animations: 'disabled' }) : await page.screenshot({ animations: 'disabled' });
  const meta = await sharp(png).metadata();
  ui[name] = { src: `data:image/png;base64,${png.toString('base64')}`, width: meta.width / 4, height: meta.height / 4 };
  await writeFile(path.join(scratch, `${name}.png`), png);
  console.log(`Captured ${name}: ${ui[name].width} × ${ui[name].height}`);
}
async function clip(name, selectors, tight = false) {
  await settle();
  const box = await page.evaluate(({ selectors, tight }) => {
    const r = selectors.map(s => {
      const n = document.querySelector(s);
      if (!tight) return n.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(n);
      return range.getBoundingClientRect();
    });
    const x = Math.floor(Math.min(...r.map(b => b.x))), y = Math.floor(Math.min(...r.map(b => b.y)));
    return { x, y, width: Math.ceil(Math.max(...r.map(b => b.right))) - x, height: Math.ceil(Math.max(...r.map(b => b.bottom))) - y };
  }, { selectors, tight });
  const png = await page.screenshot({ clip: box, animations: 'disabled' });
  ui[name] = { src: `data:image/png;base64,${png.toString('base64')}`, width: box.width, height: box.height };
  await writeFile(path.join(scratch, `${name}.png`), png);
  console.log(`Captured ${name}: ${box.width} × ${box.height}`);
}
async function capturePanelThrough(name, endSelector) {
  await settle();
  const box = await page.evaluate(endSelector => {
    const p = document.querySelector('.modal-panel').getBoundingClientRect();
    const last = document.querySelector(endSelector).getBoundingClientRect();
    if (last.bottom > p.bottom + 1) throw new Error('Profile content exceeds the visible panel');
    return { x:Math.floor(p.x), y:Math.floor(p.y), width:Math.ceil(p.width), height:Math.ceil(last.bottom - p.y) };
  }, endSelector);
  const png = await page.screenshot({ clip:box, animations:'disabled' });
  ui[name] = { src:`data:image/png;base64,${png.toString('base64')}`, width:box.width, height:box.height };
  await writeFile(path.join(scratch, `${name}.png`), png);
  console.log(`Captured ${name}: ${box.width} × ${box.height}`);
}
async function route(hash) {
  await page.goto(`${base}/mock.html#/${hash}`);
  await prepare();
}
try {
  if (process.env.STORE_CAPTURE_DIR) {
    for (const file of (await readdir(scratch)).filter(f => f.endsWith('.png') && !f.startsWith('contact-'))) {
      const png = await readFile(path.join(scratch, file));
      const meta = await sharp(png).metadata();
      ui[file.slice(0,-4)] = { src: `data:image/png;base64,${png.toString('base64')}`, width: meta.width / 4, height: meta.height / 4 };
    }
  } else {
  await page.goto(`${base}/mock.html`);
  await page.waitForFunction(() => window.__pos?.store?.settings);
  await page.evaluate(async () => {
    const { store } = window.__pos;
    const { sampleDataset } = await import('/src/lib/sample.js');
    const data = sampleDataset(store);
    data.settings = { ...data.settings, storeName: 'Corner Roast', sampleData: false, onboarded: true, theme: 'light', autoSnapshot: false,
      loyalty: { enabled: true, type: 'stamps', stamps: 10, categoryId: data.categories[0].id, rewardName: 'a free coffee' } };
    for (const [index, c] of data.customers.entries()) {
      c.email = '';
      if (!c.phone) c.phone = ['555-0142','555-0177','555-0168','555-0103','555-0189'][index];
    }
    for (const entry of data.credit) entry.note = 'Order adjustment';
    for (const p of data.products) {
      p.favorite = ['Espresso', 'Latte', 'Croissant', 'Cold brew'].includes(p.name);
    }
    // Receipt costs remain historical snapshots. The demo's one uncosted
    // drink is assigned its known cost for complete report coverage.
    for (const receipts of Object.values(data.sales)) for (const r of receipts) for (const l of r.lines) {
      if (l.name === 'Chai tea') l.unitCost = 0.65;
    }
    await store.importAll(data);
    await store.openDrawer({ float: 150 });
  });
  await page.reload();
  await prepare();
  await page.locator('.product-tile').filter({ hasText: 'Espresso' }).click();
  await page.locator('.product-tile').filter({ hasText: 'Croissant' }).click();
  await capture('overview-desktop');
  await page.setViewportSize({ width: 390, height: 622 });
  await settle();
  await capture('overview-mobile');

  // Whole dialogs, views, and workflow panels provide the surrounding context.
  await page.setViewportSize({ width: 580, height: 1100 });
  await page.locator('.product-tile').filter({ hasText: 'Latte' }).click();
  await page.getByRole('radio', { name: /^Large/ }).click();
  await page.getByRole('radio', { name: /^Oat/ }).click();
  await page.getByRole('button', { name: /^Extra shot/ }).click();
  await capture('order-editor', page.locator('.modal-panel'));
  await page.setViewportSize({ width: 390, height: 680 });
  await capture('order-context-mobile');
  await page.getByRole('button', { name: /^Add ·/ }).click();
  await page.setViewportSize({ width: 1200, height: 900 });
  await capture('active-sale', page.locator('.reg-cart'));

  await page.setViewportSize({ width: 660, height: 1100 });
  await route('products');
  await page.getByRole('button', { name: 'Merch', exact: true }).click();
  await capture('catalog-view', page.locator('.view'));
  const truncatedStock = await page.locator('.card-list .card-main span').evaluateAll(nodes => nodes.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent));
  if (truncatedStock.length) throw new Error(`Truncated stock text: ${truncatedStock.join(', ')}`);
  await page.setViewportSize({ width: 580, height: 1100 });
  await page.evaluate(async () => {
    const { openStockAdjust } = await import('/src/ui/stock-adjust.js');
    openStockAdjust(window.__pos.store.products.find(p => p.name === 'Canvas tote'));
  });
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('12');
  await page.getByRole('textbox', { name: 'Note', exact: true }).fill('Autumn stock delivery');
  await capture('stock-adjustment', page.locator('.modal-panel'));

  // Record a real sample reward so the profile includes reward activity.
  await page.evaluate(async () => {
    const { store } = window.__pos;
    const { computeCart } = await import('/src/lib/totals.js');
    const espresso = store.products.find(p => p.name === 'Espresso');
    const pastry = store.products.find(p => p.name === 'Croissant');
    const lines = [espresso, pastry].map((p, index) => {
      const tax = store.taxFor(p);
      return { productId:p.id, name:p.name, unitPrice:p.price, qty:1, taxRate:tax.rate, taxName:tax.name,
        discount:index === 0 ? { type:'percent', value:100 } : null };
    });
    const total = computeCart(lines).total;
    await store.completeSale({ lines, customerId:store.customers.find(c => c.name === 'Maya Lindqvist').id,
      payments:[{method:'card',amount:total}], reward:{kind:'stamps',name:'a free coffee',lineIndex:0}, note:'Coffee reward' });
  });
  await page.setViewportSize({ width: 680, height: 1200 });
  await route('customers');
  await capture('customer-directory', page.locator('.view'));
  await page.setViewportSize({ width: 580, height: 1200 });
  await page.locator('.card-row').filter({ hasText: 'Maya Lindqvist' }).click();
  await settle();
  for (let i = 0; i < 8 && await page.getByRole('button', { name: 'Look further back', exact: true }).count(); i++) {
    await page.getByRole('button', { name: 'Look further back', exact: true }).click();
    await settle();
  }
  await page.locator('.modal-panel').evaluate(n => { n.scrollTop = 0; });
  await capturePanelThrough('customer-profile', '.modal-panel .card-list .card-row:nth-child(2)');
  await capturePanelThrough('customer-summary', '.modal-panel .card-list .card-row:nth-child(1)');
  await page.setViewportSize({ width: 390, height: 1200 });
  await page.locator('.modal-panel').evaluate(n => { n.scrollTop = 0; });
  await capturePanelThrough('customer-profile-mobile', '.modal-panel .card-list .card-row:nth-child(2)');

  await page.setViewportSize({ width: 1280, height: 1600 });
  await route('reports');
  await page.getByRole('button', { name: '30 days', exact: true }).click();
  await page.waitForSelector('.chart-card');
  await clip('reports-overview', ['.view .view-head', '.view .chart-card']);
  await page.setViewportSize({ width: 540, height: 1600 });
  await settle();
  await clip('reports-overview-mobile', ['.view .view-head', '.view .chart-card']);
  await page.setViewportSize({ width: 620, height: 1600 });
  await page.getByRole('button', { name: 'Profit', exact: true }).click();
  await capture('product-ranking', page.locator('[aria-label="Top products"]'));
  }

  if (errors.length) throw new Error(`App errors: ${errors.join('; ')}`);
  const icon = `data:image/png;base64,${(await readFile(path.join(root, 'public/icons/icon-192.png'))).toString('base64')}`;
  const template = await readFile(path.join(root, 'store/scripts/composition.html'), 'utf8');
  const canvas = await browser.newPage({ deviceScaleFactor: 1, colorScheme: 'light' });
  canvas.setDefaultTimeout(10000);
  canvas.on('pageerror', error => errors.push(error.message));
  const sizes = [[1920,1080],[1024,768],[1080,2280]];
  const names = ['01-whole-shop', '02-custom-orders', '03-stock-control', '04-customer-rewards', '05-profit-insights'];
  const manifest = [];
  for (const [width,height] of sizes) {
    const dir = path.join(root, 'store/screenshots', `${width}x${height}`);
    await mkdir(dir, { recursive: true });
    for (let slide = 1; slide <= 5; slide++) {
      await canvas.setViewportSize({ width, height });
      await canvas.setContent(template.replace('/*__ASSET_DATA__*/', `window.ASSETS=${JSON.stringify({ ui, icon, width, height, slide })};`));
      await canvas.waitForSelector('h1');
      if (errors.length) throw new Error(errors.join('; '));
      await canvas.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
      const overflow = await canvas.locator('.shot, .copy, .brand').evaluateAll(nodes => nodes.filter(n => {
        const r = n.getBoundingClientRect();
        return r.x < 0 || r.y < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
      }).map(n => n.textContent || n.querySelector('img')?.alt || n.className));
      if (overflow.length) throw new Error(`Artwork overflow at ${width}x${height}, slide ${slide}: ${overflow}`);
      const copy = await canvas.locator('.copy').allTextContents();
      const badCopy = copy.filter(t => /[—\u{1F300}-\u{1FAFF}]|https?:|www\.|\.com\b/iu.test(t));
      if (badCopy.length) throw new Error(`Disallowed copy: ${badCopy}`);
      const headline = await canvas.locator('h1').innerText();
      const words = headline.trim().split(/\s+/).length;
      if (words < 3 || words > 7) throw new Error(`Headline must contain 3 to 7 words: ${headline}`);
      const file = path.join(dir, `${names[slide-1]}.png`);
      await canvas.screenshot({ path: file, animations: 'disabled' });
      const meta = await sharp(file).metadata();
      if (meta.width !== width || meta.height !== height) throw new Error(`Wrong dimensions: ${file}`);
      manifest.push({ file: path.relative(root, file), width, height, slide, headline: headline.replace(/\s+/g, ' '), bytes: (await readFile(file)).length });
      console.log(`Exported ${path.relative(root,file)}`);
    }
  }
  await writeFile(path.join(root, 'store/asset-manifest.json'), `${JSON.stringify({ app: 'Point of Sale', theme: 'light', sampleDate: '2026-09-05', assets: manifest },null,2)}\n`);
  // Review-only sheets live outside the deliverable screenshot directories.
  for (const [w,h] of sizes) {
    const thumbW = w === 1080 ? 216 : 384;
    const thumbs = await Promise.all(manifest.filter(m=>m.width===w&&m.height===h).map(async m => sharp(path.join(root,m.file)).resize({ width: thumbW }).png().toBuffer()));
    const th = Math.round(h*thumbW/w);
    await sharp({create:{width:thumbW*5,height:th,channels:3,background:'#e8e4de'}}).composite(thumbs.map((input,i)=>({input,left:i*thumbW,top:0}))).png().toFile(path.join(scratch,`contact-${w}x${h}.png`));
  }
  console.log(`Review files: ${scratch}`);
} finally {
  await browser.close();
}
