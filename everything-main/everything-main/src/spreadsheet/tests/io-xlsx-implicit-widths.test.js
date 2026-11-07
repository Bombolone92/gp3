import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

function fixture(name, size, head) {
  return otherProgramsXlsx({ sheetXml: { Data: { head,
    rows: '<row r="1"><c r="A1"><v>17</v></c><c r="B1"><f>A1*2</f><v>34</v></c></row>',
  } }, patch: { '/xl/styles.xml': s => s.replace('<scheme val="minor"/>', '').replace('<name val="Calibri"/>', `<name val="${name}"/>`)
    .replace('<sz val="12"/>', `<sz val="${size}"/>`) } });
}

async function cycle(wb, metadata = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const sheet = get('/xl/worksheets/sheet1.xml');
  if (!metadata) X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml')
    .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  return { sheet, wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })) };
}

it.each([
  ['Calibri', 11, 75, 61], ['Calibri', 12, 85, 69], ['Arial', 16, 125, 101],
  ['Geneva', 10, 95, 77], ['Unavailable family', 13, 105, 85],
])('resolves omitted format properties and omitted base width separately for %s %s', async (name, size, absent, present) => {
  // Excel initializes a missing sheetFormatPr with a ten-character base.
  // A present element instead has the schema's eight-character base default.
  for (const [head, expected] of [['', absent], ['<sheetFormatPr defaultRowHeight="15"/>', present]]) {
    let wb = await workbookFromFile(fixture(name, size, head));
    expect(wb.activeSheet.defaultColWidth).toBe(expected);
    expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(34);
    for (const metadata of [true, false, false]) {
      const result = await cycle(wb, metadata); wb = result.wb;
      expect(wb.activeSheet.defaultColWidth).toBe(expected);
      // Keeping the absent format element preserves both native defaults.
      expect(result.sheet.includes('<sheetFormatPr ')).toBe(!!head);
      expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(34);
    }
    wb.setColWidth(wb.activeSheetId, 1, 137);
    const copy = new Workbook(wb.toJSON()), back = (await cycle(copy)).wb;
    expect(back.colWidth(back.activeSheetId, 1)).toBe(137);
    expect(back.colWidth(back.activeSheetId, 2)).toBe(expected);
  }
});

it.each([
  ['baseColWidth="9"', 68], ['defaultColWidth="13.5" baseColWidth="9"', 94],
  ['baseColWidth="invalid"', 61],
])('keeps explicit width precedence and uses the schema base for malformed input: %s', async (attrs, expected) => {
  const wb = await workbookFromFile(fixture('Calibri', 11, `<sheetFormatPr defaultRowHeight="15" ${attrs}/>`));
  expect(wb.activeSheet.defaultColWidth).toBe(expected);
});

it('keeps app-authored default widths and explicit per-column widths independent of native defaults', async () => {
  const wb = new Workbook(), before = wb.activeSheet.defaultColWidth;
  const saved = await cycle(wb);
  expect(saved.wb.activeSheet.defaultColWidth).toBe(before);
  const imported = await workbookFromFile(fixture('Calibri', 11, '<cols><col min="2" max="2" width="20" customWidth="1"/></cols>'));
  expect(imported.colWidth(imported.activeSheetId, 1)).toBe(140);
  expect(imported.colWidth(imported.activeSheetId, 0)).toBe(75);
  const back = (await cycle(imported)).wb;
  expect(back.colWidth(back.activeSheetId, 1)).toBe(140);
  expect(back.colWidth(back.activeSheetId, 0)).toBe(75);
});

it.each([
  ['', 75, 10.625, 10.875],
  ['<sheetFormatPr defaultRowHeight="15"/>', 61, 8.625, 8.875],
])('preserves explicit widths one pixel either side of the native default: %s', async (head, base, narrow, wide) => {
  let wb = await workbookFromFile(fixture('Calibri', 11, head + '<cols>'
    + `<col min="2" max="3" width="${narrow}"/><col min="4" max="5" width="${wide}"/></cols>`));
  for (let pass = 0; pass < 3; pass++) {
    expect([0, 1, 2, 3, 4, 5].map(c => wb.colWidth(wb.activeSheetId, c)))
      .toEqual([base, base - 1, base - 1, base + 1, base + 1, base]);
    wb = (await cycle(new Workbook(wb.toJSON()), pass === 0)).wb;
  }
});
