import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const styles = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => ({ s: { bg: '#abcdef', bold: true } })));
const merges = [{ r1: 0, c1: 0, r2: 1, c2: 1 }];
const destination = { r1: 3, c1: 3, r2: 4, c2: 4 };
function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.pasteValues(id, [['10', '=D4*2'], ['30', 'Text']], 3, 3);
  wb.setNote(id, 4, 4, 'Keep note'); wb.clearHistory();
  return { wb, id };
}

it('transfers formatting and merge geometry while retaining covered values, formulas and notes, with one undo', () => {
  const { wb, id } = setup(), before = wb.toJSON();
  wb.pasteStyles(id, styles, 3, 3, null, { merges });
  expect(wb.activeSheet.merges).toEqual([destination]);
  expect(wb.rangeValues(id, destination)).toEqual([[10, 20], [30, 'Text']]);
  expect(wb.getCell(id, 3, 4).f).toBe('D4*2'); expect(wb.getNote(id, 4, 4)).toBe('Keep note');
  expect(wb.styleAt(id, 4, 4)).toMatchObject({ bg: '#abcdef', bold: true });
  expect(wb.undoLabels()).toEqual(['Paste formatting']);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
  wb.redo(); wb.unmergeCells(id, destination);
  expect(wb.rangeValues(id, destination)).toEqual([[10, 20], [30, 'Text']]);
});

it('exports covered values and formulas as native XLSX cells', async () => {
  const { wb, id } = setup(); wb.pasteStyles(id, styles, 3, 3, null, { merges });
  const saved = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(saved, { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'format.xlsx');
  expect(back.activeSheet.merges).toEqual([destination]);
  expect(back.rangeValues(back.activeSheetId, destination)).toEqual([[10, 20], [30, 'Text']]);
  expect(back.getCell(back.activeSheetId, 3, 4).f).toBe('D4*2');
});

it('unmerges fully covered destination cells when the copied formatting is unmerged', () => {
  const { wb, id } = setup(); wb.pasteStyles(id, styles, 3, 3, null, { merges }); wb.clearHistory();
  wb.pasteStyles(id, styles, 3, 3, null, { merges: [] });
  expect(wb.activeSheet.merges).toEqual([]);
  expect(wb.rangeValues(id, destination)).toEqual([[10, 20], [30, 'Text']]);
  wb.undo(); expect(wb.activeSheet.merges).toEqual([destination]);
});

it('tiles copied geometry and replaces an existing merge with the copied layout', () => {
  const { wb, id } = setup();
  wb.mergeCells(id, { r1: 3, c1: 3, r2: 4, c2: 6 });
  wb.pasteStyles(id, styles, 3, 3, { r1: 3, c1: 3, r2: 4, c2: 6 }, { merges });
  expect(wb.activeSheet.merges).toEqual([destination, { r1: 3, c1: 5, r2: 4, c2: 6 }]);
});

it.each(['partial merge', 'protected', 'array', 'table'])('refuses %s before changing styles, geometry or history', cause => {
  const { wb, id } = setup();
  if (cause === 'partial merge') wb.mergeCells(id, { r1: 2, c1: 3, r2: 3, c2: 3 });
  if (cause === 'protected') wb.protectRange(id, { r1: 4, c1: 4, r2: 4, c2: 4 });
  if (cause === 'array') wb.setCells(id, [{ r: 4, c: 4, cell: { f: '1', array: { rows: 2, cols: 1 } } }]);
  if (cause === 'table') wb.addTable(id, destination);
  wb.clearHistory(); const before = wb.toJSON();
  expect(wb.pasteStyles(id, styles, 3, 3, null, { merges })).toBe(false);
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
});

it('does not create undo history for unchanged geometry and formatting', () => {
  const { wb, id } = setup(); wb.pasteStyles(id, styles, 3, 3, null, { merges }); wb.clearHistory();
  wb.pasteStyles(id, styles, 3, 3, null, { merges });
  expect(wb.canUndo()).toBe(false);
});

it('keeps style-only callers independent of clipboard merge replacement', () => {
  const { wb, id } = setup(); wb.pasteStyles(id, styles, 3, 3, null, { merges });
  wb.pasteStyles(id, [[{ s: { italic: true } }]], 3, 3);
  expect(wb.activeSheet.merges).toEqual([destination]);
});


it('copies retained underlying contents and shifts their formulas with a merged range', () => {
  const { wb, id } = setup(); wb.pasteStyles(id, styles, 3, 3, null, { merges });
  const copied = wb.copyRange(id, destination);
  expect(wb.pasteCells(id, copied, 7, 6, { r: 3, c: 3 }, null, { merges }).mergeLosses).toBe(0);
  expect(wb.activeSheet.merges).toContainEqual({ r1: 7, c1: 6, r2: 8, c2: 7 });
  expect(wb.getCell(id, 7, 7).f).toBe('G8*2');
  expect(wb.rangeValues(id, { r1: 7, c1: 6, r2: 8, c2: 7 })).toEqual([[10, 20], [30, 'Text']]);
});


it('reports values excluded by a retained destination merge', () => {
  const { wb, id } = setup(); wb.pasteStyles(id, styles, 3, 3, null, { merges });
  wb.mergeCells(id, { r1: 7, c1: 6, r2: 9, c2: 8 });
  const copied = wb.copyRange(id, destination);
  expect(wb.pasteCells(id, copied, 7, 6, { r: 3, c: 3 }, null, { merges }).mergeLosses).toBe(3);
  expect(wb.getValue(id, 7, 6)).toBe(10);
});
