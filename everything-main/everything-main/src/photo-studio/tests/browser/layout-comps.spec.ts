import { expect, test, type Page } from '@playwright/test';
import { boot, compositePixel, downloadFrom, idle, openImage, panel, redo, run, start, undo } from './helpers';

/** A 200 × 150 canvas with a red solid square and a green pixel square. */
async function fixture(page: Page) {
  await openImage(page, 200, 150, '#ffffff');
  await page.evaluate(async () => {
    const e = window.photoStudio;
    const { layer } = await import('/src/model/document.ts');
    const { newPixelLayer } = await import('/src/model/pixel-layer.ts');
    const { gridFromImage } = await import('/src/model/tiles.ts');
    const red = layer('solid', 'Red', 20, 20);
    red.color = '#ff0000';
    red.transform = { x: 10, y: 10, width: 20, height: 20, rotation: 0 };
    const data = new Uint8ClampedArray(20 * 20 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([0, 255, 0, 255], i);
    const green = newPixelLayer('Green', e.doc, gridFromImage(e.assets.tiles, { width: 20, height: 20, data }, 100, 10));
    e.command('Fixture', (d) => d.layers.push(red, green));
  });
  await idle(page);
}
const layerState = (page: Page) =>
  page.evaluate(() => {
    const e = window.photoStudio;
    const red = e.doc.layers.find((l) => l.name === 'Red');
    const green = e.doc.layers.find((l) => l.name === 'Green')!;
    return { red: red?.visible, greenX: green.pixels!.x };
  });

async function newComp(page: Page, name: string) {
  await start(page, 'comps.new');
  const dialog = page.locator('dialog.comp-dialog[open]');
  await expect(dialog).toBeVisible();
  await dialog.locator('[name=name]').fill(name);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await idle(page);
}

test('layer comps capture, apply, warn and export', async ({ page }) => {
  await boot(page);
  await fixture(page);
  const body = await panel(page, 'Layer Comps');
  await expect(body.locator('.comps-empty')).toBeVisible();

  await newComp(page, 'Original');
  await page.evaluate(() => {
    const e = window.photoStudio;
    e.command('Edit layers', (d) => {
      d.layers.find((l) => l.name === 'Red')!.visible = false;
      const g = d.layers.find((l) => l.name === 'Green')!;
      g.transform = { ...g.transform, x: g.transform.x + 40 };
    });
  });
  await idle(page);
  expect(await layerState(page)).toEqual({ red: false, greenX: 40 });
  // Last Document State now holds the edited layers.
  await expect(body.locator('.comp-row.last-state .comp-apply')).toHaveAttribute('aria-pressed', 'true');
  await newComp(page, 'Moved');
  await expect(body.locator('.comp-row[data-comp]:not(.last-state)')).toHaveCount(2);
  await expect(body.locator('.comp-row', { hasText: 'Moved' }).locator('.comp-apply')).toHaveAttribute('aria-pressed', 'true');

  // Apply the first comp from its marker; the document is restored.
  await body.locator('.comp-row', { hasText: 'Original' }).locator('.comp-apply').click();
  await idle(page);
  expect(await layerState(page)).toEqual({ red: true, greenX: 0 });
  expect(await compositePixel(page, 20, 20)).toEqual([255, 0, 0, 255]);
  expect(await compositePixel(page, 110, 20)).toEqual([0, 255, 0, 255]);
  await expect(body.locator('.comp-row', { hasText: 'Original' }).locator('.comp-apply')).toHaveAttribute('aria-pressed', 'true');
  await undo(page);
  expect(await layerState(page)).toEqual({ red: false, greenX: 40 });
  await redo(page);
  expect(await layerState(page)).toEqual({ red: true, greenX: 0 });

  // Next wraps around; Last Document State returns to the state before applying.
  await run(page, 'comps.next');
  expect(await layerState(page)).toEqual({ red: false, greenX: 40 });
  await run(page, 'comps.next');
  expect(await layerState(page)).toEqual({ red: true, greenX: 0 });

  // Rename through the options dialog (double-click).
  await body.locator('.comp-row', { hasText: 'Moved' }).locator('.comp-name').dblclick();
  const options = page.locator('dialog.comp-dialog[open]');
  await expect(options).toBeVisible();
  await options.locator('[name=name]').fill('Shifted');
  await options.getByRole('button', { name: 'OK' }).click();
  await idle(page);
  await expect(body.locator('.comp-row', { hasText: 'Shifted' })).toHaveCount(1);

  // Export every comp as a PDF page, rendered with its layout.
  await start(page, 'file.export-comps-pdf');
  const pdfDialog = page.locator('dialog.page-export-dialog[open]');
  await expect(pdfDialog).toBeVisible();
  const pdf = await downloadFrom(page, () => pdfDialog.getByRole('button', { name: 'Export PDF' }).click());
  await idle(page);
  const text = pdf.bytes.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  expect(text).toContain('/Count 2');
  expect(pdf.name).toMatch(/\.pdf$/);

  // Deleting a layer leaves comps that cannot be fully restored.
  await page.evaluate(() => {
    const e = window.photoStudio;
    e.command('Delete', (d) => {
      d.layers = d.layers.filter((l) => l.name !== 'Red');
    });
  });
  await idle(page);
  await expect(body.locator('.comp-warning')).toHaveCount(2);
  await body.locator('.comp-row', { hasText: 'Shifted' }).locator('.comp-apply').click();
  await idle(page);
  await expect(page.locator('#status')).toContainText('could not restore 1 deleted layer');
  // Updating a comp recaptures it and clears its warning.
  await body.locator('.comp-row', { hasText: 'Shifted' }).locator('.comp-name').click();
  await run(page, 'comps.update');
  await expect(body.locator('.comp-warning')).toHaveCount(1);
  // Comps persist in the project.
  const saved = await page.evaluate(async () => {
    const e = window.photoStudio;
    const { serialize, deserialize } = await import('/src/model/serialization.ts');
    const back = await deserialize(await serialize(e.doc, e.assets));
    return back.document.layerComps?.map((c) => c.name);
  });
  expect(saved).toEqual(['Original', 'Shifted']);
  await run(page, 'comps.delete');
  await expect(body.locator('.comp-row', { hasText: 'Shifted' })).toHaveCount(0);
});
