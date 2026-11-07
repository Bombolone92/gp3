import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { FixedArrayIndex } from '../src/core/fixed-arrays.js';

const fixedBook = (f, rows, cols, r = 2, c = 4) => {
  const wb = new Workbook({ sheets: [{ name: 'Arrays', cells: { [`${r},${c}`]: { f, array: { rows, cols } } } }] });
  return { wb, id: wb.activeSheetId, range: { r1: r, c1: c, r2: r + rows - 1, c2: c + cols - 1 } };
};

it.each([
  ['2+3', [[5, 5, 5], [5, 5, 5], [5, 5, 5]]],
  ['""', [['', '', ''], ['', '', ''], ['', '', '']]],
  ['1/0', Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ error: '#DIV/0!' })))],
  ['{2,4}', [[2, 4, { error: '#N/A' }], [2, 4, { error: '#N/A' }], [2, 4, { error: '#N/A' }]]],
  ['{2;4}', [[2, 2, 2], [4, 4, 4], [{ error: '#N/A' }, { error: '#N/A' }, { error: '#N/A' }]]],
  ['{2,4;6,8}', [[2, 4, { error: '#N/A' }], [6, 8, { error: '#N/A' }], [{ error: '#N/A' }, { error: '#N/A' }, { error: '#N/A' }]]],
])('keeps the fixed result rectangle for %s', (f, expected) => {
  const { wb, id, range } = fixedBook(f, 3, 3);
  expect(wb.rangeValues(id, range)).toEqual(expected);
  expect(wb.spillRangeAt(id, range.r1, range.c1)).toEqual(range);
  expect(wb.getValue(id, range.r2 + 1, range.c2)).toBeNull();
});

it('truncates larger results without creating an output outside the selected block', () => {
  const { wb, id, range } = fixedBook('SEQUENCE(5,4)', 2, 2);
  expect(wb.rangeValues(id, range)).toEqual([[1, 2], [5, 6]]);
  expect(wb.getValue(id, 4, 4)).toBeNull();
  expect(wb.getValue(id, 2, 6)).toBeNull();
});

it('uses the full fixed array for omitted ROW/COLUMN references, including inside aggregates', () => {
  const { wb, id, range } = fixedBook('ROW()+COLUMN()', 3, 3, 5, 2);
  expect(wb.rangeValues(id, range)).toEqual([[9, 10, 11], [10, 11, 12], [11, 12, 13]]);
  const sum = fixedBook('SUM(ROW())+SUM(COLUMN())', 3, 3, 5, 2);
  expect(sum.wb.rangeValues(sum.id, sum.range)).toEqual(Array.from({ length: 3 }, () => [33, 33, 33]));
});

it('keeps direct references anchored and recalculates dependents reading fixed results', () => {
  const { wb, id, range } = fixedBook('A1+2', 2, 3);
  wb.setInput(id, 0, 0, '7');
  wb.setInput(id, 8, 1, '=SUM(E3:G4)');
  expect(wb.getValue(id, 8, 1)).toBe(54);
  wb.setInput(id, 0, 0, '10');
  expect(wb.rangeValues(id, range)).toEqual([[12, 12, 12], [12, 12, 12]]);
  expect(wb.getValue(id, 8, 1)).toBe(72);
});

it('preserves ownership for parse errors and through draft serialization', () => {
  const { wb, id, range } = fixedBook('1+', 2, 2);
  expect(wb.getValue(id, range.r2, range.c2)).toEqual({ error: '#ERROR!' });
  const back = new Workbook(wb.toJSON());
  expect(back.getCell(back.activeSheetId, range.r1, range.c1).array).toEqual({ rows: 2, cols: 2 });
  expect(back.getValue(back.activeSheetId, range.r2, range.c2)).toEqual({ error: '#ERROR!' });
});

it('indexes large sparse rectangles without allocating their output cells', () => {
  const cells = new Map([['0,0', { f: '2', array: { rows: 1000000, cols: 10000 } }], ['1048570,16000', { f: '4', array: { rows: 6, cols: 384 } }]]);
  const index = new FixedArrayIndex(cells);
  expect(index.size).toBe(2);
  expect(index.at(999999, 9999)?.key).toBe('0,0');
  expect(index.at(1000000, 9999)).toBeNull();
  expect(index.at(1048575, 16383)?.key).toBe('1048570,16000');
  expect([...index.cells({ r1: 1048575, r2: 1048575, c1: 16382, c2: 16383 })]).toEqual(['1048575,16382', '1048575,16383']);
});

