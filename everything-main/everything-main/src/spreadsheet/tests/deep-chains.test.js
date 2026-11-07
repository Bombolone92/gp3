import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { MAX_TEXT } from '../src/core/cell.js';

function chain(rows, formula, extra = {}) {
  const cells = { '0,0': { v: 1 }, ...extra };
  for (let r = 1; r < rows; r++) cells[`${r},0`] = { f: formula(r + 1) };
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 5, cols: 4, cells }] });
  return { wb, id: wb.activeSheetId };
}

it('evaluates a running total read from the bottom, however long the chain', () => {
  const rows = 8000;
  const { wb, id } = chain(rows, (r) => `A${r - 1}+1`);
  expect(wb.getValue(id, rows - 1, 0)).toBe(rows);
  expect(wb.getValue(id, 4000, 0)).toBe(4001);
  wb.setInput(id, 0, 0, '11');
  expect(wb.getValue(id, rows - 1, 0)).toBe(rows + 10);
});

it('handles balances wrapped in IF and totals over the chain', () => {
  const rows = 6000;
  const cells = {};
  for (let r = 0; r < rows; r++) { cells[`${r},1`] = { v: 2 }; cells[`${r},0`] = { f: r ? `IF(B${r + 1}="","",A${r}+B${r + 1})` : `B1` }; }
  cells[`${rows},0`] = { f: `SUM(A1:A${rows})` };
  cells[`${rows},1`] = { f: `OFFSET(A${rows},0,0)` };
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 5, cols: 4, cells }] });
  const id = wb.activeSheetId;
  expect(wb.getValue(id, rows, 1)).toBe(rows * 2);
  expect(wb.getValue(id, rows, 0)).toBe(rows * (rows + 1));
  expect(wb.getValue(id, rows - 1, 0)).toBe(rows * 2);
});

it('follows a deep chain of array candidates and one that crosses sheets', () => {
  const rows = 5000;
  const { wb, id } = chain(rows, (r) => `OFFSET(A${r - 1},0,0)+1`);
  expect(wb.getValue(id, rows - 1, 0)).toBe(rows);
  const other = new Workbook({ sheets: [
    { name: 'Data', rows: rows + 5, cols: 2, cells: Object.fromEntries(Array.from({ length: rows }, (_, r) => [`${r},0`, r ? { f: `A${r}+1` } : { v: 1 }])) },
    { name: 'Report', rows: 5, cols: 2, cells: { '0,0': { f: `Data!A${rows}*2` } } },
  ] });
  expect(other.getValue(other.sheets[1].id, 0, 0)).toBe(rows * 2);
});

it('still reports a cycle at the end of a long chain', () => {
  const rows = 5000;
  const { wb, id } = chain(rows, (r) => `A${r - 1}+1`, { '0,0': { f: `A${rows}` } });
  expect(wb.getValue(id, rows - 1, 0)).toEqual({ error: '#CYCLE!' });
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#CYCLE!' });
});

it('answers #ERROR! rather than throwing when a single formula nests deeper than the stack', () => {
  const formulas = [
    `${'('.repeat(3000)}1${')'.repeat(3000)}`,
    `${'1+'.repeat(20000)}1`,
    `${'-'.repeat(20000)}1`,
    `${'SUM('.repeat(5000)}1${')'.repeat(5000)}`,
  ];
  for (const f of formulas) {
    // Typed, such an entry is kept as text (as much as a file can hold); a file can still carry the formula itself.
    const typed = new Workbook();
    typed.setInput(typed.activeSheetId, 0, 0, `=${f}`);
    expect(typed.getCell(typed.activeSheetId, 0, 0).f).toBeNull();
    expect(typed.getValue(typed.activeSheetId, 0, 0)).toBe(`=${f}`.slice(0, MAX_TEXT));
    const wb = new Workbook({ sheets: [{ name: 'Sheet1', cells: { '0,0': { v: null, f } } }] });
    const id = wb.activeSheetId;
    let value;
    expect(() => { value = wb.getValue(id, 0, 0); }).not.toThrow();
    // A chain of operators, however long, is walked as a list and has its value; nesting that deep does not.
    expect(value).toEqual(f.startsWith('1+') ? 20001 : { error: '#ERROR!' });
    // The saved file reopens without throwing either.
    const again = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(() => again.getValue(again.activeSheetId, 0, 0)).not.toThrow();
  }
});

it('does not mistake a precedent shared by sibling cells for a cycle on a long chain', () => {
  // A balance schedule: B is the opening balance, C the interest on it, D their sum carried
  // into the next row's B. D names B and C, and C names B too, so B is waiting to be expanded
  // when C reads it on the walk from the bottom. That is no circle.
  const rows = 6000;
  const cells = { '0,1': { v: 1000 } };
  for (let r = 0; r < rows; r++) {
    if (r) cells[`${r},1`] = { f: `D${r}` };
    cells[`${r},2`] = { f: `B${r + 1}*0.001` };
    cells[`${r},3`] = { f: `SUM(B${r + 1}:C${r + 1})` };
  }
  cells[`${rows},0`] = { f: `D${rows}` };
  cells[`${rows},1`] = { f: `C${rows}+D${rows}` };
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 5, cols: 5, cells }] });
  const id = wb.activeSheetId;
  let expected = 1000;
  for (let r = 0; r < rows; r++) expected += expected * 0.001;
  expect(wb.getValue(id, rows, 0)).toBeCloseTo(expected, 6);
  expect(wb.getValue(id, rows, 1)).toBeCloseTo(expected + expected / 1.001 * 0.001, 6);
  expect(wb.getValue(id, 3000, 3)).toBeGreaterThan(1000);
});

it('evaluates long diamonds whose branches meet again on every row', () => {
  const rows = 6000;
  const cells = { '0,0': { v: 1 } };
  for (let r = 1; r < rows; r++) {
    cells[`${r},1`] = { f: `A${r}*1` };
    cells[`${r},2`] = { f: `A${r}+0` };
    cells[`${r},0`] = { f: `(B${r + 1}+C${r + 1})/2+1` };
  }
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 5, cols: 4, cells }] });
  expect(wb.getValue(wb.activeSheetId, rows - 1, 0)).toBe(rows);
});

it('still reports a cycle closing through sibling cells at the end of a long chain', () => {
  const rows = 5000;
  const cells = { '0,0': { f: `B${rows}` } };
  for (let r = 1; r < rows; r++) cells[`${r},0`] = { f: `A${r}+1` };
  for (let r = 0; r < rows; r++) cells[`${r},1`] = { f: `A${r + 1}+SUM(A${r + 1}:A${r + 1})` };
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 5, cols: 4, cells }] });
  const id = wb.activeSheetId;
  expect(wb.getValue(id, rows - 1, 1)).toEqual({ error: '#CYCLE!' });
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#CYCLE!' });
});
