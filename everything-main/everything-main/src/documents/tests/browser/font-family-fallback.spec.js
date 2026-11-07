import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
test('native family fallback paints with installed fonts and retains editing and declarations', async ({ page }, info) => {
  await page.addInitScript(() => {
    window.fallbackPaint = new Map();
    const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, ...rest) { const p = new DOMPoint(x, y).matrixTransform(this.getTransform()); window.fallbackPaint.set(text, { font: this.font, x: p.x, y: p.y }); return paint.call(this, text, x, y, ...rest); };
  });
  await page.goto('/playground.html');
  const available = await page.evaluate(async () => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    await Promise.all(['Calibri', 'Cambria'].map(checkFontAvailability)); return ['Calibri', 'Cambria'].every(fontAvailable);
  });
  test.skip(!available, 'Native reference requires installed Calibri and Cambria.');
  const source = 'public/fixtures/font-family-fallback.docx', parts = unzipSync(readFileSync(source));
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^1 Hamburgefontsiv/); await expect(input).toHaveJSProperty('readOnly', false);
  const original = await input.inputValue();
  const native = JSON.parse(readFileSync('tests/fixtures/font-family-fallback/reference.json'))['font-family-fallback'].rows;
  const painted = await page.evaluate(() => Object.fromEntries(window.fallbackPaint));
  for (const row of native.slice(0, 12)) {
    expect(painted[row.text].font).toContain(row.font);
    expect(Math.abs(painted[row.text].x * .75 - row.x)).toBeLessThan(.2);
    expect(Math.abs(painted[row.text].y * .75 - row.y)).toBeLessThan(.2);
  }
  expect(painted[native[10].text].font).toContain(native[10].font);
  const save = async name => { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click(); const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path; };
  const same = (file, edited = false) => { const actual = unzipSync(readFileSync(file)); if (edited) return expectBodyEditParts(actual, parts); expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort()); for (const name of Object.keys(parts)) expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])), name).toBe(true); };
  same(await save('noedit')); await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edited ');
  const edited = await save('edited'); same(edited, true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original); same(await save('undo'));
  await reopenDocx(page, input, edited, 'Edited ' + original); await expect(input).toHaveJSProperty('readOnly', false);
});
test('unavailable explicit alternative continues to the native family fallback', async ({ page }) => {
  await page.goto('/playground.html');
  const result = await page.evaluate(async () => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { loadCanvasFonts } = await import('/src/engine/canvas-text.js');
    const { displayedFont, fontAvailable } = await import('/src/engine/font-availability.js');
    const pkg = await DocxPackage.open(new Uint8Array(await (await fetch('/fixtures/font-family-fallback.docx')).arrayBuffer()));
    await loadCanvasFonts(pkg);
    return { available: fontAvailable('Calibri'), actual: displayedFont({ fontFamily: 'Codex Missing Face 010' }, pkg.styles.fontAlternatives) };
  });
  test.skip(!result.available, 'Native reference requires installed Calibri.');
  expect(result.actual).toBe('Calibri');
});
