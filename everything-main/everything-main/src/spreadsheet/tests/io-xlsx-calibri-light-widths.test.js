import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxColumnPixels } from '../src/core/xlsx-styles.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it.each([
  [8, 5], [11, 7], [16, 11], [24, 16],
])('uses Calibri Light digit metrics at %s points independently of column contents', (sz, mdw) => {
  // ISO 29500 column width conversion, including the 1/256-character
  // truncation of the half-pixel adjustment. Digit advances are 0.507em.
  for (const width of [0, 0.25, 1, 8.125, 13.6328125, 41.75, 255]) {
    const expected = Math.floor((256 * width + Math.floor(128 / mdw)) / 256 * mdw);
    expect(xlsxColumnPixels({ width }, { name: 'Calibri Light', sz })).toBe(expected);
    expect(xlsxColumnPixels({ width }, { name: 'CALIBRI LIGHT', sz })).toBe(expected);
  }
});

it('declines invalid sizes and absent widths instead of inventing font metrics', () => {
  for (const sz of [undefined, 0, -1, NaN, Infinity]) {
    expect(xlsxColumnPixels({ width: 12 }, { name: 'Calibri Light', sz })).toBeNull();
  }
  expect(xlsxColumnPixels({}, { name: 'Calibri Light', sz: 11 })).toBeNull();
  expect(xlsxColumnPixels({ width: 12 }, { name: 'Unknown family', sz: 11 })).toBeNull();
});

it.each([11, 16])('preserves explicit and default column geometry through native XLSX at %s points', async sz => {
  const input = otherProgramsXlsx({
    sheetXml: { Data: {
      head: '<sheetFormatPr defaultColWidth="12.25"/><cols>'
        + '<col min="1" max="1" width="3.25" customWidth="1"/>'
        + '<col min="2" max="3" width="21.75" customWidth="1"/></cols>',
      rows: '<row r="1"><c r="A1"><v>3</v></c><c r="B1"><v>7</v></c>'
        + '<c r="C1"><f>A1*B1</f><v>21</v></c></row>',
    } },
    patch: { '/xl/styles.xml': xml => xml.replace('<scheme val="minor"/>', '').replace('<sz val="12"/>', `<sz val="${sz}"/>`)
      .replace('<name val="Calibri"/>', '<name val="Calibri Light"/>') },
  });
  let wb = await workbookFromFile(input, 'dimensions.xlsx');
  const expected = sz === 11 ? [23, 152, 152, 86] : [36, 239, 239, 135];
  for (let pass = 0; pass < 2; pass++) {
    const s = wb.activeSheet;
    expect([0, 1, 2, 3].map(c => wb.colWidth(s.id, c))).toEqual(expected);
    expect(wb.getCell(s.id, 0, 0).s.font).toBe('font:Calibri Light');
    expect(wb.getValue(s.id, 0, 2)).toBe(21);
    if (pass) break;
    wb.setColWidth(s.id, 1, 98);
    expected[1] = 98;
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const zip = X.CFB.read(bytes, { type: 'array' });
    // Read exactly the native geometry another application sees, without
    // relying on the application's private metadata to repair the export.
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content)
      .replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  }
});

it('uses the same font metrics when only the default base character width is declared', async () => {
  const input = otherProgramsXlsx({
    sheetXml: { Data: { head: '<sheetFormatPr baseColWidth="9"/>', rows: '<row r="1"><c r="A1"><v>1</v></c></row>' } },
    patch: { '/xl/styles.xml': xml => xml.replace('<scheme val="minor"/>', '').replace('<sz val="12"/>', '<sz val="11"/>')
      .replace('<name val="Calibri"/>', '<name val="Calibri Light"/>') },
  });
  const wb = await workbookFromFile(input, 'base-width.xlsx');
  // Unlike defaultColWidth, baseColWidth excludes the five pixels of padding.
  expect(wb.colWidth(wb.activeSheetId, 0)).toBe(68);
});
