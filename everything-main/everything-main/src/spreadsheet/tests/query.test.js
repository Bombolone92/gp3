import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { parseQuery, runQuery } from '../src/core/formula/query.js';

const DATA = [
  ['Region', 'Item', 'Qty', 'Price', 'Date'],
  ['West', 'Pens', 10, 1.5, 46000],
  ['East', 'Ink', 5, 4, 46010],
  ['West', 'Paper', 20, 2, 46020],
  ['East', 'Clips', 7, 0.5, 46030],
  ['North', 'Tape', 3, 3, 46040],
];

describe('query language', () => {
  it('aggregates a tall numeric input without overflowing function arguments', () => {
    const rows = Array.from({ length: 150000 }, (_, i) => [i - 75000]);
    expect(runQuery(rows, 'select min(A), max(A)', { headers: 0 }).values).toEqual([[-75000, 74999]]);
  });

  it('parses clauses', () => {
    const q = parseQuery("select A, sum(C) where B <> 'Ink' and C >= 5 group by A order by sum(C) desc limit 2 offset 1 label sum(C) 'Total'");
    expect(q.select).toHaveLength(2);
    expect(q.where.type).toBe('and');
    expect(q.groupBy[0].name).toBe('A');
    expect(q.orderBy[0]).toMatchObject({ desc: true });
    expect(q.limit).toBe(2);
    expect(q.offset).toBe(1);
    expect(q.labels[0].text).toBe('Total');
    expect(() => parseQuery('select A where')).toThrow();
  });

  it('selects, filters, orders, and limits rows, keeping the header', () => {
    expect(runQuery(DATA, 'select A, B where C > 5 order by C desc').values).toEqual([['Region', 'Item'], ['West', 'Paper'], ['West', 'Pens'], ['East', 'Clips']]);
    expect(runQuery(DATA, "select * where A = 'East'").values).toEqual([DATA[0], DATA[2], DATA[4]]);
    expect(runQuery(DATA, 'select B limit 2 offset 1').values).toEqual([['Item'], ['Ink'], ['Paper']]);
    expect(runQuery(DATA, "select B where B contains 'a' or B starts with 'I'").values).toEqual([['Item'], ['Ink'], ['Paper'], ['Tape']]);
    expect(runQuery(DATA, "select B where B like 'P%'").values).toEqual([['Item'], ['Pens'], ['Paper']]);
    expect(runQuery(DATA, "select B where B matches 'T.*'").values).toEqual([['Item'], ['Tape']]);
    expect(runQuery(DATA, "select B where E >= date '2025-12-25'").values.length).toBe(1 + DATA.slice(1).filter((r) => r[4] >= 46014).length);
    expect(runQuery(DATA, 'select C where A is null').values).toEqual([['Qty']]); // no rows matched: the header alone
    expect(runQuery(DATA, 'select year(E), upper(B) limit 1').values).toEqual([['year(Date)', 'upper(Item)'], [2025, 'PENS']]);
  });

  it('groups with aggregates and labels', () => {
    expect(runQuery(DATA, "select A, sum(C), count(B) group by A label sum(C) 'Total'").values).toEqual([
      ['Region', 'Total', 'count Item'], ['East', 12, 2], ['North', 3, 1], ['West', 30, 2],
    ]);
    expect(runQuery(DATA, 'select max(D), min(D), avg(C)').values).toEqual([['max Price', 'min Price', 'avg Qty'], [4, 0.5, 9]]);
    expect(runQuery(DATA, 'select A, sum(C) group by A order by sum(C) desc limit 1').values).toEqual([['Region', 'sum Qty'], ['West', 30]]);
    expect(runQuery(DATA, 'select A, C group by A')).toMatchObject({ error: '#VALUE!' });
  });

  it('honours the headers argument and sheet column letters', () => {
    const noHeader = DATA.slice(1);
    expect(runQuery(noHeader, 'select Col2 where Col3 > 8', { headers: 0 }).values).toEqual([['Pens'], ['Paper']]);
    // Data starting in sheet column C: "select D" is the second column of the range.
    expect(runQuery(DATA, 'select D order by D limit 1', { firstCol: 2 }).values).toEqual([['Item'], ['Clips']]);
    expect(runQuery(DATA, 'select Z')).toMatchObject({ error: '#VALUE!' });
    expect(runQuery(DATA, '').values).toEqual(DATA);
  });

  it('works as a spilling formula in a sheet', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    DATA.forEach((row, r) => row.forEach((v, c) => { if (v != null) wb.setInput(id, r, c, typeof v === 'number' ? String(v) : v); }));
    const { r, c } = parseCellRef('H1');
    wb.setInput(id, r, c, '=QUERY(A1:E6,"select A, sum(C) where D > 1 group by A")');
    expect(wb.getValue(id, 0, 7)).toBe('Region');
    expect(wb.getValue(id, 1, 7)).toBe('East');
    expect(wb.getValue(id, 1, 8)).toBe(5);
    expect(wb.getValue(id, 2, 7)).toBe('North');
    expect(wb.getValue(id, 3, 8)).toBe(30);
    wb.setInput(id, 5, 7, '=QUERY(A1:E6,"select nope")');
    expect(wb.getValue(id, 5, 7)).toEqual({ error: '#VALUE!' });
  });
});
