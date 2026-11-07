import { test, expect } from '@playwright/test';
import { boot, canvasClick, canvasDrag, compositePixel, historyLabels, idle, layerPixel, menu, openImage, run, start, tool, undo } from './helpers';

test.beforeEach(async ({ page }) => {
  await boot(page);
});

/** A 200×150 document: left half red, right half blue, with a sharp edge at x=100. */
async function openSplit(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(200, 150);
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 100, 150);
    g.fillStyle = '#0000ff';
    g.fillRect(100, 0, 100, 150);
    const { openFile } = await import('/src/features/files/open.ts');
    await openFile(window.photoStudio, await c.convertToBlob(), 'split.png');
  });
  await idle(page);
}

test('Gaussian Blur applied through runCommand with params softens an edge', async ({ page }) => {
  await openSplit(page);
  expect(await layerPixel(page, 98, 75)).toEqual([255, 0, 0, 255]);
  await run(page, 'filter.apply.gaussian-blur', { params: { radius: 4 } });
  expect(await historyLabels(page)).toEqual(['Gaussian Blur']);
  const edge = await layerPixel(page, 99, 75);
  expect(edge[0]).toBeGreaterThan(80);
  expect(edge[0]).toBeLessThan(220);
  expect(edge[2]).toBeGreaterThan(40);
  // Far from the edge the colors are unchanged.
  expect(await layerPixel(page, 20, 75)).toEqual([255, 0, 0, 255]);
  await undo(page);
  expect(await layerPixel(page, 99, 75)).toEqual([255, 0, 0, 255]);
});

test('a filter dialog previews and applies with OK', async ({ page }) => {
  await openSplit(page);
  await menu(page, 'Filter', 'Blur', 'Box Blur…');
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type=number][data-key="radius"]').fill('5');
  await dialog.locator('input[type=number][data-key="radius"]').dispatchEvent('input');
  await dialog.locator('.fd-ok').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await idle(page);
  await expect.poll(() => historyLabels(page)).toEqual(['Box Blur']);
  const edge = await layerPixel(page, 99, 75);
  expect(edge[2]).toBeGreaterThan(40);
});

test('Layer Style dialog adds a drop shadow that renders below the layer', async ({ page }) => {
  await openImage(page, 200, 150, '#ffffff', 'white.png');
  // A small opaque square on a transparent layer casts a visible shadow.
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const data = new Uint8ClampedArray(40 * 40 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([0, 200, 0, 255], i);
    const l = newPixelLayer('Square', e.doc, gridFromImage(e.assets.tiles, { width: 40, height: 40, data }, 60, 50));
    e.command('Add square', (d) => d.layers.push(l));
    e.selected = l.id;
    e.update();
  });
  await idle(page);
  const before = await compositePixel(page, 108, 98);
  expect(before).toEqual([255, 255, 255, 255]);
  await start(page, 'layer.style-dialog');
  const dialog = page.getByRole('dialog', { name: 'Layer Style' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Enable Drop Shadow' }).check();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();
  await idle(page);
  const style = await page.evaluate(() => window.photoStudio.layer!.style);
  expect(style).toBeTruthy();
  expect(JSON.stringify(style)).toContain('dropShadow');
  // Default drop shadow offsets down-right; the pixel just outside the square darkens.
  await expect.poll(async () => (await compositePixel(page, 85, 93))[0], { timeout: 60_000 }).toBeLessThan(240);
  // The square itself still shows its own color.
  expect(await compositePixel(page, 80, 70)).toEqual([0, 200, 0, 255]);
});

test('gradient tool paints foreground to background across the drag', async ({ page }) => {
  await openImage(page, 200, 150, '#808080', 'gray.png');
  await run(page, 'color.default');
  await tool(page, 'Gradient Tool');
  await canvasDrag(page, [[20, 75], [180, 75]], 8);
  await expect.poll(() => historyLabels(page)).toEqual(['Gradient']);
  const left = await layerPixel(page, 10, 75),
    mid = await layerPixel(page, 100, 75),
    right = await layerPixel(page, 190, 75);
  expect(left.slice(0, 3)).toEqual([0, 0, 0]);
  expect(right.slice(0, 3)).toEqual([255, 255, 255]);
  expect(mid[0]).toBeGreaterThan(90);
  expect(mid[0]).toBeLessThan(170);
  // Linear gradients are constant perpendicular to the drag (up to dithering).
  const top = await layerPixel(page, 100, 10);
  for (let c = 0; c < 3; c++) expect(Math.abs(top[c] - mid[c])).toBeLessThanOrEqual(2);
});

test('type tool creates an editable text layer', async ({ page }) => {
  await openImage(page, 300, 150, '#ffffff', 'white.png');
  await tool(page, 'Horizontal Type Tool');
  await canvasClick(page, 40, 80);
  await expect(page.getByRole('textbox', { name: 'Text input' })).toBeFocused();
  await page.keyboard.type('Hello');
  await page.keyboard.press('Escape');
  await idle(page);
  const l = await page.evaluate(() => {
    const l = window.photoStudio.layer!;
    return { kind: l.kind, name: l.name, text: l.textData?.text ?? l.text };
  });
  expect(l).toEqual({ kind: 'text', name: 'Hello', text: 'Hello' });
  await expect(page.locator('#layers .layer-row')).toHaveCount(2);
  // The text renders dark pixels somewhere around the click point.
  const dark = await page.evaluate(async () => {
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    const img = await compositeRGBA(window.photoStudio);
    let n = 0;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i] < 128) n++;
    return n;
  });
  expect(dark).toBeGreaterThan(20);
});

