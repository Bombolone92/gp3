import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxPrint } from '../src/core/xlsx-print.js';
import { normalizePrintSettings } from '../src/core/print-settings.js';

const title = (Ref, Sheet = 0) => ({ Name: '_xlnm.Print_Titles', Ref, Sheet });
const read = (names, name = "Q's, totals", i = 0) => readXlsxPrint('<worksheet><pageSetup/></worksheet>', names, name, i);
const rewrite = (zip, path, fn) => { const part = X.CFB.find(zip, path); part.content = new TextEncoder().encode(fn(new TextDecoder().decode(part.content))); part.size = part.content.length; };

it('reads sheet-scoped, quoted whole-row and whole-column titles independently of their order', () => {
  for (const Ref of ["'Q''s, totals'!$2:$5,'Q''s, totals'!$C:$E", "('Q''s, totals'!$C:$E,'Q''s, totals'!$2:$5)"]) {
    expect(read([title(Ref)])).toMatchObject({ titleRows: [1, 4], titleCols: [2, 4] });
  }
  expect(read([title('Other!$1:$2', 1), title("'Q''s, totals'!$7:$7")])).toMatchObject({ titleRows: [6, 6] });
  expect(read([title('Other!$1:$2', 1)], 'Other', 1)).toMatchObject({ titleRows: [0, 1] });
});

it.each(['Other!$1:$2', "'First:Last'!$1:$2", "SUM('Q''s, totals'!$1:$2)", '$A$1:$B$2', '$1:$1048577', '$XFE:$XFF', '#REF!'])('ignores invalid title reference %s', Ref => {
  expect(read([title(Ref)]).titleRows).toBeUndefined();
  expect(read([title(Ref)]).titleCols).toBeUndefined();
});

it('validates and copies title endpoints without coercion or out-of-bounds expansion', () => {
  for (const titleRows of [[-1, 2], [2, 1], [0, 1048576], [0.5, 1], ['0', 1], [0], null]) expect(normalizePrintSettings({ titleRows }).titleRows).toBeUndefined();
  expect(normalizePrintSettings({ titleRows: [0, 1048575], titleCols: [0, 16383] })).toMatchObject({ titleRows: [0, 1048575], titleCols: [0, 16383] });
  expect(normalizePrintSettings({ titleCols: [0, 16384] }).titleCols).toBeUndefined();
  const titleRows = [2, 4], settings = normalizePrintSettings({ titleRows }); titleRows[0] = 0;
  expect(settings.titleRows).toEqual([2, 4]);
});

it('tracks structural edits on each axis, including deletion of the entire title and undo', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', printSettings: { titleRows: [2, 4], titleCols: [1, 2] } }] }), id = wb.activeSheetId;
  const before = structuredClone(wb.activeSheet.printSettings);
  wb.insertRows(id, 1, 2); expect(wb.activeSheet.printSettings.titleRows).toEqual([4, 6]); expect(wb.activeSheet.printSettings.titleCols).toEqual([1, 2]); wb.undo();
  wb.insertRows(id, 3, 2); expect(wb.activeSheet.printSettings.titleRows).toEqual([2, 6]); wb.undo();
  wb.deleteRows(id, 2, 1); expect(wb.activeSheet.printSettings.titleRows).toEqual([2, 3]); wb.undo();
  wb.deleteRows(id, 2, 3); expect(wb.activeSheet.printSettings.titleRows).toBeUndefined(); wb.undo();
  wb.insertCols(id, 0, 3); expect(wb.activeSheet.printSettings.titleCols).toEqual([4, 5]); expect(wb.activeSheet.printSettings.titleRows).toEqual([2, 4]); wb.undo();
  wb.deleteCols(id, 1, 2); expect(wb.activeSheet.printSettings.titleCols).toBeUndefined(); wb.undo();
  wb.moveRows(id, 2, 3, 8); expect(wb.activeSheet.printSettings.titleRows).toEqual([5, 7]); wb.undo();
  wb.moveCols(id, 1, 2, 6); expect(wb.activeSheet.printSettings.titleCols).toEqual([4, 5]); wb.undo();
  expect(wb.activeSheet.printSettings).toEqual(before);
});

it('preserves titles across rename, duplicate, draft, edit and metadata-free native export', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: { '0,0': { v: 42 } }, printSettings: { titleRows: [2, 4], titleCols: [1, 2] } }] });
  wb.renameSheet(wb.activeSheetId, "Q's, totals");
  const copy = wb.duplicateSheet(wb.activeSheetId); copy.printSettings.titleRows[0] = 3;
  expect(wb.sheets[0].printSettings.titleRows).toEqual([2, 4]); wb.undo();
  const draft = new Workbook(wb.toJSON()); draft.setInput(draft.activeSheetId, 5, 3, '17');
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(draft)).arrayBuffer()), { type: 'array' });
  const book = new TextDecoder().decode(X.CFB.find(zip, '/xl/workbook.xml').content);
  expect(book).toContain('_xlnm.Print_Titles');
  rewrite(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.activeSheet.name).toBe("Q's, totals");
  expect(back.activeSheet.printSettings).toMatchObject({ titleRows: [2, 4], titleCols: [1, 2] });
  expect(back.getValue(back.activeSheetId, 5, 3)).toBe(17);
});

it('honors native removal of titles over stale private metadata', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', printSettings: { titleRows: [1, 3], titleCols: [0, 0] } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  rewrite(zip, '/xl/workbook.xml', xml => xml.replace(/<definedName\b[^>]*name="_xlnm.Print_Titles"[^>]*>[^]*?<\/definedName>/g, ''));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
  expect(back.activeSheet.printSettings.titleRows).toBeUndefined(); expect(back.activeSheet.printSettings.titleCols).toBeUndefined();
});
