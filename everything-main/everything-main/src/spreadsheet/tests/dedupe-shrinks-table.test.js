import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// Remove duplicates cleared the rows it freed at the bottom of the range instead of taking them out of the
// table, so a table kept a blank data row: it drew with the table's banding, ROWS(T[#Data]) still counted
// it while COUNTA of a column did not, and a row typed into it got no calculated columns, because nothing
// fills those for a row already inside the table. Its sibling Remove empty rows already shrank the table.
function book({ totals = false, calc = false } = {}) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Qty', 'Dbl'], ['a', 5], ['b', 7], ['a', 5], ['c', 2]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const tid = wb.addTable(id, parseRange('A1:C5'), { name: 'T', totalsRow: totals });
  if (calc) wb.setInput(id, 1, 2, '=[@Qty]*2');
  wb.setInput(id, 8, 0, '=COUNTA(T[Item])');
  wb.setInput(id, 8, 1, '=ROWS(T[#Data])');
  const row = (r) => [0, 1, 2].map((c) => wb.getCell(id, r, c)?.f ?? wb.getValue(id, r, c) ?? null);
  return { wb, id, tid, row, counts: () => [wb.getValue(id, 8, 0), wb.getValue(id, 8, 1)] };
}

describe('Remove duplicates inside a table', () => {
  it('takes the freed rows out of the table, so its row count and its values agree', () => {
    const { wb, id, tid, row, counts } = book({ calc: true });
    expect(wb.removeDuplicates(id, parseRange('A1:C5'), { header: true })).toBe(1);
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:C4'));
    expect(counts()).toEqual([3, 3]);
    expect([1, 2, 3].map(row)).toEqual([['a', 5, '[@Qty]*2'], ['b', 7, '[@Qty]*2'], ['c', 2, '[@Qty]*2']]);
    expect(row(4)).toEqual([null, null, null]);
    expect(wb.sheet(id).filter.range).toEqual(parseRange('A1:C4'));
  });

  it('gives a row typed under the shrunk table its calculated column again', () => {
    const { wb, id, tid, row, counts } = book({ calc: true });
    wb.removeDuplicates(id, parseRange('A1:C5'), { header: true });
    wb.setInput(id, 4, 0, 'd');
    wb.setInput(id, 4, 1, '3');
    expect(row(4)).toEqual(['d', 3, '[@Qty]*2']);
    expect(wb.getValue(id, 4, 2)).toBe(6);
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:C5'));
    expect(counts()).toEqual([4, 4]);
  });

  it('brings the totals row up with the table and restores everything on undo', () => {
    const { wb, id, tid, row } = book({ totals: true });
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:C6'));
    expect(wb.removeDuplicates(id, parseRange('A1:C6'), { header: true })).toBe(1);
    const t = wb.tableById(id, tid);
    expect({ range: t.range, totalsRow: t.totalsRow }).toEqual({ range: parseRange('A1:C5'), totalsRow: true });
    expect(row(4)).toEqual(['Total', 'SUBTOTAL(109,T[Qty])', null]);
    expect(wb.getValue(id, 4, 1)).toBe(14);
    expect(row(5)).toEqual([null, null, null]);
    wb.undo();
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:C6'));
    expect([1, 2, 3, 4].map((r) => row(r)[0])).toEqual(['a', 'b', 'a', 'c']);
    expect(row(5)).toEqual(['Total', 'SUBTOTAL(109,T[Qty])', null]);
    expect(wb.getValue(id, 5, 1)).toBe(19);
  });

  it('leaves a range outside any table clearing its freed rows, as before', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    [['Item'], ['a'], ['b'], ['a']].forEach((r0, r) => r0.forEach((v, c) => wb.setInput(id, r, c, v)));
    wb.setInput(id, 0, 2, 'keep'); // beside the range, untouched
    expect(wb.removeDuplicates(id, parseRange('A1:A4'), { header: true })).toBe(1);
    expect([0, 1, 2, 3].map((r) => wb.getValue(id, r, 0) ?? null)).toEqual(['Item', 'a', 'b', null]);
    expect(wb.getValue(id, 0, 2)).toBe('keep');
  });
});