test('crop tool commits a dragged rectangle', async ({ page }) => {
  await openSplit(page);
  await tool(page, 'Crop Tool');
  await canvasDrag(page, [[50, 30], [150, 110]], 6);
  await page.getByRole('button', { name: 'Commit crop', exact: true }).click();
  await idle(page);
  await expect(page.locator('#tab-size')).toHaveText('100 × 80 px');
  const doc = await page.evaluate(() => ({ w: window.photoStudio.doc.width, h: window.photoStudio.doc.height }));
  expect(doc).toEqual({ w: 100, h: 80 });
  // The red/blue edge is now in the middle of the cropped canvas.
  expect(await compositePixel(page, 45, 40)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 55, 40)).toEqual([0, 0, 255, 255]);
});

test('Image Size resamples the document', async ({ page }) => {
  await openSplit(page);
  await menu(page, 'Image', 'Image Size…');
  const dialog = page.locator('dialog[open]');
  await expect(dialog.locator('#is-w')).toBeVisible();
  await expect(dialog.locator('#is-resample')).toBeChecked();
  await dialog.getByLabel('Width', { exact: true }).fill('100');
  await dialog.getByLabel('Width', { exact: true }).dispatchEvent('input');
  await expect(dialog.getByLabel('Height', { exact: true })).toHaveValue('75');
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await idle(page);
  await expect(page.locator('#tab-size')).toHaveText('100 × 75 px');
  expect(await compositePixel(page, 25, 30)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 75, 30)).toEqual([0, 0, 255, 255]);
});

test('adjustment layer from the Layer menu', async ({ page }) => {
  await openSplit(page);
  const registered = await page.evaluate(async () => (await import('/src/app/registry.ts')).commands.has('layer.adj-levels'));
  test.skip(!registered, 'Adjustment layer commands are not registered in this build');
  await start(page, 'layer.adj-levels');
  await idle(page).catch(() => undefined);
  await expect.poll(() => page.evaluate(() => window.photoStudio.layer?.kind)).toBe('adjustment');
  expect(await page.evaluate(() => window.photoStudio.layer?.adjustment?.kind)).toBe('levels');
});
