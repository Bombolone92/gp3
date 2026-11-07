import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { reopenDocx } from './helpers/reopen-docx.js';
const folder = 'tests/fixtures/autofit-cell-preferences';
const references = JSON.parse(readFileSync(`${folder}/reference.json`, 'utf8'));

for (const ref of references) test(`matches native content-aware cell preferences: ${ref.name}`, async ({ page }, info) => {
  test.setTimeout(120000);
  const source = `${folder}/${ref.name}.docx`, bytes = readFileSync(source), errors = [];
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(`${folder}/${ref.name}.pdf`)).digest('hex')).toBe(ref.pdfSha256);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/playground.html');
  await page.getByLabel('Open DOCX file').setInputFiles(source);
  const input = page.getByRole('textbox', { name: 'Document text' });
  await expect(input).toHaveValue(/^AutoFit preference/); await expect(input).toHaveJSProperty('readOnly', false);
  const actual = await page.evaluate(async bytes => {
    const { DocxPackage } = await import('/src/engine/docx.js');
    const { layoutDocument } = await import('/src/engine/layout.js');
    const { pageGeometry } = await import('/src/engine/page-settings.js');
    const { loadCanvasFonts, measureCanvasText } = await import('/src/engine/canvas-text.js');
    const pkg = await DocxPackage.open(Uint8Array.from(atob(bytes), c => c.charCodeAt(0)));
    await loadCanvasFonts(pkg); const ctx = document.createElement('canvas').getContext('2d');
    const placed = layoutDocument(pkg.paragraphs, (t, s) => measureCanvasText(ctx, t, s), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
    return pkg.tables.map(t => t.rows[0].cells.map(c => {
      const cell = placed.cells.find(b => b.id === c.id);
      return { x: cell.x * .75, width: cell.width * .75, page: cell.page };
    }));
  }, bytes.toString('base64'));
  writeFileSync(info.outputPath('geometry.json'), JSON.stringify({ actual, reference: ref }, null, 2));
  expect(actual).toHaveLength(ref.cases.length);
  for (const [i, row] of actual.entries()) for (const [j, cell] of row.entries()) {
    expect(cell.page).toBe(i);
    for (const key of ['x', 'width']) expect(Math.abs(cell[key] - ref.cases[i][j][key]), `case ${i + 1} cell ${j + 1} ${key}`).toBeLessThan(.2);
  }
  await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
  const pixels = await page.locator('canvas.canvas-page').evaluateAll((pages, cases) => cases.map((row, i) => row.map(cell => {
    const c = pages[i], scale = c.width / 612, ctx = c.getContext('2d');
    return [cell.x + 2, cell.x + cell.width - 2].map(x => [...ctx.getImageData(Math.round(x * scale), Math.round((cell.top + 20) * scale), 1, 1).data].slice(0, 3));
  })), ref.cases);
  for (const row of pixels) expect(row).toEqual([Array(2).fill([51, 102, 153]), Array(2).fill([204, 102, 51])]);
  writeFileSync(info.outputPath('page.png'), Buffer.from(await page.locator('canvas.canvas-page').last().evaluate(c => c.toDataURL().split(',')[1]), 'base64'));
  const original = await input.inputValue(), parts = unzipSync(bytes);
  const save = async name => {
    const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download .docx', exact: true }).click();
    const path = info.outputPath(`${name}.docx`); await (await pending).saveAs(path); return path;
  };
  expect(unzipSync(readFileSync(await save('noedit')))).toEqual(parts);
  await input.press('ControlOrMeta+End'); await page.keyboard.insertText(' EDIT');
  const edited = await save('edited'), changed = unzipSync(readFileSync(edited));
  expect(Object.keys(changed).sort()).toEqual(Object.keys(parts).sort());
  for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(changed[name], name).toEqual(parts[name]);
  await input.press('ControlOrMeta+z'); await expect(input).toHaveValue(original);
  expect(unzipSync(readFileSync(await save('undo')))).toEqual(parts);
  await reopenDocx(page, input, edited, original + ' EDIT'); await expect(page.locator('canvas.canvas-page')).toHaveCount(8);
  await expect(page.locator('#playground-error')).toBeEmpty(); expect(errors).toEqual([]);
});
