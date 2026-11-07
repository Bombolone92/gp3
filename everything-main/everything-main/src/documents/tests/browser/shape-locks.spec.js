import { test, expect } from '@playwright/test';
import { reopenDocx } from './helpers/reopen-docx.js';

test('renders shapes with editing locks and preserves them through surrounding edits', async ({ page }, testInfo) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/shape-locks.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/\ufffc/);
  await expect(page.locator('#playground-error')).toBeEmpty();
  await expect(page.getByText('Read only', { exact: true })).toHaveCount(0);
  const original = await input.inputValue();
  const shapes = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/shape-locks.docx')).arrayBuffer()));
    const sizes = [], bitmaps = new Map();
    for (const [id, asset] of Object.entries(pkg.assets)) if (asset.bytes) bitmaps.set(id, await createImageBitmap(new Blob([asset.bytes], { type: asset.mime })));
    for (const asset of Object.values(pkg.assets).filter(a => a.scene)) {
      const decoded = await decodeShape(asset, bitmaps);
      sizes.push([decoded.bitmap.width, decoded.bitmap.height]); decoded.close();
    }
    for (const bitmap of bitmaps.values()) bitmap.close();
    return sizes;
  });
  expect(shapes).toHaveLength(3);
  for (const [width, height] of shapes) { expect(width).toBeGreaterThan(100); expect(height).toBeGreaterThan(100); }
  await page.screenshot({ path: testInfo.outputPath('shape-locks.png'), fullPage: true });
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('shape-locks.docx'); await (await pending).saveAs(saved);
  await reopenDocx(page, input, saved, 'Edited ' + original);
});
