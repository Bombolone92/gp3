// Measurement and annotation: color sampler readouts in the Info panel
// (with before/after values while an adjustment previews), the Ruler tool's
// straighten, counts, notes and recorded measurements.
import { test, expect, type Page } from '@playwright/test';
import { boot, canvasClick, canvasDrag, historyLabels, idle, panel, run, tool, undo } from './helpers';

/** A 400 x 300 image: dark-blue left half, orange right half, red disc. */
async function openTestImage(page: Page) {
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300);
    const g = c.getContext('2d')!;
    g.fillStyle = '#203060';
    g.fillRect(0, 0, 200, 300);
    g.fillStyle = '#e09040';
    g.fillRect(200, 0, 200, 300);
    g.fillStyle = '#e03030';
    g.beginPath();
    g.arc(200, 150, 50, 0, Math.PI * 2);
    g.fill();
    const blob = await c.convertToBlob({ type: 'image/png' });
    const { openFile } = await import('/src/features/files/open.ts');
    await openFile(window.photoStudio, blob, 'measure.png');
  });
  await idle(page);
}
const samplerValues = (page: Page, n: number) => page.locator('.info-samplers .info-block').nth(n).locator('dd');

test.beforeEach(async ({ page }) => {
  await boot(page);
  await openTestImage(page);
});

test('color samplers read live values, before/after while previewing, and persist', async ({ page }) => {
  await tool(page, 'Color Sampler Tool');
  await canvasClick(page, 50, 50);
  await canvasClick(page, 200, 150);
  await canvasClick(page, 350, 250);
  expect(await historyLabels(page)).toEqual(['Color Sampler', 'Color Sampler', 'Color Sampler']);
  const info = await panel(page, 'Info');
  await expect(info.locator('.info-samplers .info-block')).toHaveCount(3);
  await expect(samplerValues(page, 0)).toHaveText(['32', '48', '96']);
  await expect(samplerValues(page, 1)).toHaveText(['224', '48', '48']);
  await expect(samplerValues(page, 2)).toHaveText(['224', '144', '64']);

  // Another color model for one sampler.
  await info.locator('[data-sampler-model="2"]').selectOption('hex');
  await expect(samplerValues(page, 2)).toHaveText(['e09040']);
  await info.locator('[data-sampler-model="2"]').selectOption('rgb');

  // An adjustment preview shows before/after pairs; cancelling restores them.
  await page.evaluate(() => void window.photoStudio.runCommand('adjust.brightness-contrast'));
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const brightness = dialog.getByRole('spinbutton').first();
  await brightness.fill('60');
  await brightness.dispatchEvent('input');
  await brightness.dispatchEvent('change');
  // "before/after" while the dialog previews the change.
  await expect(samplerValues(page, 0).first()).toHaveText(/^32\/(?!32$)\d+$/);
  await page.keyboard.press('Escape');
  await expect(samplerValues(page, 0)).toHaveText(['32', '48', '96']);

  // Drag a sampler to a new spot, then delete one with Alt-click.
  await tool(page, 'Color Sampler Tool');
  await canvasDrag(page, [[50.5, 50.5], [300.5, 40.5]]);
  await expect(samplerValues(page, 0)).toHaveText(['224', '144', '64']);
  await canvasClick(page, 200.5, 150.5, ['Alt']);
  await expect(info.locator('.info-samplers .info-block')).toHaveCount(2);
  await undo(page);
  await expect(info.locator('.info-samplers .info-block')).toHaveCount(3);

  // Samplers are saved in .photo projects.
  const saved = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    return (await deserialize(await serialize(e.doc, e.assets))).document.annotations;
  });
  expect(saved?.samplers).toEqual([{ x: 300, y: 40 }, { x: 200, y: 150 }, { x: 350, y: 250 }]);
});

