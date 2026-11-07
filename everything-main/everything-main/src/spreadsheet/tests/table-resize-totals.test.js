import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_ROW } from '../src/core/refs.js';

// Loading structural undo snapshots supplies the default empty calc map.
function snapshot(wb) {
  const value = wb.toJSON();
  for (const sheet of value.sheets) for (const table of sheet.tables || []) table.calc ??= {};
  return value;
}

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [['Item', 'Amount'], ['A', 10], ['B', 20], ['C', 30]].flatMap((row, r) =>
    row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 }, { name: 'Sales', totalsRow: true });
  wb.setInput(id, 4, 0, 'Grand total');
  wb.setNote(id, 4, 1, 'Footer note');
  wb.applyStyle(id, { r1: 4, c1: 1, r2: 4, c2: 1 }, { fmt: 'currency', cur: 'EUR' });
  return { wb, id, tid };
}

it.each([2, 6])('moves the footer to row index %s without losing or reordering data', (end) => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 5, 0, 'D'); wb.setInput(id, 5, 1, '40');
  wb.setInput(id, 6, 0, 'E'); wb.setInput(id, 6, 1, '50');
  wb.setNote(id, 2, 0, 'Data note');
  wb.setInput(id, 4, 3, 'Outside');
  wb.defineName('Footer', 'Sheet1!$B$5');
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=Sheet1!B5');
  wb.setInput(other, 1, 0, '=Sheet1!B3');
  wb.setSheetProtected(other, true);
  wb.clearHistory();
  const before = snapshot(wb);
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: end, c2: 1 })).toBe(true);
  expect(wb.getValue(id, end, 0)).toBe('Grand total');
  expect(wb.getValue(id, end, 1)).toBe(end === 2 ? 10 : 150);
  expect(wb.getNote(id, end, 1)).toBe('Footer note');
  expect(wb.getCell(id, end, 1).s).toMatchObject({ fmt: 'currency', cur: 'EUR' });
  expect(Array.from({ length: 6 }, (_, i) => i + 1).filter((r) => r !== end).map((r) => wb.getValue(id, r, 0))).toEqual(['A', 'B', 'C', 'D', 'E']);
  expect(wb.getNote(id, end === 2 ? 3 : 2, 0)).toBe('Data note');
  expect(wb.getValue(id, 4, 3)).toBe('Outside');
  expect(wb.getValue(other, 0, 0)).toBe(end === 2 ? 10 : 150);
  expect(wb.getValue(other, 1, 0)).toBe(20);
  expect(wb.names[0].ref).toBe(`Sheet1!$B$${end + 1}`);
  expect(wb.sheet(id).filter.range.r2).toBe(end - 1);
  expect(wb.undoLabels()).toEqual(['Resize table']);
  const after = snapshot(wb);
  wb.undo(); expect(snapshot(wb)).toEqual(before);
  wb.redo(); expect(snapshot(wb)).toEqual(after);
});

it.each([2, 3, 4])('refuses a footer move through protected row index %s atomically', (r) => {
  const { wb, id, tid } = setup();
  wb.protectRange(id, { r1: r, c1: 0, r2: r, c2: 1 });
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 2, c2: 1 })).toBe(false);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('moves a footer at the file-format boundary without inserting rows or truncating data', () => {
  const wb = new Workbook({ sheets: [{ name: 'Edge', rows: MAX_ROW + 1, cells: {
    [`${MAX_ROW - 3},0`]: { v: 'Amount' }, [`${MAX_ROW - 2},0`]: { v: 10 },
    [`${MAX_ROW - 1},0`]: { v: 20 }, [`${MAX_ROW},0`]: { f: 'SUM(EdgeTable[Amount])' },
  }, tables: [{ id: 't', name: 'EdgeTable', range: { r1: MAX_ROW - 3, c1: 0, r2: MAX_ROW, c2: 0 }, totalsRow: true }] }] });
  const id = wb.activeSheetId;
  expect(wb.resizeTable(id, 't', { r1: MAX_ROW - 3, c1: 0, r2: MAX_ROW - 1, c2: 0 })).toBe(true);
  expect(wb.getCell(id, MAX_ROW - 1, 0).f).toBe('SUM(EdgeTable[Amount])');
  expect(wb.getValue(id, MAX_ROW - 1, 0)).toBe(10);
  expect(wb.getValue(id, MAX_ROW, 0)).toBe(20);
  expect(wb.sheet(id).rows).toBe(MAX_ROW + 1);
});

