import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

for (const [mode, expected] of [
  ['default', ['Default 1', 'Default 2', 'Default 3']],
  ['first-hidden', [null, 'Default 2', 'Default 3']],
  ['variants', ['First 1', 'Even 2', 'Default 3']],
]) test(`paints native ${mode} footers and preserves the original download`, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.footerPaint = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...args) {
      if (/^(Default|First|Even) /.test(text)) {
        // Painting may translate/scale text to retain fractional font advances.
        // Compare actual canvas coordinates, normalized to CSS pixels.
        const point = this.getTransform().transformPoint(new DOMPoint(x, y));
        const scale = devicePixelRatio;
        window.footerPaint.push({text, x: point.x / scale, y: point.y / scale, canvas: this.canvas});
      }
      return original.call(this, text, x, y, ...args);
    };
  });
  await page.goto('/playground.html');
  const referenceFont = await page.evaluate(async () => {
    try { await new FontFace('native reference', 'local("Arial")').load(); return true; }
    catch { return false; }
  });
  const source = `tests/fixtures/page-stories/footer-${mode}.docx`;
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(3);
  const input = page.getByRole('textbox', {name:'Document text'});
  await expect(input).toHaveValue('Body page 1\nBody page 2\nBody page 3');
  const painted = await page.evaluate(() => [...document.querySelectorAll('canvas.canvas-page')].map(canvas => {
    const last = window.footerPaint.findLast(entry => entry.canvas === canvas);
    return last ? {text:last.text, x:last.x, y:last.y} : null;
  }));
  expect(painted.map(entry => entry?.text ?? null)).toEqual(expected);
  // The reference PDF baseline is 753.84 pt; PDF points are 3/4 canvas CSS pixels.
  for (const entry of painted.filter(Boolean)) if (referenceFont) expect(Math.abs(entry.y * .75 - 753.84)).toBeLessThan(.2);
  const defaultFooter = painted.find(entry => entry?.text.startsWith('Default'));
  if (referenceFont && defaultFooter) expect(Math.abs(defaultFooter.x * .75 - 496.06)).toBeLessThan(.1);
  for (let i=0;i<3;i++) {
    const data=await page.locator('canvas.canvas-page').nth(i).evaluate(canvas=>canvas.toDataURL());
    writeFileSync(testInfo.outputPath(`page-${i+1}.png`),Buffer.from(data.split(',')[1],'base64'));
  }
  const pending = page.waitForEvent('download');
  await page.getByRole('button', {name:'Download .docx',exact:true}).click();
  const saved = testInfo.outputPath(`footer-${mode}.docx`); await (await pending).saveAs(saved);
  expect(unzipSync(readFileSync(saved))).toEqual(unzipSync(readFileSync(source)));
  expect(errors).toEqual([]);
});
