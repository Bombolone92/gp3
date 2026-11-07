import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// An array formula whose result was a single cell registered no spill, so A1# was #REF! for
// =SEQUENCE(1), and a dashboard built on =SUM(Filtered#) broke the moment a FILTER or UNIQUE
// narrowed to one row, recovering when it widened again. A dynamic-array formula whose
// result is 1x1 still has a spill range: the cell itself.

const REF = { error: '#REF!' };

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const at = (a1) => parseCellRef(a1);
  return {
    wb, id,
    set: (a1, text) => { const { r, c } = at(a1); wb.setInput(id, r, c, text); },
    val: (a1) => { const { r, c } = at(a1); return wb.getValue(id, r, c); },
    range: (a1) => { const { r, c } = at(a1); return wb.spillRangeAt(id, r, c); },
  };
}

describe('A1# for an array formula whose result is one cell', () => {
  it('refers to the cell itself', () => {
    const b = book();
    b.set('A1', '=SEQUENCE(1)');
    b.set('B1', '=SUM(A1#)');
    b.set('C1', '=ROWS(A1#)');
    b.set('D1', '=A1#*10');
    expect(b.val('B1')).toBe(1);
    expect(b.val('C1')).toBe(1);
    expect(b.val('D1')).toBe(10);
    expect(b.range('A1')).toEqual({ r1: 0, c1: 0, r2: 0, c2: 0 });
    // The cell covers no neighbour: nothing is spilled and no cell is blocked.
    expect(b.wb.spillAt(b.id, 0, 0)).toBeNull();
    expect(b.wb.spillAt(b.id, 1, 0)).toBeNull();
    expect(b.wb.spillEntries(b.id)).toEqual([]);
    b.set('A2', '7');
    expect(b.val('A1')).toBe(1);
  });

  it.each([
    ['UNIQUE', '=UNIQUE(A10:A11)', 5], ['SORT', '=SORT(A10)', 5], ['TRANSPOSE', '=TRANSPOSE(A10)', 5], ['TAKE', '=TAKE(SEQUENCE(5),1)', 1],
    ['a one-cell range', '=A10:A10', 5], ['MAP', '=MAP(A10,LAMBDA(x,x))', 5], ['CHOOSECOLS', '=CHOOSECOLS(A10:B10,1)', 5], ['IF over SEQUENCE', '=IF(TRUE,SEQUENCE(1))', 1],
    ['QUERY', '=QUERY(A10:B10,"select A")', 5], ['INDEX of one row', '=INDEX(A10:B10,0,1)', 5], ['OFFSET of a given height', '=OFFSET(A10,0,0,B11)', 5],
  ])('holds for %s', (_, formula, value) => {
    const b = book();
    b.set('A10', '5'); b.set('A11', '5'); b.set('B10', '6'); b.set('B11', '1');
    b.set('C1', formula);
    b.set('D1', '=SUM(C1#)');
    b.set('E1', '=COUNTA(C1#)');
    expect(b.val('C1')).toBe(value);
    expect(b.val('D1')).toBe(value);
    expect(b.val('E1')).toBe(1);
  });

  it('follows a FILTER as it narrows to one row and widens again, through undo and redo', () => {
    const b = book();
    b.set('A5', '1'); b.set('A6', '0'); b.set('A7', '0');
    b.set('A3', '=FILTER(A5:A7,A5:A7>0)');
    b.set('B3', '=SUM(A3#)');
    b.set('C3', '=ROWS(A3#)');
    expect(b.val('B3')).toBe(1);
    expect(b.val('C3')).toBe(1);
    b.set('A6', '3');
    expect(b.val('B3')).toBe(4);
    expect(b.val('C3')).toBe(2);
    expect(b.val('A4')).toBe(3);
    b.wb.undo();
    expect(b.val('B3')).toBe(1);
    expect(b.val('A4')).toBeNull();
    b.wb.redo();
    expect(b.val('B3')).toBe(4);
    expect(b.val('C3')).toBe(2);
  });

  it('does not slow the reads of a sheet holding thousands of one-cell array formulas', { timeout: 60000 }, () => {
    // A column of INDEX(A:A, ROW()-1) beside running totals: every total reads its own range, and the
    // window of each read is widened only by spills that cover blank cells, never by walking a
    // one-cell anchor per row.
    const rows = 1000;
    const build = (middle) => {
      const cells = {};
      for (let r = 0; r < rows; r++) {
        cells[`${r},0`] = { v: r + 1 };
        if (middle) cells[`${r},1`] = { f: 'INDEX($A:$A,ROW()-1)' };
        cells[`${r},2`] = { f: `SUM(A$1:A${r + 1})` };
      }
      return new Workbook({ sheets: [{ name: 'S', rows: rows + 10, cols: 8, cells }] });
    };
    const time = (wb) => {
      const id = wb.activeSheetId;
      const t0 = performance.now();
      for (let r = 0; r < rows; r++) wb.getValue(id, r, 2);
      expect(wb.getValue(id, rows - 1, 2)).toBe(rows * (rows + 1) / 2);
      return performance.now() - t0;
    };
    const plain = time(build(false));
    const wb = build(true);
    const withAnchors = time(wb);
    const st = wb._ensureSpills(wb.sheet(wb.activeSheetId));
    expect(st.anchors.size).toBe(rows - 1); // row 1 asks for row 0, a whole column: #SPILL!, no anchor
    expect(st.spread.size).toBe(0);
    expect(st.cover.size).toBe(0);
    expect(withAnchors).toBeLessThan(plain * 3 + 500);
  });

  it('still answers #REF! for a formula that is no array formula', () => {
    const b = book();
    b.set('A10', '5');
    b.set('A1', '=5');
    b.set('A2', '=A10');
    b.set('A3', '=INDEX($A:$A,ROW())');
    b.set('A4', '=A10*2');
    b.wb.defineName('Tax', 'Sheet1!$A$10');
    b.set('A5', '=Tax');
    for (const [k, a1] of ['A1', 'A2', 'A3', 'A4', 'A5'].entries()) {
      b.set(`C${k + 1}`, `=SUM(${a1}#)`);
      expect(b.val(`C${k + 1}`)).toEqual(REF);
      expect(b.range(a1)).toBeNull();
    }
    // Reading the whole column registered nothing sheet-wide.
    expect(b.wb._ensureSpills(b.wb.sheet(b.id)).anchors.size).toBe(0);
  });

  it('is written to .xlsx as a one-cell array formula and read back', async () => {
    const b = book();
    b.set('A1', '=SEQUENCE(1)');
    b.set('B1', '=SUM(A1#)');
    const back = await workbookFromFile(await workbookToXlsx(b.wb), 'one.xlsx');
    const id = back.activeSheetId;
    expect(back.getCell(id, 0, 0).f).toBe('SEQUENCE(1)');
    expect(back.getValue(id, 0, 0)).toBe(1);
    expect(back.getValue(id, 0, 1)).toBe(1);
  });
});
