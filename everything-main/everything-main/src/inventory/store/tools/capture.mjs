import { mkdir, writeFile } from 'node:fs/promises';
import { sampleData, CAPTURE_TIME } from '../source/sample-data.mjs';

export async function capture(browser, base, root) {
  const context = await browser.newContext({ viewport: { width: 1120, height: 727 }, deviceScaleFactor: 4,
    colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/Vancouver' });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(CAPTURE_TIME));
  await page.addInitScript(data => {
    if (!localStorage.getItem('store-assets-seeded')) {
      localStorage.setItem('inventory:theme', 'light');
      for (const [key, value] of Object.entries(data)) {
        localStorage.setItem(`puter-mock:kv:inv:${key}:${key === 'products' ? 'v2' : 'v1'}`, JSON.stringify(value));
      }
      localStorage.setItem('store-assets-seeded', 'yes');
    }
  }, sampleData());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const assets = {};
  const dir = `${root}/source/ui`;
  await mkdir(dir, { recursive: true });
  async function go(route, width = 380, height = 5000) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/mock.html#/${route}`);
    await page.waitForSelector('.view-title');
    await page.evaluate(() => document.fonts.ready);
    // Capture-only hygiene. No changes to the app's fonts, layout, colour, or icons.
    await page.addStyleTag({ content: '* { caret-color: transparent !important; scrollbar-width: none !important; } *::-webkit-scrollbar { display: none !important; }' });
    await page.mouse.move(0, 0);
  }
  async function save(name, locator, { topOnly = false } = {}) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (topOnly) {
      const actions = await locator.locator('.product-row-actions').boundingBox();
      box.height = actions.y - box.y - 3;
    }
    // Outward rounding preserves every edge pixel and never trims text.
    const clip = { x: Math.floor(box.x), y: Math.floor(box.y),
      width: Math.ceil(box.x + box.width) - Math.floor(box.x),
      height: Math.ceil(box.y + box.height) - Math.floor(box.y) };
    await page.screenshot({ path: `${dir}/${name}.png`, clip, animations: 'disabled' });
    assets[name] = { width: clip.width, height: clip.height, text: await locator.innerText() };
  }
  await go('', 1120, 727);
  await page.evaluate(() => { window.__inv.store.user.username = 'Alex Morgan'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  // Remount the real app shell to reflect the fictional signed-in account.
  await page.evaluate(async () => {
    const { mountShell } = await import('/src/ui/shell.js');
    mountShell(document.getElementById('app'));
  });
  await page.screenshot({ path: `${dir}/overview-desktop.png`, animations: 'disabled' });
  assets['overview-desktop'] = { width: 1120, height: 727 };
  await save('overview-value', page.locator('.stat').filter({ hasText: 'Stock value' }));
  await go('', 500, 1100);
  const end = await page.locator('.main-inner > .item-list').first().boundingBox();
  const mobileHeight = Math.ceil(end.y + end.height + 80);
  await page.setViewportSize({ width: 500, height: mobileHeight });
  // The floating shortcut otherwise covers a Restock label at this viewport.
  // This capture-only visibility change leaves all underlying UI untouched.
  await page.addStyleTag({ content: '.fab { visibility: hidden !important; }' });
  await page.screenshot({ path: `${dir}/overview-mobile.png`, animations: 'disabled' });
  assets['overview-mobile'] = { width: 500, height: mobileHeight };

  await go('product/stand', 424);
  const stock = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Stock by location', exact: true }) });
  await save('location-card', stock);
  for (const name of ['Warehouse', 'Storefront']) {
    await save(`location-${name.toLowerCase()}`, stock.locator('.item-row').filter({ hasText: name }), { topOnly: true });
  }
  await go('reorder');
  const order = page.locator('.order-card').first();
  await save('reorder-card', order);
  await save('reorder-heading', order.locator('.order-head'));
  await save('reorder-line', order.locator('.order-line').filter({ hasText: 'USB-C Cable' }));
  await save('reorder-button', order.getByRole('button', { name: 'Mark as ordered' }));

  await go('takeout');
  await page.evaluate(async () => {
    const store = window.__inv.store;
    await store.startTakeout({ reason: 'sold', locationId: 'shop', note: 'Saturday shop sales' });
    await store.addToTakeout('notebook', { qty: 3 });
    await store.addToTakeout('mouse', { qty: 2 });
  });
  await page.waitForSelector('[data-line]');
  for (const name of ['Wireless Mouse', 'Dotted Notebook']) {
    await save(`takeout-${name.split(' ')[0].toLowerCase()}`, page.locator('[data-line]').filter({ hasText: name }));
  }
  await save('takeout-button', page.getByRole('button', { name: 'Review & take out' }));
  await save('scan-button', page.getByRole('button', { name: 'Scan', exact: true }));

  await go('reports', 420);
  await save('sales-grid', page.locator('.stat-grid'));
  for (const label of ['Revenue', 'Gross profit', 'Realized margin']) {
    await save(`sales-${label.toLowerCase().replace(' ', '-')}`, page.locator('.stat').filter({ hasText: label }).first());
  }
  await save('sales-chart', page.locator('.main-inner > .card').first());
  if (errors.length) throw new Error(`App errors: ${errors.join('\n')}`);
  await writeFile(`${root}/source/ui/manifest.json`, JSON.stringify(assets, null, 2) + '\n');
  await context.close();
  return assets;
}
