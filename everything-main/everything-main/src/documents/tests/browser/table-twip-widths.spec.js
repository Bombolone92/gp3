import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const folder = 'tests/fixtures/table-twip-widths/';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const stem of ['control','percentages']) test(`whole-twip allocations and native wrapping: ${stem}`, async ({ page }, info) => {
  const ref = JSON.parse(readFileSync(folder + (stem === 'control' ? 'reference.json' : 'percentages-reference.json')));
  const source = folder + stem + '.docx', bytes = readFileSync(source), original = unzipSync(bytes);
  expect(hash(bytes)).toBe(ref.sourceSha256); expect(hash(readFileSync(folder + (stem === 'control' ? 'native.pdf' : 'percentages-native.pdf')))).toBe(ref.pdfSha256);
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^Case 1:/); await expect(input).toHaveJSProperty('readOnly', false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
  const check = async bytes => {
    const actual = await page.evaluate(async bytes => {
      const { DocxPackage } = await import('/src/engine/docx.js');
      const { layoutDocument } = await import('/src/engine/layout.js');
      const { pageGeometry } = await import('/src/engine/page-settings.js');
      const { validateCanvasLayout, measureCanvasText } = await import('/src/engine/canvas-text.js');
      const p = await DocxPackage.open(new Uint8Array(bytes)); await validateCanvasLayout(p);
      const ctx = document.createElement('canvas').getContext('2d');
      const l = layoutDocument(p.paragraphs, (t,s) => measureCanvasText(ctx,t,s), pageGeometry(p.pageSettings), p.numbering,p.tables);
      return p.tables.map(t => t.rows[0].cells.map(c => {
        const box = l.cells.find(b => b.id === c.id);
        return { page: box.page, widthTwips: box.width * 15, lines: l.lines.filter(l => l.cellId === c.id).map(l => l.fragments.map(f => f.text).join('').trim()) };
      }));
    }, [...bytes]);
    expect(actual).toHaveLength(ref.cases.length);
    for (const [i, sample] of ref.cases.entries()) for (const [j, cell] of sample.cells.entries()) {
      expect(actual[i][j].page).toBe(i);
      expect(actual[i][j].widthTwips, `case ${i+1} cell ${j+1}`).toBeCloseTo(cell.widthTwips, 5);
      expect(actual[i][j].lines, `case ${i+1} cell ${j+1}`).toEqual(cell.lines);
    }
  };
  await check(bytes);
  const text = await input.inputValue();
  const download = async name => { const pending = page.waitForEvent('download'); await page.getByRole('button', {name:'Download .docx',exact:true}).click(); const path = info.outputPath(name+'.docx'); await (await pending).saveAs(path); return path; };
  expect(unzipSync(readFileSync(await download('noedit')))).toEqual(original);
  await input.focus(); await input.press('ControlOrMeta+Home'); await page.keyboard.insertText('Test ');
  const editedText = await input.inputValue(), editedPath = await download('edited'), edited = readFileSync(editedPath), parts = unzipSync(edited);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name]).toEqual(original[name]);
  await check(edited);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(text);
  expect(unzipSync(readFileSync(await download('undo')))).toEqual(original);
  page.once('dialog', d=>d.accept()); await page.getByLabel('Open DOCX file').setInputFiles(editedPath);
  await expect(input).toHaveValue(editedText); await expect(input).toHaveJSProperty('readOnly',false);
  await expect(page.locator('canvas.canvas-page')).toHaveCount(ref.cases.length);
});
