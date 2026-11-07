import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

const folder = 'tests/fixtures/table-row-keep-next/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const sample of reference.cases) test(`first-cell row keep: ${sample.name}`, async ({ page }, testInfo) => {
  const source = folder + sample.name + '.docx', bytes = readFileSync(source);
  expect(hash(bytes)).toBe(sample.sourceSha256);
  expect(hash(readFileSync(folder + sample.name + '.pdf'))).toBe(sample.pdfSha256);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/Final label\nTail$/);
  await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(sample.pages);
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const pkg = await DocxPackage.open(new Uint8Array(bytes));
    await validateCanvasLayout(pkg);
    const ctx = document.createElement('canvas').getContext('2d');
    return layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables).lines.map(l => ({
      text: l.fragments.map(f => f.text).join(''), page: l.page, x: l.stops[0]?.x * .75, baseline: l.baseline * .75,
    }));
  }, [...bytes]);
  for (const native of sample.lines) {
    const line = actual.find(l => l.text === native.text);
    expect(line, native.text).toBeTruthy();
    expect(line.page, native.text).toBe(native.page);
    expect(Math.abs(line.x - native.x), native.text).toBeLessThan(.2);
    expect(Math.abs(line.baseline - native.baseline), native.text).toBeLessThan(.2);
  }
  const originalText = await input.inputValue(), original = unzipSync(bytes);
  const download = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = testInfo.outputPath(name + '.docx');
    await (await pending).saveAs(path); return path;
  };
  const compare = (path, edited = false) => {
    const parts = unzipSync(readFileSync(path));
    expect(Object.keys(parts).sort()).toEqual(Object.keys(original).sort());
    for (const name of Object.keys(original)) if (!edited || name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(original[name])), name).toBe(true);
  };
  compare(await download('noedit'));
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Test ');
  const editedText = await input.inputValue(), edited = await download('edited'); compare(edited, true);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(originalText); compare(await download('undo'));
  page.once('dialog', d => d.accept());
  await page.getByLabel('Open DOCX file').setInputFiles(edited);
  await expect(input).toHaveValue(editedText); await expect(input).toHaveJSProperty('readOnly', false);
});
