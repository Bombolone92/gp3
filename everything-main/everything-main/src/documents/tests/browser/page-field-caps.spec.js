import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
const refs = JSON.parse(readFileSync('tests/fixtures/page-field-caps/reference.json', 'utf8'));
for (const ref of refs) test(`paints native page-field capitalization and locked results: ${ref.format}`, async ({ page }, info) => {
  const path = `public/fixtures/${ref.fixture}.docx`, bytes = readFileSync(path);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`tests/fixtures/page-field-caps/${ref.fixture}-native.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  await page.addInitScript(() => {
    window.fieldPaint = new Map();
    const rect = CanvasRenderingContext2D.prototype.fillRect, text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillRect = function(x,y,w,h) { if (x === 0 && y === 0 && w > 500 && h > 500) window.fieldPaint.set(this.canvas, []); return rect.call(this,x,y,w,h); };
    CanvasRenderingContext2D.prototype.fillText = function(value,x,y,...args) {
      const point = this.getTransform().transformPoint({ x, y });
      // Canvas translations round to float32; group baselines to .001 CSS px.
      window.fieldPaint.get(this.canvas)?.push({ text: value, x: point.x / devicePixelRatio, y: Math.round(point.y / devicePixelRatio * 1e3) / 1e3, font: this.font });
      return text.call(this,value,x,y,...args);
    };
  });
  await page.goto('/playground.html'); await page.getByLabel('Open DOCX file').setInputFiles(path);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue('Body one\nBody two'); await expect(input).toHaveJSProperty('readOnly', false);
  const canvases = page.locator('canvas.canvas-page'); await expect(canvases).toHaveCount(2);
  const painted = await page.evaluate(() => [...document.querySelectorAll('canvas.canvas-page')].map(c => {
    const fragments = (window.fieldPaint.get(c) || []).filter(f => f.y < 300), lines = new Map();
    for (const f of fragments) { const row = lines.get(f.y) || []; row.push(f); lines.set(f.y,row); }
    return { fragments, lines: [...lines].sort(([a],[b]) => a-b).map(([,row]) => row.sort((a,b) => a.x-b.x).map(f => f.text).join('').trim()) };
  }));
  const numbers = { lowerRoman: ['i','ii'], upperRoman: ['I','II'], lowerLetter: ['a','b'] }[ref.format];
  painted.forEach((p,i) => {
    expect(p.lines).toEqual(ref.pages[i]);
    const fields = p.fragments.filter(f => f.text.trim() === numbers[i]); expect(fields.length).toBeGreaterThanOrEqual(12);
    // The native reference's generated numerals retain the full 16pt size even among small caps.
    for (const f of fields) expect(Number(/([\d.]+)px/.exec(f.font)[1]) * .75).toBeCloseTo(16, 1);
  });
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
  const saved = info.outputPath(`${ref.fixture}.docx`); await (await pending).saveAs(saved); expect(unzipSync(readFileSync(saved))).toEqual(unzipSync(bytes));
});