it('preserves custom A1 totals without including the footer in its own range', () => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 4, 1, '=SUM(B2:B4)');
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 2, c2: 1 })).toBe(true);
  expect(wb.getValue(id, 2, 1)).toBe(60);
  expect(wb.getCell(id, 2, 1).f).toBe('SUM((B2:B2,B4:B5))');
});

it('preserves the unmoved columns of a custom total reference', () => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 1, 2, '1'); wb.setInput(id, 2, 2, '2'); wb.setInput(id, 3, 2, '3');
  wb.setInput(id, 4, 1, '=SUM(B2:C4)');
  wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 2, c2: 1 });
  expect(wb.getValue(id, 2, 1)).toBe(66);
  expect(wb.getValue(id, 2, 2)).toBe(2);
});

it('updates only the resized sheet within a three-dimensional total reference', () => {
  const { wb, id, tid } = setup();
  const other = wb.addSheet('Summary').id;
  for (let r = 1; r <= 3; r++) wb.setInput(other, r, 1, String(r + 1));
  wb.setInput(id, 4, 1, '=SUM(Sheet1:Summary!B2:B4)');
  expect(wb.getValue(id, 4, 1)).toBe(69);
  wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 2, c2: 1 });
  expect(wb.getValue(id, 2, 1)).toBe(69);
});

it('moves horizontal merged footer cells with their contents', () => {
  const { wb, id, tid } = setup();
  wb.mergeCells(id, { r1: 4, c1: 0, r2: 4, c2: 1 });
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 6, c2: 1 })).toBe(true);
  expect(wb.sheet(id).merges).toEqual([{ r1: 6, c1: 0, r2: 6, c2: 1 }]);
  expect(wb.getValue(id, 6, 0)).toBe('Grand total');
});

it.each(['merge', 'spill'])('refuses to split a %s crossing the moved columns', (kind) => {
  const { wb, id, tid } = setup();
  if (kind === 'merge') wb.mergeCells(id, { r1: 5, c1: 1, r2: 5, c2: 2 });
  else { wb.setInput(id, 5, 1, '=SEQUENCE(1,2)'); wb.getValue(id, 5, 1); }
  wb.clearHistory();
  const before = snapshot(wb);
  const errors = [];
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 6, c2: 1 }, { onInvalid: (message) => errors.push(message) })).toBe(false);
  expect(errors).toEqual([kind === 'merge' ? 'That resize would split merged cells.' : 'That resize would split an array result.']);
  expect(snapshot(wb)).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});

it('moves sparse footer content beyond the scrolling cap without reading every row', () => {
  const { wb, id, tid } = setup();
  // A literal footer isolates moving cells from the cost of its formula.
  wb.setInput(id, 4, 1, '60');
  let reads = 0;
  const getValue = wb.getValue.bind(wb);
  wb.getValue = (...args) => { reads++; return getValue(...args); };
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 900000, c2: 1 })).toBe(true);
  expect(wb.getValue(id, 900000, 1)).toBe(60);
  expect(wb.sheet(id).rows).toBe(900001);
  expect(reads).toBeLessThan(50);
});

it('moves a complete spill that lies between the old and new footer', () => {
  const { wb, id, tid } = setup();
  wb.setInput(id, 5, 0, '=SEQUENCE(1,2)');
  expect(wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 6, c2: 1 })).toBe(true);
  expect(wb.getValue(id, 4, 0)).toBe(1);
  expect(wb.getValue(id, 4, 1)).toBe(2);
  expect(wb.getValue(id, 6, 1)).toBe(62);
});

it('reapplies a separate filter after footer movement and redo', () => {
  const { wb, id, tid } = setup();
  wb.setFilterRange(id, { r1: 1, c1: 0, r2: 6, c2: 1 });
  wb.setFilterCriteria(id, 0, { values: ['B'] });
  expect(wb.sheet(id).filterHidden.has(2)).toBe(false);
  wb.resizeTable(id, tid, { r1: 0, c1: 0, r2: 2, c2: 1 });
  expect(wb.sheet(id).filterHidden.has(2)).toBe(true);
  expect(wb.sheet(id).filterHidden.has(3)).toBe(false);
  wb.undo();
  expect(wb.sheet(id).filterHidden.has(2)).toBe(false);
  wb.redo();
  expect(wb.sheet(id).filterHidden.has(3)).toBe(false);
});
