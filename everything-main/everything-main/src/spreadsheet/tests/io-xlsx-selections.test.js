import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { normalizeSheetSelection } from '../src/core/sheet-selection.js';
import { sameBook } from '../src/lib/drafts.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const range = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const load = (view, extra = '') => workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
  head: `<sheetViews><sheetView workbookViewId="0">${view}</sheetView>${extra}</sheetViews>`,
} } }), 'selection.xlsx');
async function nativeFile(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it('preserves the active cell inside multiple selected ranges through drafts and native export', async () => {
  const wb = await load('<selection activeCell="D7" activeCellId="1" sqref="H2:I3 C5:F9 J20"/>');
  const expected = { active: { r: 6, c: 3 }, ranges: [range(1, 7, 2, 8), range(4, 2, 8, 5), range(19, 9)], activeRange: 1 };
  expect(wb.activeSheet.viewSelection).toEqual(expected);
  const draft = new Workbook(wb.toJSON());
  expect(draft.activeSheet.viewSelection).toEqual(expected);
  expect(draft.activeSheet.viewSelection).not.toBe(wb.activeSheet.viewSelection);
  for (const file of [await workbookToXlsx(wb), await nativeFile(wb)]) {
    expect((await workbookFromFile(file, 'saved.xlsx')).activeSheet.viewSelection).toEqual(expected);
  }
});

it.each(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'])('uses the active frozen pane %s and ignores later workbook views', async pane => {
  const refs = { topLeft: 'A1', topRight: 'D1', bottomLeft: 'A6', bottomRight: 'D6' };
  const wb = await load(`<pane xSplit="2" ySplit="3" state="frozen" activePane="${pane}"/>`
    + Object.entries(refs).map(([p, ref]) => `<selection pane="${p}" activeCell="${ref}" sqref="${ref}"/>`).join(''),
  '<sheetView workbookViewId="1"><selection activeCell="Z99" sqref="Z99"/></sheetView>');
  const expected = { r: pane.startsWith('bottom') ? 5 : 0, c: pane.endsWith('Right') ? 3 : 0 };
  expect(wb.activeSheet.viewSelection.active).toEqual(expected);
  const back = await workbookFromFile(await nativeFile(wb), 'saved.xlsx');
  expect(back.activeSheet.viewSelection.active).toEqual(expected);
  expect([back.activeSheet.frozenRows, back.activeSheet.frozenCols]).toEqual([3, 2]);
});

it('accepts namespace prefixes and recovers invalid active indexes using the active cell', async () => {
  const wb = await load('<x:selection xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" activeCell="G8" activeCellId="99" sqref="B2 G8:H9"/>');
  expect(wb.activeSheet.viewSelection).toEqual({ active: { r: 7, c: 6 }, ranges: [range(1, 1), range(7, 6, 8, 7)], activeRange: 1 });
});

it.each([
  ['<selection activeCell="E12"/>', { active: { r: 11, c: 4 }, ranges: [range(11, 4)], activeRange: 0 }],
  ['<selection/>', { active: { r: 0, c: 0 }, ranges: [range(0, 0)], activeRange: 0 }],
  ['<selection activeCell="XFE1" sqref="XFE1 A0 B4"/>', { active: { r: 3, c: 1 }, ranges: [range(3, 1)], activeRange: 0 }],
  ['<selection activeCell="B4" sqref="bogus"/>', undefined],
])('handles partial or malformed selections without dropping cells: %s', async (xml, expected) => {
  expect((await load(xml)).activeSheet.viewSelection).toEqual(expected);
});

it('keeps selections beyond the used range sparse, bounded and independent on copies', async () => {
  const wb = await load('<selection activeCell="AD502" sqref="AD502:AE503"/>');
  expect(wb.activeSheet.rows).toBeGreaterThanOrEqual(503);
  expect(wb.activeSheet.cols).toBeGreaterThanOrEqual(31);
  expect(wb.activeSheet.cells.size).toBe(0);
  const clone = new Workbook(wb.toJSON());
  clone.activeSheet.viewSelection.ranges[0].r2 = 600;
  expect(wb.activeSheet.viewSelection.ranges[0].r2).toBe(502);
  const original = wb.activeSheet;
  const duplicate = wb.duplicateSheet(original.id);
  duplicate.viewSelection.ranges[0].c2 = 40;
  expect(original.viewSelection.ranges[0].c2).toBe(30);
  expect(normalizeSheetSelection({ ranges: [range(0, 0, 1048576, 0)] })).toBeNull();
  expect(normalizeSheetSelection({ ranges: [range(0, 0, 0, Infinity)] })).toBeNull();
});

it('saves navigation without dirtying, undo steps, or volatile recalculation', () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { f: 'RAND()' } } }] });
  const id = wb.activeSheetId, before = wb.getValue(id, 0, 0);
  const original = wb.toJSON();
  wb.setSheetSelection(id, { active: { r: 7, c: 3 }, ranges: [range(7, 3)] });
  expect(wb.dirty).toBe(false); expect(wb.canUndo()).toBe(false);
  expect(sameBook(original, wb.toJSON())).toBe(true);
  expect(wb.getValue(id, 0, 0)).toBe(before);
  wb.insertRows(id, 0, 1);
  wb.setSheetSelection(id, { active: { r: 10, c: 5 }, ranges: [range(10, 5)] });
  wb.undo(); expect(wb.activeSheet.viewSelection.active).toEqual({ r: 10, c: 5 });
});

it('does not read commented-out views or a later view after a self-closing first view', async () => {
  const file = otherProgramsXlsx({ sheetXml: { Data: { head: '<sheetViews><!-- <sheetView workbookViewId="0"><selection activeCell="Z9" sqref="Z9"/></sheetView> -->'
    + '<sheetView workbookViewId="0"/><sheetView workbookViewId="1"><selection activeCell="B8" sqref="B8"/></sheetView></sheetViews>' } } });
  expect((await workbookFromFile(file, 'views.xlsx')).activeSheet.viewSelection).toBeUndefined();
});
