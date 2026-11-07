import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { reopenDocx } from './helpers/reopen-docx.js';

test('keeps text size and insets fixed through group scaling, editing and export', async ({ page }, testInfo) => {
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles('public/fixtures/group-text-scaling.docx');
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Group text scaling/);
  await expect(page.locator('#playground-error')).toBeEmpty();
  const results = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { decodeShape } = await import('/src/engine/canvas-shapes.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/group-text-scaling.docx')).arrayBuffer()));
    const original = OffscreenCanvasRenderingContext2D.prototype.fillText;
    const results = []; let calls;
    OffscreenCanvasRenderingContext2D.prototype.fillText = function(text, x, y) {
      const m = this.getTransform();
      calls.push({ text, font: this.font, x: (m.a * x + m.e) / 2, y: (m.d * y + m.f) / 2, sx: m.a / 2, sy: m.d / 2 });
      return original.call(this, text, x, y);
    };
    try {
      for (const asset of Object.values(pkg.assets).filter(a => a.scene)) {
        calls = [];
        const decoded = await decodeShape(asset, new Map());
        const canvas = document.createElement('canvas'); canvas.width = decoded.bitmap.width; canvas.height = decoded.bitmap.height;
        canvas.getContext('2d').drawImage(decoded.bitmap, 0, 0);
        results.push({ calls, left: decoded.left, top: decoded.top, width: decoded.width, height: decoded.height, image: canvas.toDataURL() });
        decoded.close();
      }
    } finally { OffscreenCanvasRenderingContext2D.prototype.fillText = original; }
    return results;
  });
  expect(results).toHaveLength(4);
  for (const [i, result] of results.entries()) {
    expect(result.calls.length).toBeGreaterThan(1); // Text wraps inside a three-inch frame.
    expect(result.calls.map(c => c.text)).toEqual(results[0].calls.map(c => c.text));
    for (const call of result.calls) {
      // Native outline painting may increase the font em and inversely scale
      // the canvas. Assert physical text size, not the temporary paint em.
      const em = Number(call.font.match(/([\d.]+)px/)?.[1]);
      expect(em * call.sx).toBeCloseTo(16); expect(em * call.sy).toBeCloseTo(16);
      expect(call.x + result.left).toBeCloseTo(16); // 12 pt absolute left inset.
    }
    expect(result.width).toBe(288); expect(result.height).toBe(96);
    writeFileSync(testInfo.outputPath(`shape-${i}.png`), Buffer.from(result.image.split(',')[1], 'base64'));
  }
  expect(results[1].calls).toEqual(results[0].calls);
  const middle = results[2].calls[0].y - results[0].calls[0].y;
  expect(middle).toBeGreaterThan(0);
  expect(results[3].calls[0].y - results[0].calls[0].y).toBeCloseTo(middle * 2);
  await page.screenshot({ path: testInfo.outputPath('group-text-scaling.png'), fullPage: true });
  const original = await input.inputValue();
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = testInfo.outputPath('group-text-scaling.docx'); await (await pending).saveAs(saved);
  await reopenDocx(page, input, saved, 'Edited ' + original);
});
