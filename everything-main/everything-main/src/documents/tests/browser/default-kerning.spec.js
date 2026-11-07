import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/default-kerning/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const sameParts = (actual, expected, except = []) => {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true);
};
for (const ref of reference.cases) test(`matches native default kerning and preserves edits: ${ref.name}`, async ({ page }, info) => {
  const source = folder + ref.name + '.docx', errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  const available = await page.evaluate(async () => {
    const { checkFontAvailability, fontAvailable } = await import('/src/engine/font-availability.js');
    await Promise.all(['Arial', 'Times New Roman'].map(checkFontAvailability));
    return ['Arial', 'Times New Roman'].every(fontAvailable);
  });
  test.skip(!available, 'Native geometry requires installed Arial and Times New Roman.');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^AVATAR/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(1);
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes)); await validateCanvasLayout(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    return layoutDocument(pkg.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(pkg.pageSettings)).lines.map(l => ({
      text: l.fragments.map(f => f.text).join(''), baseline: l.baseline * .75,
      lastOrigin: l.stops.find(s => s.offset === l.end - 1).x * .75,
    }));
  }, [...readFileSync(source)]);
  expect(actual).toHaveLength(ref.lines.length);
  for (const [i, line] of actual.entries()) {
    expect(line.text).toBe(ref.lines[i].text);
    expect(Math.abs(line.baseline - ref.lines[i].baseline)).toBeLessThan(.2);
    // The final period has no following pair. Internal carets are not PDF
    // glyph origins for kerned pairs, so compare this measured line extent.
    expect(Math.abs(line.lastOrigin - ref.lines[i].glyphs.at(-1)), `row ${i}`).toBeLessThan(.3);
  }
  writeFileSync(info.outputPath('actual.json'), JSON.stringify(actual));
  writeFileSync(info.outputPath('page.png'), Buffer.from(await page.locator('canvas.canvas-page').evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  const original = await input.inputValue(), parts = unzipSync(readFileSync(source));
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(name + '.docx'); await (await pending).saveAs(path); return path;
  };
  sameParts(unzipSync(readFileSync(await save('noedit'))), parts);
  await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Edit ');
  const edited = await save('edited'); sameParts(unzipSync(readFileSync(edited)), parts, ['word/document.xml']);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  sameParts(unzipSync(readFileSync(await save('undo'))), parts);
  await reopenDocx(page, input, edited, 'Edit ' + original); await expect(input).toHaveJSProperty('readOnly', false);
  expect(errors).toEqual([]);
});
