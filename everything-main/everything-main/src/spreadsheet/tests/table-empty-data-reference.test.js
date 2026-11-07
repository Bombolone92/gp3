import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { resolveTableSpec } from '../src/core/tables.js';

// Deleting every data row leaves a table with its header (and its totals row), and a data reference over it
// then names no rows. resolveTableSpec called that #REF!, so the table's own SUBTOTAL and every SUM(T[Amt])
// in the book read as a broken formula rather than an empty table. An empty reference is now what it is:
// the aggregates read it as nothing, as they do over a table whose values were cleared.
const FORMULAS = ['=SUM(T[Amt])', '=COUNTA(T[Item])', '=ROWS(T[#Data])', '=COUNTA(T[#All])', '=COUNTA(T[#Headers])'];

function book(totals) {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Report' }] });
  const [data, report] = wb.sheets;
  const id = data.id;
  [['Item', 'Amt'], ['a', 5], ['b', 7]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  const tid = wb.addTable(id, parseRange('A1:B3'), { name: 'T', totalsRow: totals });
  // On another sheet, so the row deletion under test does not move them.
  FORMULAS.forEach((f, i) => wb.setInput(report.id, 0, i, f));
  const out = () => FORMULAS.map((_, c) => wb.getValue(report.id, 0, c));
  return { wb, id, tid, out };
}

describe('a table left with no data rows', () => {
  it('reads as empty, not broken, in its totals row and in every formula that names it', () => {
    const { wb, id, tid, out } = book(true);
    expect(out()).toEqual([12, 2, 2, 8, 2]);
    wb.deleteLines(id, 'row', [{ from: 1, to: 2 }], 'Delete rows');
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B2'));
    expect(wb.getValue(id, 1, 1)).toBe(0); // the totals row's SUBTOTAL(109, T[Amt])
    expect(out()).toEqual([0, 0, 0, 4, 2]); // #All is the header plus the totals row
    wb.undo();
    expect(out()).toEqual([12, 2, 2, 8, 2]);
  });

  it('reads as empty without a totals row, and fills again when a row is typed under the header', () => {
    const { wb, id, tid, out } = book(false);
    wb.deleteLines(id, 'row', [{ from: 1, to: 2 }], 'Delete rows');
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B1'));
    expect(out()).toEqual([0, 0, 0, 2, 2]);
    wb.setInput(id, 1, 0, 'c');
    wb.setInput(id, 1, 1, '4');
    expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B2'));
    expect(out()).toEqual([4, 1, 1, 4, 2]);
  });

  it('takes a row back through Add table row when a totals row blocks typing under it', () => {
    const { wb, id, tid, out } = book(true);
    wb.deleteLines(id, 'row', [{ from: 1, to: 2 }], 'Delete rows');
    expect(wb.addTableRow(id, tid)).toBe(1);
    wb.setInput(id, 1, 1, '4');
    expect(out()[0]).toBe(4);
    expect(wb.getValue(id, 2, 1)).toBe(4); // the totals row moved down and totals the new row
  });

  it('leaves a this-row reference and a missing column as the errors they were', () => {
    const table = { range: { r1: 0, c1: 0, r2: 0, c2: 1 }, totalsRow: false };
    expect(resolveTableSpec(table, ['Item', 'Amt'], '[Amt]', null)).toEqual({ r1: 1, c1: 1, r2: 0, c2: 1 });
    expect(resolveTableSpec(table, ['Item', 'Amt'], '[@Amt]', { r: 0, c: 1 })).toEqual({ error: '#VALUE!' });
    expect(resolveTableSpec(table, ['Item', 'Amt'], '[Gone]', null)).toEqual({ error: '#REF!' });
    expect(resolveTableSpec(table, ['Item', 'Amt'], '[#Totals]', null)).toEqual({ error: '#REF!' });
  });
});
