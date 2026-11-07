import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { fontName } from '../src/core/format.js';
import * as X from '../src/vendor/xlsx.mjs';
import { rowFontMetricsXlsx } from './helpers/xlsx-row-font-metrics-fixture.js';

// Own generated control opened, saved and explicitly AutoFit in Excel for Mac.
// These are native cache references, never inputs to the app's fitter.
const excel = readFileSync(new URL('./fixtures/reference-row-font-content.xlsx', import.meta.url));
const options = {
  families: ['Arial', 'Courier New', 'Geneva'], sizes: [11, 16, 28], lineCounts: [1, 2],
  fontStyles: [{}, { bold: true }, { italic: true }, { bold: true, italic: true }],
  samples: ['iiii', 'ÉÅgj', '漢字 😀', 'tail\n'],
};
const cases = rowFontMetricsXlsx(options).cases;
function verify(wb) {
  expect(wb.sheets).toHaveLength(3);
  expect(cases).toHaveLength(288);
  for (const c of cases) {
    const sheet = wb.sheetByName(c.sheet), style = wb.styleAt(sheet.id, c.row - 1, 0);
    expect(fontName(style.font)).toBe(c.family);
    expect(style.size).toBeCloseTo(c.size * 4 / 3);
    expect(!!style.bold).toBe(c.bold);
    expect(!!style.italic).toBe(c.italic);
    expect(style.wrap).toBe(true);
    expect(wb.getValue(sheet.id, c.row - 1, 0)).toBe(c.value);
    expect(sheet.rowHeightModes.get(c.row - 1)).toBe('auto');
    const first = cases.find(other => other.family === c.family && other.size === c.size && other.lines === 1);
    // Including empty final lines, native fitting uses the same increment for
    // each explicit line regardless of these characters, bold or italic.
    expect(wb.rowHeight(sheet.id, c.row - 1)).toBeCloseTo(wb.rowHeight(sheet.id, first.row - 1) * c.lines);
  }
}

it('retains Excel automatic caches across characters, font faces and trailing empty lines', async () => {
  const wb = await workbookFromFile(excel);
  verify(wb);
  const height = family => {
    const c = cases.find(c => c.family === family && c.size === 16 && c.lines === 1);
    return wb.rowHeight(wb.sheetByName(c.sheet).id, c.row - 1) * 3 / 4;
  };
  expect(options.families.map(height)).toEqual([21, 23, 22]);
});

it('preserves native font/content caches through two XLSX cycles without private metadata', async () => {
  let wb = await workbookFromFile(excel);
  const original = wb;
  for (let cycle = 0; cycle < 2; cycle++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content)
      .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    verify(wb);
    for (const c of cases) {
      expect(wb.rowHeight(wb.sheetByName(c.sheet).id, c.row - 1))
        .toBeCloseTo(original.rowHeight(original.sheetByName(c.sheet).id, c.row - 1));
    }
  }
});

it('generates configurable literal fonts and safely encoded measurement samples', async () => {
  const input = rowFontMetricsXlsx({ families: ['Font & "Quoted"'], sizes: [13.5], lineCounts: [1, 3],
    fontStyles: [{ bold: true, italic: true }], samples: ['<text> & "sample"\n'], normal: { name: 'Arial', size: 10 } });
  const wb = await workbookFromFile(input.bytes);
  expect(input.cases.map(c => c.lines)).toEqual([2, 6]);
  for (const c of input.cases) {
    const sheet = wb.sheetByName(c.sheet);
    expect(wb.getValue(sheet.id, c.row - 1, 0)).toBe(c.value);
    expect(wb.styleAt(sheet.id, c.row - 1, 0)).toMatchObject({ bold: true, italic: true, size: 18 });
    expect(fontName(wb.styleAt(sheet.id, c.row - 1, 0).font)).toBe(c.family);
    expect(wb.rowHeight(sheet.id, c.row - 1)).toBeCloseTo(4 / 3);
  }
});
