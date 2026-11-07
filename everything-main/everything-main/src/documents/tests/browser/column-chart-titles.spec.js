import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const folder = 'tests/fixtures/column-chart-titles';
const references = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));

for (const ref of references) test(`matches native rich column title and plot bounds: ${ref.name}`, async ({ page }, info) => {
  test.setTimeout(120000);
  const source = `${folder}/${ref.name}.docx`, bytes = readFileSync(source);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/${ref.name}.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/percent/); await expect(input).toHaveJSProperty('readOnly', false);
  const actual = await page.evaluate(async ({ bytes, width, height }) => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { paintChart } = await import('/src/engine/canvas-charts.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg);
    const chart = Object.values(pkg.assets).find(asset => asset.chart).chart;
    const ctx = document.createElement('canvas').getContext('2d'), rectangles = [], labels = [];
    ctx.strokeRect = function(x, y, width, height) { rectangles.push({ color: this.strokeStyle, x, y, width, height }); };
    ctx.fillText = function(text, x, y) {
      const aligned = this.textBaseline, original = this.measureText('Mg').actualBoundingBoxAscent;
      this.textBaseline = 'alphabetic'; const alphabetic = this.measureText('Mg').actualBoundingBoxAscent; this.textBaseline = aligned;
      const advance = this.measureText(text).width;
      const transform = this.getTransform();
      labels.push({ text, x: (transform.a * (x - (this.textAlign === 'right' ? advance : this.textAlign === 'center' ? advance / 2 : 0)) + transform.e) * .75, baseline: (transform.d * (y + alphabetic - original) + transform.f) * .75 });
    };
    paintChart(ctx, chart, width * 4 / 3, height * 4 / 3);
    const plot = rectangles.find(r => r.color === '#b3b3b3' && r.width > 100);
    return { plot: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, plot[key] * .75])), labels };
  }, { bytes: bytes.toString('base64'), width: ref.frame.width, height: ref.frame.height });
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify({ actual, reference: ref }, null, 2));
  for (const key of ['x', 'y', 'width', 'height']) {
    const expected = ref.plot[key] - (key === 'x' || key === 'y' ? ref.frame[key] : 0);
    expect(Math.abs(actual.plot[key] - expected), key).toBeLessThan(.2);
  }
  for (const expected of ref.labels.filter(l => /^-?\d+%$/.test(l.text) || l.text === 'Q1' || l.baseline > ref.frame.y && l.baseline < ref.frame.y + 90 && !/^Q/.test(l.text) && !/^-?\d+%$/.test(l.text))) {
    const label = actual.labels.filter(l => l.text.trim() === expected.text.trim()).sort((a,b)=>Math.abs(a.baseline-(expected.baseline-ref.frame.y))-Math.abs(b.baseline-(expected.baseline-ref.frame.y)))[0]; expect(label).toBeDefined();
    expect(Math.abs(label.x - (expected.x - ref.frame.x)), expected.text + ' x').toBeLessThan(.2);
    expect(Math.abs(label.baseline - (expected.baseline - ref.frame.y)), expected.text + ' baseline').toBeLessThan(.2);
  }
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  writeFileSync(info.outputPath('page.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  const original = await input.inputValue(), parts = unzipSync(bytes);
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await pending).saveAs(path); return path;
  };
  const sameParts = actual => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort());
    for (const name of Object.keys(parts)) expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])), name).toBe(true);
  };
  sameParts(unzipSync(readFileSync(await save('noedit'))));
  await input.press('ControlOrMeta+End'); await page.keyboard.insertText(' EDIT');
  const path = await save('edited'), edited = unzipSync(readFileSync(path));
  expect(Object.keys(edited).sort()).toEqual(Object.keys(parts).sort());
  expectBodyEditParts(edited, parts);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  sameParts(unzipSync(readFileSync(await save('undo'))));
  await reopenDocx(page, input, path, original + ' EDIT');
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  await expect(page.locator('#playground-error')).toBeEmpty(); expect(errors).toEqual([]);
});
