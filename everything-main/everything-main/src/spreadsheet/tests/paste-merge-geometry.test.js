import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { mapPasteMerges, planPasteMerges } from '../src/core/paste-merges.js';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const merged = [{ r1: 0, c1: 0, r2: 0, c2: 1 }];
const cells = [[{ v: 'Title', s: { bg: '#abcdef' } }, null], [{ v: 12 }, { v: 13 }]];
const values = wb => wb.rangeValues(wb.activeSheetId, { r1: 3, c1: 2, r2: 4, c2: 3 });

it('pastes cells, notes and merges in one reversible step and exports native merge geometry', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 3, 3, 'Old'); wb.clearHistory();
  wb.pasteCells(id, cells, 3, 2, null, null, { merges: merged, notes: [['Heading note', null], [null, null]] });
  expect(wb.activeSheet.merges).toEqual([{ r1: 3, c1: 2, r2: 3, c2: 3 }]);
  expect(values(wb)).toEqual([['Title', null], [12, 13]]);
  expect(wb.getNote(id, 3, 2)).toBe('Heading note');
  const saved = await workbookToXlsx(wb);
  const zip = X.CFB.read(new Uint8Array(await saved.arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'merge.xlsx');
  expect(back.activeSheet.merges).toEqual(wb.activeSheet.merges);
  wb.undo(); expect(wb.activeSheet.merges).toEqual([]); expect(wb.getValue(id, 3, 3)).toBe('Old'); expect(wb.getNote(id, 3, 2)).toBeNull();
  wb.redo(); expect(values(wb)).toEqual([['Title', null], [12, 13]]); expect(wb.activeSheet.merges).toHaveLength(1);
});

it('maps merged ranges consistently through tiled and transposed copies', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.pasteCells(id, cells, 0, 0, null, { r1: 0, c1: 0, r2: 3, c2: 3 }, { merges: merged });
  expect(wb.activeSheet.merges).toEqual([
    { r1: 0, c1: 0, r2: 0, c2: 1 }, { r1: 0, c1: 2, r2: 0, c2: 3 },
    { r1: 2, c1: 0, r2: 2, c2: 1 }, { r1: 2, c1: 2, r2: 2, c2: 3 },
  ]);
  wb.pasteCells(id, cells, 6, 5, null, null, { merges: merged, transpose: true });
  expect(wb.activeSheet.merges.at(-1)).toEqual({ r1: 6, c1: 5, r2: 7, c2: 5 });
  expect(wb.getValue(id, 6, 6)).toBe(12); expect(wb.getValue(id, 7, 6)).toBe(13);
});

it('clips merge extents at grid limits without leaving a one-cell merge', () => {
  const limit = { rows: 4, cols: 4 };
  const ranges = [{ r1: 0, c1: 0, r2: 2, c2: 2 }];
  expect(mapPasteMerges(ranges, 3, 3, 2, 2, { rows: 1, cols: 1 }, false, limit))
    .toEqual([{ r1: 2, c1: 2, r2: 3, c2: 3 }]);
  expect(mapPasteMerges(ranges, 3, 3, 3, 3, { rows: 1, cols: 1 }, false, limit)).toEqual([]);
});

it.each(['overlap', 'protected', 'array', 'table'])('refuses %s without writing cells, notes, merges or history', cause => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 3, 2, 'Keep'); wb.setNote(id, 3, 2, 'Keep note');
  if (cause === 'overlap') wb.mergeCells(id, { r1: 2, c1: 3, r2: 3, c2: 3 });
  if (cause === 'protected') wb.protectRange(id, { r1: 3, c1: 3, r2: 3, c2: 3 });
  if (cause === 'array') wb.setCells(id, [{ r: 3, c: 3, cell: { f: '1', array: { rows: 2, cols: 1 } } }]);
  if (cause === 'table') wb.addTable(id, { r1: 3, c1: 2, r2: 5, c2: 3 });
  wb.clearHistory(); const before = wb.toJSON();
  wb.pasteCells(id, cells, 3, 2, null, null, { merges: merged, notes: [['New', null], [null, null]] });
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('retains destination merges at the same anchor and replaces wholly overwritten offset merges', () => {
  const large = { r1: 0, c1: 0, r2: 2, c2: 2 };
  expect(planPasteMerges([large], merged).next).toEqual([large]);
  expect(planPasteMerges(merged, [large]).next).toEqual(merged);
  expect(planPasteMerges([{ r1: 1, c1: 1, r2: 1, c2: 2 }], [large]).next).toEqual([large]);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.mergeCells(id, large); wb.clearHistory();
  wb.pasteCells(id, cells, 0, 0, null, null, { merges: merged });
  expect(wb.activeSheet.merges).toEqual([large]); expect(wb.getValue(id, 0, 0)).toBe('Title');
});

it('rejects invalid or overlapping source geometry atomically', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const merges of [[{ r1: 0, c1: 0, r2: 0, c2: 9 }], [...merged, ...merged], [{ r1: -1, c1: 0, r2: 0, c2: 1 }]]) {
    wb.pasteCells(id, cells, 0, 0, null, null, { merges });
    expect(wb.activeSheet.cells.size).toBe(0); expect(wb.activeSheet.merges).toEqual([]);
  }
});

it('does not hide old destination values under a merged skip-blanks paste', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 3, 3, 'Old'); wb.clearHistory();
  wb.pasteCells(id, cells, 3, 2, null, null, { merges: merged, skipBlanks: true });
  expect(wb.getValue(id, 3, 3)).toBeNull();
  wb.unmergeCells(id, { r1: 3, c1: 2, r2: 3, c2: 3 });
  expect(wb.getValue(id, 3, 3)).toBeNull();
});


it('copies covered-cell styles when incoming geometry replaces an offset destination merge', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 2, 'Old'); wb.mergeCells(id, { r1: 1, c1: 1, r2: 1, c2: 2 });
  const block = Array.from({ length: 2 }, () => Array.from({ length: 3 }, () => ({ v: null, s: { bg: '#abcdef' } })));
  block[0][0].v = 'New';
  wb.pasteCells(id, block, 0, 0, null, null, { merges: [{ r1: 0, c1: 0, r2: 1, c2: 2 }] });
  expect(wb.activeSheet.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 2 }]);
  expect(wb.styleAt(id, 1, 2).bg).toBe('#abcdef');
  wb.unmergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 2 });
  expect(wb.getValue(id, 1, 2)).toBeNull();
});


it('does not clear neighboring cells or merges when a copied merge lands on an existing merge anchor', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 2, 'Neighbor'); wb.setInput(id, 1, 0, 'Below');
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 1 });
  wb.mergeCells(id, { r1: 0, c1: 2, r2: 1, c2: 2 });
  const before = wb.activeSheet.merges.map(m => ({ ...m }));
  wb.pasteCells(id, [[{ v: 'Copied' }, null, null], [null, null, null]], 0, 0, null, null,
    { merges: [{ r1: 0, c1: 0, r2: 1, c2: 2 }] });
  expect(wb.activeSheet.merges).toEqual(before);
  expect(wb.getValue(id, 0, 0)).toBe('Copied');
  expect(wb.getValue(id, 0, 2)).toBe('Neighbor'); expect(wb.getValue(id, 1, 0)).toBe('Below');
});
