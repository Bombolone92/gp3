import { expect, test, type Page } from '@playwright/test';
import { boot, canvasClick, compositePixel, downloadFrom, idle, openImage, start, tool } from './helpers';

test.beforeEach(async ({ page }) => {
  await boot(page);
  await openImage(page, 300, 200, '#ffffff');
});

const textOf = (page: Page) => page.evaluate(() => window.photoStudio.doc.layers.find((l) => l.kind === 'text')?.text);

// How much dark ink the composite has in a rectangle.
async function ink(page: Page, r: { x: number; y: number; width: number; height: number }) {
  return page.evaluate(async (r) => {
    const e = window.photoStudio;
    await e.renderer.settle();
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    const img = await compositeRGBA(e);
    let n = 0;
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) if (img.data[(y * img.width + x) * 4] < 128) n++;
    return n;
  }, r);
}

test('define variables, edit data sets, apply them and export one file per set', async ({ page }) => {
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 20, 60);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await idle(page);

  // Image > Variables > Define…: text replacement and visibility for the text layer.
  await start(page, 'image.variables-define');
  const define = page.getByRole('dialog', { name: 'Define Variables' });
  await define.getByLabel('Text Replacement').check();
  await define.locator('[name=text-name]').fill('headline');
  await define.getByLabel('Visibility').check();
  await define.locator('[name=vis-name]').fill('show');
  // Names must be unique.
  await define.locator('[name=vis-name]').fill('headline');
  await define.getByRole('button', { name: 'OK' }).click();
  await expect(define.getByRole('alert')).toContainText('more than once');
  await define.locator('[name=vis-name]').fill('show');
  await define.getByRole('button', { name: 'OK' }).click();
  await idle(page);
  expect(await page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Define Variables');

  // Data Sets…: the first set captures the document; a second one changes the text.
  await start(page, 'image.variables-data-sets');
  const sets = page.getByRole('dialog', { name: 'Data Sets' });
  await expect(sets.locator('tbody tr')).toHaveCount(1);
  await sets.getByRole('button', { name: 'New', exact: true }).click();
  await expect(sets.locator('tbody tr')).toHaveCount(2);
  await sets.locator('tbody tr').nth(1).locator('textarea').fill('A much longer headline');
  // The preview shows the selected set while the dialog is open.
  await expect
    .poll(() => page.evaluate(() => (window.photoStudio as unknown as { lastDoc: { layers: { kind: string; text: string }[] } }).lastDoc.layers.find((l) => l.kind === 'text')?.text))
    .toBe('A much longer headline');
  await page.screenshot({ path: test.info().outputPath('data-sets.png') });
  await sets.getByRole('button', { name: 'OK' }).click();
  await idle(page);
  expect(await textOf(page)).toBe('A much longer headline');
  expect(await page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Edit Data Sets');

  // Apply Data Set…: back to the first set.
  await start(page, 'image.apply-data-set');
  const apply = page.getByRole('dialog', { name: 'Apply Data Set' });
  await apply.locator('select[name=set]').selectOption({ label: 'Data Set 1' });
  await apply.getByRole('button', { name: 'Apply' }).click();
  await idle(page);
  expect(await textOf(page)).toBe('Hi');
  expect(await ink(page, { x: 60, y: 30, width: 200, height: 40 })).toBe(0);

  // File > Import > Variable Data Sets… from CSV (quoted comma, hidden layer).
  const chooser = page.waitForEvent('filechooser');
  await start(page, 'file.import-data-sets');
  await (await chooser).setFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from('headline,show\n"Hello, world",true\nGone,false\n') });
  const imp = page.getByRole('dialog', { name: 'Import Data Sets' });
  await expect(imp).toContainText('2 data sets');
  await imp.getByRole('button', { name: 'Import' }).click();
  await idle(page);
  expect(await textOf(page)).toBe('Hello, world');
  expect(await page.evaluate(() => window.photoStudio.doc.variables!.sets.map((s) => s.values.show))).toEqual([true, false]);

  // Export Data Sets as Files: one PNG per set in a ZIP.
  await start(page, 'file.export-data-sets');
  const exp = page.getByRole('dialog', { name: 'Export Data Sets as Files' });
  await exp.locator('select[name=naming]').selectOption('headline');
  await exp.locator('input[name=prefix]').fill('card-');
  const file = await downloadFrom(page, () => exp.getByRole('button', { name: 'Export' }).click());
  expect(file.name).toMatch(/data-sets\.zip$/);
  const listing = file.bytes.toString('latin1');
  expect(listing).toContain('card-Hello, world.png');
  expect(listing).toContain('card-Gone.png');
  // Exporting leaves the document as it was.
  expect(await textOf(page)).toBe('Hello, world');
});

test('pixel replacement fits an image into the layer bounds; sets persist in projects', async ({ page }) => {
  // A pixel layer with a block of content defines the replacement bounds.
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const data = new Uint8ClampedArray(100 * 50 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([200, 200, 200, 255], i);
    const l = newPixelLayer('Photo', e.doc, gridFromImage(e.assets.tiles, { width: 100, height: 50, data }, 50, 40));
    e.command('New Layer', (d) => d.layers.push(l));
    e.selectLayers([l.id]);
  });
  await idle(page);
  await start(page, 'image.variables-define');
  const define = page.getByRole('dialog', { name: 'Define Variables' });
  await define.getByLabel('Pixel Replacement').check();
  await define.locator('[name=px-name]').fill('photo');
  await define.locator('select[name=px-method]').selectOption('fit');
  await define.getByRole('button', { name: 'OK' }).click();
  await idle(page);
  expect(await page.evaluate(() => Object.values(window.photoStudio.doc.variables!.layers)[0].pixel!.bounds)).toEqual({ x: 50, y: 40, width: 100, height: 50 });

  // A red square image from the chosen folder, applied through a data set.
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(20, 20);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 20, 20);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const { setImageFiles } = await import('/src/features/variables/apply.ts');
    setImageFiles([new File([blob], 'red.png', { type: 'image/png' })]);
    const e = window.photoStudio;
    e.command('Edit Data Sets', (d) => (d.variables!.sets = [{ name: 'Red', values: { photo: 'Red.PNG' } }]));
    const { applySet } = await import('/src/features/variables/apply.ts');
    await applySet(e, 0);
  });
  await idle(page);
  // Fit: a 50 x 50 square centered in the 100 x 50 bounds.
  expect((await compositePixel(page, 100, 65)).slice(0, 3)).toEqual([255, 0, 0]);
  expect((await compositePixel(page, 60, 65)).slice(0, 3)).toEqual([255, 255, 255]);
  expect(await page.evaluate(() => window.photoStudio.history.labels.at(-1))).toBe('Apply Data Set');

  // Definitions and sets survive a .photo round trip.
  const round = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const back = await deserialize(await serialize(e.doc, e.assets));
    return back.document.variables;
  });
  expect(round!.sets[0].values.photo).toBe('Red.PNG');
  expect(Object.values(round!.layers)[0].pixel!.method).toBe('fit');
});