it.each(['SUM(RAND())', 'LET(sample,RAND(),SUM(sample))', 'SUM(RANDBETWEEN(1,100))'])
  ('samples random expressions independently per fixed output and caches each sample: %s', formula => {
    const { wb, id, range } = fixedBook(formula, 2, 3);
    let next = 0;
    const random = vi.spyOn(Math, 'random').mockImplementation(() => (++next % 100) / 100);
    try {
      const first = wb.rangeValues(id, range);
      expect(new Set(first.flat()).size).toBe(6);
      const calls = random.mock.calls.length;
      expect(wb.rangeValues(id, range)).toEqual(first);
      expect(random).toHaveBeenCalledTimes(calls);
      wb.setInput(id, 0, 0, '1');
      expect(wb.rangeValues(id, range)).not.toEqual(first);
    } finally { random.mockRestore(); }
  });

it('preserves the whole-array context and anchored relative INDIRECT while sampling', () => {
  const { wb, id, range } = fixedBook('SUM(ROW())+SUM(COLUMN())+INDIRECT("R[-2]C",FALSE)+RAND()', 2, 3);
  wb.setInput(id, 0, 4, '100');
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.25);
  try { expect(wb.rangeValues(id, range)).toEqual([[125.25, 125.25, 125.25], [125.25, 125.25, 125.25]]); }
  finally { random.mockRestore(); }
});

it('shares a referenced random cell instead of resampling its value for each output', () => {
  const { wb, id, range } = fixedBook('A1', 2, 3);
  wb.setInput(id, 0, 0, '=RAND()');
  let next = 0;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => ++next / 100);
  try { expect(new Set(wb.rangeValues(id, range).flat()).size).toBe(1); }
  finally { random.mockRestore(); }
});

it('calculates RANDARRAY once unless a scalar random call requests per-output calculation', () => {
  const { wb, id, range } = fixedBook('SUM(RANDARRAY(2,2))', 2, 3);
  let next = 0;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => ++next / 100);
  try {
    expect(new Set(wb.rangeValues(id, range).flat()).size).toBe(1);
    expect(random).toHaveBeenCalledTimes(4);
    wb.setArrayFormula(id, range, '=SUM(RANDARRAY(1,1)*1000)+RAND()');
    const values = wb.rangeValues(id, range).flat();
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(1);
  } finally { random.mockRestore(); }
});

it.each(['A1+1', 'B2+1', 'SUM(A1:B2)', 'IFERROR(B2,0)'])
  ('settles cycles consistently across every fixed output: %s', f => {
    const { wb, id, range } = fixedBook(f, 2, 2, 0, 0);
    expect(wb.rangeValues(id, range)).toEqual(Array.from({ length: 2 }, () => [{ error: '#CYCLE!' }, { error: '#CYCLE!' }]));
  });

it('allows formulas that inspect their array address without depending on its values', () => {
  const { wb, id, range } = fixedBook('ROWS(A1:B2)', 2, 2, 0, 0);
  expect(wb.rangeValues(id, range)).toEqual([[2, 2], [2, 2]]);
});

it('recognizes each fixed output as a formula and includes native CSE braces in FORMULATEXT', () => {
  const { wb, id } = fixedBook('A1+2', 2, 3);
  wb.setInput(id, 8, 0, '=ISFORMULA(E3:G4)');
  expect(wb.rangeValues(id, { r1: 8, c1: 0, r2: 9, c2: 2 })).toEqual([[true, true, true], [true, true, true]]);
  wb.setInput(id, 12, 0, '=FORMULATEXT(F4)');
  expect(wb.getValue(id, 12, 0)).toBe('{=A1+2}');
  const second = wb.addSheet('Second').id;
  wb.setInput(second, 0, 0, '=FORMULATEXT(Arrays!G4)');
  expect(wb.getValue(second, 0, 0)).toBe('{=A1+2}');
});