test('ruler measures, adds a protractor line and straightens the image', async ({ page }) => {
  await tool(page, 'Ruler Tool');
  // 200 px across, 35 px up: about 9.9° from horizontal.
  await canvasDrag(page, [[100, 200], [300, 165]]);
  const readout = page.locator('#ruler-readout');
  await expect(readout).toContainText('9.9°');
  await expect(readout.locator('.ruler-value').filter({ hasText: 'L1' }).locator('output')).toHaveText('203');
  // Alt-drag from the start point adds a second line; A becomes the angle between them.
  await canvasDrag(page, [[100, 200], [100, 100]], 6, ['Alt']);
  await expect(readout).toContainText('80.1°');
  await expect(readout.locator('.ruler-value').filter({ hasText: 'L2' }).locator('output')).toHaveText('100');
  await page.locator('#tool-options').getByRole('button', { name: 'Clear' }).click();
  await expect(readout).toContainText('–');

  // Straighten the layer without cropping: one rotation step about the line.
  await canvasDrag(page, [[100, 200], [300, 165]]);
  await page.locator('#ruler-crop').uncheck();
  await page.locator('#tool-options').getByRole('button', { name: /Straighten Layer/ }).click();
  await idle(page);
  expect(await historyLabels(page)).toEqual(['Straighten Layer']);
  await expect(readout).toContainText('0.0°');
  expect(await page.evaluate(() => [window.photoStudio.doc.width, window.photoStudio.doc.height])).toEqual([400, 300]);
  await undo(page);

  // With Crop, the whole image turns and is cropped to the level rectangle.
  await page.locator('#ruler-crop').check();
  await page.locator('#tool-options').getByRole('button', { name: /Straighten Layer/ }).click();
  await idle(page);
  expect((await historyLabels(page)).at(-1)).toBe('Straighten');
  const [w, h] = await page.evaluate(() => [window.photoStudio.doc.width, window.photoStudio.doc.height]);
  expect(w).toBeLessThan(400);
  expect(h).toBeLessThan(300);
  expect(Math.abs(w / h - 4 / 3)).toBeLessThan(0.02);
  // Corners hold image content (no transparent wedges).
  const corner = await page.evaluate(async () => {
    const { compositeRGBA } = await import('/src/features/pixels.ts');
    const img = await compositeRGBA(window.photoStudio);
    return [img.data[3], img.data[(img.width - 1) * 4 + 3], img.data[img.data.length - 1]];
  });
  expect(corner.every((a) => a === 255)).toBe(true);
});

test('counts, notes and recorded measurements', async ({ page }) => {
  await tool(page, 'Count Tool');
  for (const [x, y] of [[40, 40], [60, 60], [80, 80]]) await canvasClick(page, x, y);
  await expect(page.locator('#count-total')).toHaveText('3');
  await canvasClick(page, 60, 60, ['Alt']);
  await expect(page.locator('#count-total')).toHaveText('2');

  await tool(page, 'Note Tool');
  await canvasClick(page, 300, 30);
  const notes = page.locator('.panel-body[aria-label="Notes"]');
  await expect(notes).toBeVisible();
  await notes.locator('#note-text').fill('Highlight is clipped here.');
  await notes.locator('#note-text').blur();
  await expect.poll(() => page.evaluate(() => window.photoStudio.doc.annotations?.notes?.[0]?.text)).toBe('Highlight is clipped here.');

  // Scale: 100 px = 4 cm, then record the disc selection.
  await page.evaluate(() => window.photoStudio.command('Set Measurement Scale', (d) => (d.annotations = { ...d.annotations, scale: { pixels: 100, length: 4, units: 'cm' } })));
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const { applySelection } = await import('/src/model/selection.ts');
    const data = new Uint8Array(400 * 300);
    for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) if ((x + 0.5 - 200) ** 2 + (y + 0.5 - 150) ** 2 <= 2500) data[y * 400 + x] = 255;
    e.command('Elliptical Marquee', (d) => applySelection(d, gridFromImage(e.assets.tiles, { width: 400, height: 300, data })));
  });
  await tool(page, 'Move Tool');
  await run(page, 'analysis.record');
  const log = page.locator('.panel-body[aria-label="Measurement Log"]');
  await expect(log).toBeVisible();
  await expect(log.locator('tbody tr')).toHaveCount(1);
  // Read the row by column header.
  const row = await log.locator('table').evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((h) => h.textContent!.trim());
    const cells = [...t.querySelectorAll('tbody tr:last-child > *')].map((c) => c.textContent!.trim());
    return Object.fromEntries(heads.map((h, i) => [h, cells[i]]));
  });
  expect(row.Source).toBe('Selection');
  expect(row['Scale Units']).toBe('cm');
  // Areas are in cm²: 100 px = 4 cm, so 1 px² = 0.0016 cm².
  expect(Number(row.Area) / 0.0016).toBeCloseTo(Math.PI * 2500, -2);
  expect(Number(row.Circularity)).toBeGreaterThan(0.95);
  // The disc is red: the gray mean of (224, 48, 48) is 101.
  expect(Number(row['Gray Mean'])).toBeCloseTo(101, 0);
});
