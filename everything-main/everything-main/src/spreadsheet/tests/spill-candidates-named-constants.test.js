import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Every formula that mentioned a defined name was taken for a possible spill, so after each edit
// the whole column of =A1*Tax was re-evaluated to find out where the spills lie: a keystroke in a
// 50,000-row model that uses a named constant cost a tenth of a second and grew with the sheet.

/** How many cell calculations a read costs. */
function computes(wb, read) {
  const original = wb._compute;
  let n = 0;
  wb._compute = function (...args) { n++; return original.apply(this, args); };
  try { read(); } finally { wb._compute = original; }
  return n;
}

function column(formula, rows = 5000) {
  const cells = {};
  for (let r = 0; r < rows; r++) { cells[`${r},0`] = { v: r + 1 }; cells[`${r},1`] = { f: formula(r + 1) }; }
  const wb = new Workbook({ sheets: [{ name: 'S', rows: rows + 10, cols: 8, cells }] });
  return { wb, id: wb.activeSheetId };
}

it.each([
  ['a named constant', (r) => `A${r}*Tax`, '0.2'],
  ['a named single cell', (r) => `A${r}*Tax`, 'S!$H$1'],
  ['a sheet-qualified name', (r) => `A${r}*S!Tax`, '0.2'],
  ['a name inside an aggregate', (r) => `SUM(A${r},Tax)`, '0.2'],
  ['a name in a condition', (r) => `IF(A${r}>Tax,1,0)`, '0.2'],
  ['a named formula of one value', (r) => `A${r}*Tax`, 'S!$H$1*2'],
])('does not re-evaluate a column of formulas using %s after an unrelated edit', (_, formula, ref) => {
  const { wb, id } = column(formula);
  wb.setInput(id, 0, 7, '0.2');
  expect(wb.defineName('Tax', ref)).toBeNull();
  wb.getValue(id, 0, 1);
  wb.setInput(id, 0, 5, 'note');
  // A screen of sixty rows and one blank cell cost those cells and what they read, nothing proportional to the sheet.
  const n = computes(wb, () => { for (let r = 0; r < 60; r++) wb.getValue(id, r, 1); wb.getValue(id, 5005, 5); });
  expect(n).toBeLessThan(400);
  expect(wb.getValue(id, 4999, 1)).not.toBeNull();
});

it('still settles names that stand for ranges or array formulas as spills', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const s = wb.sheet(id).name;
  [1, 2, 3].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  expect(wb.defineName('Rng', `${s}!$A$1:$A$3`)).toBeNull();
  expect(wb.defineName('Seq', 'SEQUENCE(3)')).toBeNull();
  expect(wb.defineName('Twice', 'Rng*2')).toBeNull(); // a named formula over a named range
  expect(wb.defineName('Tax', '0.2')).toBeNull();
  wb.setInput(id, 0, 2, '=Rng*10');
  wb.setInput(id, 0, 3, '=Seq');
  wb.setInput(id, 0, 4, '=Twice');
  wb.setInput(id, 0, 5, `=${s}!Rng+1`);
  wb.setInput(id, 0, 6, '=Tax*2');
  wb.setInput(id, 0, 7, '=SUM(Rng)');
  wb.setInput(id, 0, 8, '=Nope*2');
  expect(wb.getValue(id, 2, 2)).toBe(30);
  expect(wb.getValue(id, 2, 3)).toBe(3);
  expect(wb.getValue(id, 2, 4)).toBe(6);
  expect(wb.getValue(id, 2, 5)).toBe(4);
  expect(wb.getValue(id, 0, 6)).toBeCloseTo(0.4);
  expect(wb.getValue(id, 1, 6)).toBeNull();
  expect(wb.getValue(id, 0, 7)).toBe(6);
  expect(wb.getValue(id, 1, 7)).toBeNull();
  expect(wb.getValue(id, 0, 8)).toEqual({ error: '#NAME?' });
  const candidate = (c) => wb._isArrayCandidate(wb._cellAst(wb.sheet(id).cells.get(`0,${c}`)), s);
  expect([2, 3, 4, 5].map(candidate)).toEqual([true, true, true, true]);
  expect([6, 7, 8].map(candidate)).toEqual([false, false, false]);
});

it('follows a name redefined between a constant and a range, through undo, rename and deletion', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const s = wb.sheet(id).name;
  [1, 2, 3].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  expect(wb.defineName('Tax', '0.5')).toBeNull();
  wb.setInput(id, 0, 2, '=Tax*2');
  expect(wb.getValue(id, 0, 2)).toBe(1);
  expect(wb.getValue(id, 1, 2)).toBeNull();
  expect(wb.defineName('Tax', `${s}!$A$1:$A$3`)).toBeNull();
  expect(wb.getValue(id, 0, 2)).toBe(2);
  expect(wb.getValue(id, 2, 2)).toBe(6);
  wb.undo();
  expect(wb.getValue(id, 0, 2)).toBe(1);
  expect(wb.getValue(id, 2, 2)).toBeNull();
  expect(wb.renameName('Tax', null, 'Levy', `${s}!$A$1:$A$3`)).toBeNull();
  expect(wb.getCell(id, 0, 2).f).toBe('Levy*2');
  expect(wb.getValue(id, 2, 2)).toBe(6);
  wb.deleteName('Levy');
  expect(wb.getValue(id, 0, 2)).toEqual({ error: '#NAME?' });
  expect(wb.getValue(id, 2, 2)).toBeNull();
});
