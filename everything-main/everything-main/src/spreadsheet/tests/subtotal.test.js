import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { addSubtotals, removeSubtotals, hasSubtotals } from '../src/core/subtotal.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}

const DATA = {
  A1: 'Region', B1: 'Item', C1: 'Sales',
  A2: 'West', B2: 'Pens', C2: '10',
  A3: 'East', B3: 'Ink', C3: '5',
  A4: 'West', B4: 'Paper', C4: '20',
  A5: 'East', B5: 'Clips', C5: '7',
  A6: 'North', B6: 'Tape', C6: '3',
};

describe('subtotals', () => {
  it.each([
    ['1', "'number:1"],
    ['TRUE', "'boolean:true"],
  ])('keeps %s separate from text resembling its internal group key', (value, text) => {
    const { wb, id } = book({ A1: 'Group', B1: 'Amount', A2: value, B2: '10', A3: text, B3: '20' });
    const before = wb.toJSON();
    const out = addSubtotals(wb, id, parseRange('A1:B3'), { groupCol: 0, totalCols: [1], sort: false });
    expect(out.r2).toBe(5);
    expect(wb.getValue(id, 2, 1)).toBe(10);
    expect(wb.getValue(id, 4, 1)).toBe(20);
    expect(wb.getValue(id, 5, 1)).toBe(30);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    wb.redo();
    expect(wb.getValue(id, 5, 1)).toBe(30);
  });

  it('keeps rows with different errors in different groups', () => {
    const { wb, id } = book({ A1: 'Key', B1: 'Amount', A2: '=1/0', B2: '10', A3: '=NA()', B3: '20', A4: '=1/0', B4: '30' });
    const out = addSubtotals(wb, id, parseRange('A1:B4'), { groupCol: 0, totalCols: [1], sort: false });
    expect(out.r2).toBe(7);
    const labels = [];
    for (let r = 1; r <= 7; r++) labels.push(wb.getDisplay(id, r, 0));
    expect(labels).toEqual(['#DIV/0!', '#DIV/0! Total', '#N/A', '#N/A Total', '#DIV/0!', '#DIV/0! Total', 'Grand Total']);
    expect([2, 4, 6, 7].map((r) => wb.getValue(id, r, 1))).toEqual([10, 20, 30, 60]);
  });

  it('still groups text ignoring case and surrounding spaces', () => {
    const { wb, id } = book({ A1: 'Group', B1: 'Amount', A2: 'West', B2: '10', A3: "' west ", B3: '20' });
    const out = addSubtotals(wb, id, parseRange('A1:B3'), { groupCol: 0, totalCols: [1], sort: false });
    expect(out.r2).toBe(4);
    expect(wb.getValue(id, 3, 1)).toBe(30);
    expect(wb.getValue(id, 4, 1)).toBe(30);
  });

  it('sorts, groups, and writes SUBTOTAL rows plus a grand total that is not doubled', () => {
    const { wb, id } = book(DATA);
    wb.applyStyle(id, parseRange('C2:C6'), { fmt: 'currency', dec: 0 });
    const out = addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, code: 9, totalCols: [2], header: true });
    expect(out).toEqual({ r1: 0, c1: 0, r2: 9, c2: 2 });
    const colA = [];
    for (let r = 0; r <= 9; r++) colA.push(wb.getDisplay(id, r, 0));
    expect(colA).toEqual(['Region', 'East', 'East', 'East Total', 'North', 'North Total', 'West', 'West', 'West Total', 'Grand Total']);
    expect(wb.getCell(id, 3, 2).f).toBe('SUBTOTAL(9,C2:C3)');
    expect(wb.getValue(id, 3, 2)).toBe(12);
    expect(wb.getValue(id, 5, 2)).toBe(3);
    expect(wb.getValue(id, 8, 2)).toBe(30);
    expect(wb.getCell(id, 9, 2).f).toBe('SUBTOTAL(9,C2:C9)');
    expect(wb.getValue(id, 9, 2)).toBe(45);
    expect(wb.getDisplay(id, 9, 2)).toBe('$45');
    expect(wb.getCell(id, 9, 2).s.bold).toBe(true);
    expect(wb.getCell(id, 9, 0).s.bt).toBe(true);
    const groups = wb.outlineGroups(id, 'row');
    expect(groups.some((g) => g.from === 1 && g.to === 8)).toBe(true);
    expect(groups.some((g) => g.from === 1 && g.to === 2)).toBe(true);
    expect(groups.some((g) => g.from === 6 && g.to === 7)).toBe(true);
    expect(hasSubtotals(wb, id, parseRange('A1:C10'))).toBe(true);
    // One undo removes everything.
    wb.undo();
    expect(wb.getDisplay(id, 1, 0)).toBe('West');
    expect(wb.getValue(id, 6, 0)).toBeNull();
    expect(wb.outlineGroups(id, 'row')).toHaveLength(0);
  });

  it('removes subtotal rows and their groups', () => {
    const { wb, id } = book(DATA);
    addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, code: 3, totalCols: [1, 2], header: true, sort: false });
    expect(wb.getValue(id, 2, 1)).toBe(1); // West: count of one item before sorting is off... groups by runs
    const n = removeSubtotals(wb, id, parseRange('A1:C20'));
    expect(n).toBe(6); // five runs (West, East, West, East, North) plus the grand total
    expect(wb.getDisplay(id, 5, 0)).toBe('North');
    expect(wb.getValue(id, 6, 0)).toBeNull();
    expect(wb.outlineGroups(id, 'row')).toHaveLength(0);
    expect(hasSubtotals(wb, id, parseRange('A1:C20'))).toBe(false);
  });

  it('replaces the subtotals already in the range instead of totalling the totals', () => {
    const { wb, id } = book(DATA);
    const first = addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, totalCols: [2] });
    const layout = () => { const out = []; for (let r = 0; r <= first.r2 + 1; r++) out.push(wb.getDisplay(id, r, 0)); return out; };
    const once = layout();
    expect(addSubtotals(wb, id, first, { groupCol: 0, totalCols: [2] })).toEqual(first);
    expect(layout()).toEqual(once);
    expect(wb.getCell(id, 9, 2).f).toBe('SUBTOTAL(9,C2:C9)');
    expect(wb.getValue(id, 9, 2)).toBe(45);
    expect(wb.outlineGroups(id, 'row').filter((g) => g.from === 1 && g.to === 8)).toHaveLength(1);
    // Grouping by another column replaces them too.
    const byItem = addSubtotals(wb, id, first, { groupCol: 1, totalCols: [2] });
    expect(byItem.r2).toBe(11); // five items, a total under each, and a grand total
    expect(wb.getValue(id, 11, 2)).toBe(45);
    expect(removeSubtotals(wb, id, parseRange('A1:C12'))).toBe(6);
    expect(wb.getValue(id, 6, 0)).toBeNull();
  });

  it('leaves the user\'s own SUBTOTAL rows alone when removing subtotals', () => {
    const { wb, id } = book({ ...DATA, A7: 'Running', C7: '=SUBTOTAL(9,C2:C6)', A8: 'Check', C8: '=SUBTOTAL(9,C2:C7)' });
    wb.clearHistory();
    expect(hasSubtotals(wb, id, parseRange('A1:C8'))).toBe(false);
    expect(removeSubtotals(wb, id, parseRange('A1:C8'))).toBe(0);
    expect(wb.getValue(id, 6, 0)).toBe('Running');
    expect(wb.getValue(id, 6, 2)).toBe(45);
    expect(wb.canUndo()).toBe(false);
    const out = addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, totalCols: [2], sort: false });
    expect(out.r2).toBe(11);
    expect(hasSubtotals(wb, id, parseRange('A1:C14'))).toBe(true);
    expect(removeSubtotals(wb, id, parseRange('A1:C14'))).toBe(6);
    expect(wb.getValue(id, 6, 0)).toBe('Running');
    expect(wb.getCell(id, 6, 2).f).toBe('SUBTOTAL(9,C2:C6)');
    expect(wb.getValue(id, 7, 0)).toBe('Check');
    expect(wb.getValue(id, 8, 0)).toBeNull();
  });

  it('refuses empty or headerless-only ranges', () => {
    const { wb, id } = book(DATA);
    expect(addSubtotals(wb, id, parseRange('A1:C1'), { groupCol: 0, totalCols: [2] })).toBeNull();
    expect(addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, totalCols: [] })).toBeNull();
    // The group column holds the labels: alone it leaves nothing to total.
    expect(addSubtotals(wb, id, parseRange('A1:C6'), { groupCol: 0, totalCols: [0] })).toBeNull();
    expect(wb.getValue(id, 6, 0)).toBeNull();
  });
});

describe('SUBTOTAL ignores nested subtotals', () => {
  it('skips cells that hold a SUBTOTAL or AGGREGATE formula', () => {
    const { wb, id } = book({ A1: '1', A2: '2', A3: '=SUBTOTAL(9,A1:A2)', A4: '=SUBTOTAL(9,A1:A3)', A5: '=SUM(A1:A3)', A6: '=AGGREGATE(9,0,A1:A2)', A7: '=SUBTOTAL(1,A1:A6)' });
    expect(wb.getValue(id, 3, 0)).toBe(3);
    expect(wb.getValue(id, 4, 0)).toBe(6);
    expect(wb.getValue(id, 6, 0)).toBe(3); // average of 1, 2, and the plain SUM (6)
  });
});
