import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const set = (a1, value) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, value); };
  const at = (a1) => { const { r, c } = parseCellRef(a1); return wb.getValue(id, r, c); };
  for (const [a1, value] of Object.entries({ B2: '1', C2: '10', D2: '100', B3: '2', C3: '20', D3: '200', B4: '3', C4: '30', D4: '300' })) set(a1, value);
  return { wb, id, set, at };
}

it.each([
  ['INDEX(B2:D4,0,2)', 'F3', 20, 'F4', 30],
  ['INDEX(B2:D4,2,0)', 'G2', 20, 'H2', 200],
  ['INDEX(B2:D4,0,0)', 'G3', 20, 'H4', 300],
  ['INDEX(B2:D4,,2)', 'F3', 20, 'F4', 30],
  ['INDEX(B2:D4,2)', 'G2', 20, 'H2', 200],
])('spills %s when a zero or omitted index selects a whole row or column', (formula, middle, value, end, last) => {
  const { set, at } = book();
  set('F2', `=${formula}`);
  // Read a spill child first to verify discovery does not require rendering the anchor.
  expect(at(middle)).toBe(value);
  expect(at(end)).toBe(last);
});

it('feeds selected rows, columns, and union areas into other functions', () => {
  const { set, at } = book();
  for (const [formula, expected] of [
    ['SUM(INDEX(B2:D4,0,2))', 60],
    ['SUM(INDEX(B2:D4,2,0))', 222],
    ['SUM(INDEX((B2:B4,D2:D4),0,1,2))', 600],
    ['SUM(INDEX({1,10;2,20},0,2))', 30],
    ['ROW(INDEX(B2:D4,2,0))', 3],
    ['COLUMN(INDEX(B2:D4,0,2))', 3],
  ]) {
    set('F2', `=${formula}`);
    expect(at('F2'), formula).toBe(expected);
  }
});

it('preserves implicit intersection with the selected source row or column', () => {
  const { set, at } = book();
  set('F3', '=@INDEX(B2:D4,0,2)');
  set('C6', '=@INDEX(B2:D4,2,0)');
  expect(at('F3')).toBe(20);
  expect(at('C6')).toBe(20);
});

it('retains scalar lookups and rejects indices outside the array', () => {
  const { set, at } = book();
  for (const [formula, expected] of [
    ['INDEX(B2:D4,2,3)', 200],
    ['INDEX(B2:D2,2)', 10],
    ['INDEX(B2:B4,2)', 2],
    ['INDEX(B2:D4,0,4)', { error: '#REF!' }],
    ['INDEX(B2:D4,4,0)', { error: '#REF!' }],
    ['INDEX(B2:D4,-1,0)', { error: '#REF!' }],
    ['INDEX((B2:B4,D2:D4),0,1,3)', { error: '#REF!' }],
  ]) {
    set('F2', `=${formula}`);
    expect(at('F2'), formula).toEqual(expected);
  }
});

it('recalculates, blocks obstructed spills, and round-trips selected ranges', async () => {
  const { wb, id, set, at } = book();
  set('F2', '=INDEX(B2:D4,0,2)');
  set('C3', '99');
  expect(at('F3')).toBe(99);
  set('F3', 'Blocked');
  expect(at('F2')).toEqual({ error: '#SPILL!' });
  wb.undo();
  expect(at('F3')).toBe(99);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'index.xlsx');
  expect(back.getValue(back.sheets[0].id, 2, 5)).toBe(99);
  expect(wb.getCell(id, 1, 5).f).toBe('INDEX(B2:D4,0,2)');
});
