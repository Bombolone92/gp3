import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

function fixture(numFmtId, value, date1904 = false) {
  return otherProgramsXlsx({
    styles: {
      numFmts: ['<numFmt numFmtId="171" formatCode="0.000&quot; units&quot;"/>'],
      fills: ['<fill><patternFill patternType="solid"><fgColor rgb="FFABCDEF"/></patternFill></fill>'],
      cellXfs: ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'],
    },
    sheetXml: { Data: { rows: `<row r="1"><c r="A1"><v>${value}</v></c><c r="B1" s="0"><v>${value}</v></c><c r="C1" s="1"><v>${value}</v></c><c r="D1"><f>A1*2</f><v>${value * 2}</v></c></row>` } },
    patch: {
      '/xl/styles.xml': xml => xml.replace(/(<cellXfs[^>]*>)(<xf\b[^>]*\/?>)/, (_, head, xf) => head + xf.replace(/numFmtId="\d+"/, `numFmtId="${numFmtId}"`).replace(/fillId="\d+"/, 'fillId="2"')),
      '/xl/workbook.xml': xml => date1904 ? xml.replace(/<workbookPr\b[^>]*\/>/, '<workbookPr date1904="1"/>') : xml,
    },
  });
}

it.each([
  [40, -1234.5, '(1,234.50)'],
  [10, 0.125, '12.50%'],
  [171, 3.25, '3.250 units'],
])('uses XF zero when a materialized cell omits s (format %s)', async (id, value, display) => {
  const bytes = fixture(id, value);
  const raw = X.read(bytes, { type: 'array', cellNF: true, cellStyles: true });
  expect(raw.Sheets.Data.A1.z).toBe(raw.Sheets.Data.B1.z);
  expect(raw.Sheets.Data.A1.s).toEqual(raw.Sheets.Data.B1.s);
  const wb = await workbookFromFile(bytes);
  const check = book => {
    const sid = book.activeSheetId;
    expect(book.getDisplay(sid, 0, 0).trim()).toBe(display);
    expect(book.getDisplay(sid, 0, 1)).toBe(book.getDisplay(sid, 0, 0));
    expect(book.styleAt(sid, 0, 0).bg).toBe('#abcdef');
    expect(book.getDisplay(sid, 0, 2)).toBe(String(value));
    expect(book.styleAt(sid, 0, 2).bg).not.toBe('#abcdef');
    expect(book.getValue(sid, 0, 3)).toBe(value * 2);
    expect(book.styleAt(sid, 0, 3).fmt).toBe(book.styleAt(sid, 0, 0).fmt);
  };
  check(wb);
  wb.pasteCells(wb.activeSheetId, wb.copyCells(wb.activeSheetId, [0], [0]), 2, 4, { r: 0, c: 0 });
  expect(wb.getDisplay(wb.activeSheetId, 2, 4)).toBe(wb.getDisplay(wb.activeSheetId, 0, 0));
  const exported = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  check(await workbookFromFile(exported));
  const zip = X.CFB.read(exported, { type: 'array' }), part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
  check(await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })));
});

it('uses the default calendar format when normalizing the 1904 epoch', async () => {
  const wb = await workbookFromFile(fixture(14, 1, true));
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(1463);
  expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(1463);
  expect(wb.getValue(wb.activeSheetId, 0, 2)).toBe(1);
});
