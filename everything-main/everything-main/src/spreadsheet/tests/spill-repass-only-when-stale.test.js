import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/** How many times the formula at (r, c) is evaluated while `fn` runs (each evaluation builds one context). */
function evaluationsOf(wb, sheetId, r, c, fn) {
  const original = wb._context;
  let n = 0;
  wb._context = function (sheet, rr, cc) { if (sheet.id === sheetId && rr === r && cc === c) n++; return original.call(this, sheet, rr, cc); };
  try { fn(); } finally { wb._context = original; }
  return n;
}

/** Every formula evaluation while `fn` runs. */
function evaluations(wb, fn) {
  const original = wb._context;
  let n = 0;
  wb._context = function (...args) { n++; return original.apply(this, args); };
  try { fn(); } finally { wb._context = original; }
  return n;
}

function twoColumns(rows) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, rows + 20, 12);
  const entries = [];
  for (let r = 0; r < rows; r++) entries.push({ r, c: 0, cell: { v: (r * 7919) % rows, f: null } }, { r, c: 1, cell: { v: `t${r}`, f: null } });
  wb.setCells(id, entries, 'fill');
  return { wb, id, rows };
}

// Working out a sheet's spills evaluated every array formula twice after any edit: a second pass, in case a
// formula had read a cell before the spill covering it landed. One SORT of 20,000 rows cost 60 ms a keystroke.
describe('the second pass over a sheet\'s array formulas', () => {
  it('is skipped when no formula could have read a cell a later spill covered, so a SORT is evaluated once per edit', () => {
    const { wb, id, rows } = twoColumns(2000);
    wb.setInput(id, 0, 4, `=SORT(A1:B${rows},1,-1)`);
    wb.spillAt(id, 5, 4);
    wb.setInput(id, rows + 1, 2, 'x'); // a cell nothing reads
    expect(evaluationsOf(wb, id, 0, 4, () => wb.spillAt(id, 5, 4))).toBe(1);
    expect(wb.spillAt(id, rows - 1, 4).value).toBe(0);
    expect(wb.getValue(id, 0, 4)).toBe(rows - 1);
  });

  it('is skipped for several array formulas at once, a chain through a spill reference included', () => {
    const { wb, id, rows } = twoColumns(500);
    wb.setInput(id, 0, 4, `=SORT(A1:B${rows},1,-1)`);
    wb.setInput(id, 0, 7, `=A1:A${rows}*2`);
    wb.setInput(id, 0, 9, '=UNIQUE(E1#)');
    wb.spillAt(id, 5, 4);
    wb.setInput(id, rows + 1, 2, 'x');
    expect(evaluations(wb, () => wb.spillAt(id, 5, 4))).toBe(3);
    expect(wb.getValue(id, 0, 7)).toBe(wb.getValue(id, 0, 0) * 2);
    expect(wb.getValue(id, 0, 9)).toBe(rows - 1);
    expect(wb.spillAt(id, 1, 9).value).toBe(wb.spillAt(id, 1, 4).value); // UNIQUE of the two sorted columns: J2 is E2
    expect(wb.spillAt(id, 1, 10).value).toBe(wb.spillAt(id, 1, 5).value);
  });

  it('is skipped when the sorted column holds formulas, each of which is calculated once', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const rows = 300;
    wb.ensureSize(id, rows + 20, 12);
    const entries = [];
    for (let r = 0; r < rows; r++) entries.push({ r, c: 0, cell: { v: (r * 37) % rows, f: null } }, { r, c: 1, cell: { v: null, f: `A${r + 1}*2` } });
    wb.setCells(id, entries, 'fill');
    wb.setInput(id, 0, 4, `=SORT(B1:B${rows},1,1)`);
    wb.spillAt(id, 5, 4);
    wb.setInput(id, rows + 1, 2, 'x');
    expect(evaluations(wb, () => wb.spillAt(id, 5, 4))).toBe(rows + 1);
    expect(wb.getValue(id, 0, 4)).toBe(0);
    expect(wb.spillAt(id, rows - 1, 4).value).toBe((rows - 1) * 2);
  });

  it('still runs when a formula read cells while blank that a spill then covered', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=C2:C3*2'); // A1, read first: C2 and C3 are blank until C1 spills
    wb.setInput(id, 0, 2, '=SEQUENCE(3)');
    expect(wb.getValue(id, 0, 0)).toBe(4);
    expect(wb.spillAt(id, 1, 0).value).toBe(6);
    // The same through a function that reaches beyond its arguments, whose reads cannot be known from its text.
    const other = new Workbook();
    const oid = other.activeSheetId;
    other.setInput(oid, 0, 0, '=OFFSET(C1,1,0,2,1)*2');
    other.setInput(oid, 0, 2, '=SEQUENCE(3)');
    expect(other.getValue(oid, 0, 0)).toBe(4);
    expect(other.spillAt(oid, 1, 0).value).toBe(6);
    // And a SUMIF, whose sum range takes the criteria range's shape: B2:B3 are read for the sum although only B2 is named.
    const third = new Workbook();
    const tid = third.activeSheetId;
    third.setInput(tid, 0, 0, '=SUMIF(D2:D3,">0",E2)');
    third.setInput(tid, 0, 3, '=SEQUENCE(3)');
    third.setInput(tid, 0, 4, '=SEQUENCE(3,1,10)');
    expect(third.getValue(tid, 0, 0)).toBe(23);
  });

  it('still runs for a formula whose own spill lands over cells it read', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 1, '1');
    wb.setInput(id, 1, 1, '2');
    wb.setInput(id, 0, 0, '=A1:B2*2'); // reads A2, which it then spills over
    const v = wb.getValue(id, 0, 0);
    expect(v).toEqual(expect.objectContaining({ error: expect.stringMatching(/#(CYCLE|SPILL)!/) }));
  });

  it('judges a formula on another sheet by the sheet its references name', () => {
    const wb = new Workbook();
    const one = wb.activeSheetId;
    const two = wb.addSheet('Two').id;
    wb.setInput(two, 0, 0, '=Sheet1!C2:C3*2');
    wb.setInput(one, 0, 2, '=SEQUENCE(3)');
    expect(wb.getValue(two, 0, 0)).toBe(4);
    expect(wb.spillAt(two, 1, 0).value).toBe(6);
    wb.setInput(one, 5, 5, 'x');
    expect(evaluationsOf(wb, one, 0, 2, () => wb.spillAt(one, 1, 2))).toBe(1);
  });
});
