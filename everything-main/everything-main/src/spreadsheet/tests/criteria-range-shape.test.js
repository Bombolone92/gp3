import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const functions = ['SUMIFS', 'AVERAGEIFS', 'MAXIFS', 'MINIFS', 'COUNTIFS', 'COUNTUNIQUEIFS'];
const formula = (fn, range, criteria, extra = '') => fn === 'COUNTIFS'
  ? `=${fn}(${range},">0",${criteria},">0"${extra})`
  : `=${fn}(${range},${criteria},">0"${extra})`;

function fixture() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [[10, 1, 1], [20, 1, 1], [30, 1, 1], [40, 1, 1]].flatMap((row, r) =>
    row.map((v, c) => ({ r, c, cell: { v } }))));
  const calc = (f) => {
    wb.setInput(id, 0, 5, f);
    return wb.getValue(id, 0, 5);
  };
  return { wb, id, calc };
}

describe.each(functions)('%s range dimensions', (fn) => {
  it.each(['B1:B2', 'B1:B4', 'B1:D1', 'B1:C3'])('rejects mismatched criteria range %s', (criteria) => {
    const { calc } = fixture();
    expect(calc(formula(fn, 'A1:A3', criteria))).toEqual({ error: '#VALUE!' });
  });

  it('validates subsequent criteria ranges even when nothing matches', () => {
    const { calc } = fixture();
    expect(calc(formula(fn, 'A1:A3', 'B1:B3', ',C1:C2,">100"'))).toEqual({ error: '#VALUE!' });
  });

  it('uses declared dimensions when unused cells are trimmed', () => {
    const { calc } = fixture();
    expect(calc(formula(fn, 'A:A', 'B1:B4'))).toEqual({ error: '#VALUE!' });
    expect(calc(formula(fn, '2:2', 'A3:F3'))).toEqual({ error: '#VALUE!' });
  });

  it('allows equal shapes with different starting addresses', () => {
    const { calc } = fixture();
    const expected = { SUMIFS: 60, AVERAGEIFS: 20, MAXIFS: 30, MINIFS: 10, COUNTIFS: 3, COUNTUNIQUEIFS: 3 };
    expect(calc(formula(fn, 'A1:A3', 'B2:B4'))).toBe(expected[fn]);
  });

  it('allows whole columns on sheets with different used areas', () => {
    const { wb, calc } = fixture();
    const other = wb.addSheet('Criteria');
    wb.setInput(other.id, 0, 0, '1');
    expect(calc(formula(fn, 'A:A', 'Criteria!A:A'))).toBe(fn.startsWith('COUNT') ? 1 : 10);
  });

  it('checks array shapes and retains equally shaped array support', () => {
    const { calc } = fixture();
    expect(calc(formula(fn, '{10;20}', '{1,1}'))).toEqual({ error: '#VALUE!' });
    const expected = { SUMIFS: 30, AVERAGEIFS: 15, MAXIFS: 20, MINIFS: 10, COUNTIFS: 2, COUNTUNIQUEIFS: 2 };
    expect(calc(formula(fn, '{10;20}', '{1;1}'))).toBe(expected[fn]);
  });
});

it('retains the flexible dimensions of single-criterion aggregates', () => {
  const { calc } = fixture();
  expect(calc('=SUMIF(B1:B2,1,A1:A4)')).toBe(30);
  expect(calc('=AVERAGEIF(B1:B2,1,A1:A4)')).toBe(15);
});
