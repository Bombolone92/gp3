import { test, expect } from '@playwright/test';
import { reopenDocx } from './helpers/reopen-docx.js';

test('paints ellipse curves and retains them through editing and reopening', async ({ page }, info) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/ellipses.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Ellipse geometry/);
  await expect(page.locator('#playground-error')).toBeEmpty();
  const pixels = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/ellipses.docx')).arrayBuffer()));
    const asset = Object.values(pkg.assets).find(a => a.scene);
    const decoded = await decodeShape(asset, new Map());
    const c = new OffscreenCanvas(decoded.bitmap.width, decoded.bitmap.height), ctx = c.getContext('2d');
    ctx.drawImage(decoded.bitmap, 0, 0);
    const sample = (x, y) => [...ctx.getImageData(Math.round((x - decoded.left) * 2), Math.round((y - decoded.top) * 2), 1, 1).data];
    const result = { corner: sample(1, 1), center: sample(144, 48), edge: sample(144, 0) };
    decoded.close(); return result;
  });
  expect(pixels.corner[3]).toBe(0);
  expect(pixels.center).toEqual([41, 163, 106, 255]);
  expect(pixels.edge).toEqual([32, 64, 208, 255]);
  await page.screenshot({ path: info.outputPath('ellipses.png'), fullPage: true });
  const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const output = info.outputPath('ellipses.docx'); await (await pending).saveAs(output);
  await reopenDocx(page, input, output, 'Edited ' + original);
});

test('clips overflowing shape text to the native text frame', async ({ page }) => {
  await page.goto('/playground.html');
  const result = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/shape-text-overflow.docx')).arrayBuffer()));
    const asset = Object.values(pkg.assets).filter(a => a.scene)[2];
    const decoded = await decodeShape(asset, new Map());
    const c = new OffscreenCanvas(decoded.bitmap.width, decoded.bitmap.height), ctx = c.getContext('2d'); ctx.drawImage(decoded.bitmap, 0, 0);
    let outside = 0, inside = 0;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (data[i + 3] > 200 && data[i] < 30 && data[i + 1] < 30 && data[i + 2] < 30) {
        const px = x / 2 + decoded.left, py = y / 2 + decoded.top;
        // The native reference's captured text-frame clip, rounded outward by one device pixel.
        if (px < 8 || px > 43 || py < 13 || py > 38) outside++; else inside++;
      }
    }
    decoded.close(); return { outside, inside };
  });
  expect(result.outside).toBe(0); expect(result.inside).toBeGreaterThan(5);
});
