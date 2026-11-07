import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/** How many formula evaluations a read costs (each evaluation builds one context). */
function evaluations(wb, read) {
  const original = wb._context;
  let n = 0;
  wb._context = function (...args) { n++; return original.apply(this, args); };
  try { read(); } finally { wb._context = original; }
  return n;
}

function lookupSheet(formula, rows = 200) {
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 10, cols: 8, cells: Object.fromEntries(
    Array.from({ length: rows }, (_, r) => [[`${r},0`, { v: r + 1 }], [`${r},2`, { v: rows - r }], [`${r},1`, { f: formula(r + 1, rows) }]]).flat(),
  ) }] });
  return { wb, id: wb.activeSheetId };
}

it('does not re-evaluate INDEX/MATCH or XLOOKUP lookups sheet-wide after an unrelated edit', () => {
  for (const formula of [
    (r, n) => `INDEX($A$1:$A$${n},MATCH(C${r},$A$1:$A$${n},0))`,
    (r, n) => `XLOOKUP(C${r},$A$1:$A$${n},$A$1:$A$${n})`,
    (r, n) => `INDEX($A$1:$A$${n},XMATCH(C${r},$A$1:$A$${n}))`,
  ]) {
    const { wb, id } = lookupSheet(formula);
    expect(wb.getValue(id, 0, 1)).toBe(200);
    wb.setInput(id, 0, 5, 'note');
    // Reading a plain cell after the edit costs nothing, reading one lookup costs one evaluation.
    expect(evaluations(wb, () => wb.getValue(id, 0, 2))).toBe(0);
    expect(evaluations(wb, () => wb.getValue(id, 3, 1))).toBe(1);
    expect(wb.getValue(id, 3, 1)).toBe(197);
  }
});

it('evaluates array candidates that do not spill once per edit, not twice', () => {
  const { wb, id } = lookupSheet((r, n) => `INDEX($A$1:$A$${n},C${r})`);
  wb.setInput(id, 0, 5, 'note');
  // Showing a blank cell needs the sheet's spills worked out: one evaluation per candidate.
  expect(evaluations(wb, () => wb.getValue(id, 205, 5))).toBe(200);
});

it('still settles spills that land during discovery', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 1, '=SUM(A1:A3)');
  wb.setInput(id, 0, 0, '=SEQUENCE(3)');
  wb.setInput(id, 5, 5, 'x');
  expect(wb.getValue(id, 0, 1)).toBe(6);
  wb.setInput(id, 0, 0, '=SEQUENCE(4)');
  expect(wb.getValue(id, 0, 1)).toBe(6);
  expect(wb.getValue(id, 3, 0)).toBe(4);
  // A lookup returning a whole row of a two-column range still spills.
  const other = new Workbook();
  const oid = other.activeSheetId;
  [['1', 'x'], ['2', 'y'], ['3', 'z']].forEach(([a, b], r) => { other.setInput(oid, r, 0, a); other.setInput(oid, r, 1, b); });
  other.setInput(oid, 0, 2, '=XLOOKUP(2,A1:A3,A1:B3)');
  other.setInput(oid, 1, 2, '=XLOOKUP(3,A1:A3,B1:B3)');
  expect(other.getValue(oid, 0, 3)).toBe('y');
  expect(other.getValue(oid, 0, 2)).toBe(2);
  expect(other.getValue(oid, 1, 2)).toBe('z');
});
