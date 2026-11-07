import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/** Count the entries walked by for-of over any Map while `fn` runs. */
function mapStepsDuring(fn) {
  const orig = Map.prototype[Symbol.iterator];
  let steps = 0;
  Map.prototype[Symbol.iterator] = function () {
    const it = orig.call(this);
    return { next: () => { const r = it.next(); if (!r.done) steps++; return r; }, [Symbol.iterator]() { return this; } };
  };
  try { fn(); } finally { Map.prototype[Symbol.iterator] = orig; }
  return steps;
}

function sheetOf(rows, cols, value = (r, c) => (r * 7 + c * 3) % 1000) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.ensureSize(id, rows + 5, cols);
  const entries = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) entries.push({ r, c, cell: { v: value(r, c), f: null } });
  wb.setCells(id, entries, 'fill');
  return { wb, id };
}

const WHOLE_ROWS = 1048575;
const column = (c) => ({ r1: 0, c1: c, r2: WHOLE_ROWS, c2: c });

// Colour scales, duplicate and top-N rules gather their range's values once per edit; a rule over a
// whole column walked every stored cell of the sheet for that, so six such rules on a 200,000-cell
// sheet added 54 ms to every keystroke.
describe('rules over whole columns on a large sheet', () => {
  it('read the rule\'s own column, not every cell of the sheet, after an edit', { timeout: 60000 }, () => {
    const { wb, id } = sheetOf(20000, 10);
    wb.addRule(id, { range: column(0), type: 'scale', from: '#000000', to: '#ffffff' });
    wb.addRule(id, { range: column(1), type: 'dup', style: { bg: '#ff0000' } });
    wb.addRule(id, { range: column(2), type: 'top', value: 10, style: { bg: '#00ff00' } });
    wb.addRule(id, { range: column(3), type: 'databar', color: '#0000ff' });
    wb.addRule(id, { range: column(4), type: 'icons', set: 'arrows' });
    wb.addRule(id, { range: column(5), type: 'unique', style: { bg: '#ffff00' } });
    wb.conditionalStyle(id, 0, 0, wb.getValue(id, 0, 0));
    const cells = wb.sheet(id).cells.size;
    expect(cells).toBe(200000);
    // An edit no rule covers drops the per-version caches, as any keystroke does; the grid then asks for
    // the style of every cell it draws (the spill index is built first, as drawing a blank cell does).
    wb.setInput(id, 20001, 8, 'x');
    wb.spillAt(id, 20002, 8);
    const steps = mapStepsDuring(() => { for (let r = 0; r < 40; r++) for (let c = 0; c < 6; c++) wb.conditionalStyle(id, r, c, wb.getValue(id, r, c)); });
    expect(steps).toBeLessThan(cells / 10);
    // The styles are those of the column's values.
    expect(wb.conditionalStyle(id, 0, 0, 0)).toEqual({ bg: '#000000' }); // the smallest value of column A
    expect(wb.conditionalStyle(id, 0, 1, wb.getValue(id, 0, 1))).toEqual({ bg: '#ff0000' }); // 1000 distinct values over 20000 rows repeat
  });

  it('gives the same answers whether the range is read by coordinate or by walking the cells', () => {
    const { wb, id } = sheetOf(100, 10);
    const cells = wb.sheet(id).cells.size;
    // A1:A100 holds fewer cells than the sheet stores and is read by coordinate; A1:J100 holds as many and is walked.
    wb.addRule(id, { range: { r1: 0, c1: 0, r2: 99, c2: 0 }, type: 'scale', from: '#000000', to: '#ffffff' });
    wb.addRule(id, { range: { r1: 0, c1: 0, r2: 99, c2: 9 }, type: 'scale', from: '#000000', to: '#ffffff' });
    expect((100 * 1) < cells && !((100 * 10) < cells)).toBe(true);
    const narrow = [], wide = [];
    for (let r = 0; r < 100; r++) {
      narrow.push(wb.conditionalStyle(id, r, 0, wb.getValue(id, r, 0)).bg);
      wide.push(wb.conditionalStyle(id, r, 1, wb.getValue(id, r, 1)).bg);
    }
    const other = sheetOf(100, 10);
    other.wb.addRule(other.id, { range: column(0), type: 'scale', from: '#000000', to: '#ffffff' });
    other.wb.addRule(other.id, { range: { r1: 0, c1: 0, r2: WHOLE_ROWS, c2: 9 }, type: 'scale', from: '#000000', to: '#ffffff' });
    for (let r = 0; r < 100; r++) {
      // Whole-column ranges clamp to the rows holding content and read the same values.
      expect(other.wb.conditionalStyle(other.id, r, 0, other.wb.getValue(other.id, r, 0)).bg).toBe(narrow[r]);
      expect(other.wb.conditionalStyle(other.id, r, 1, other.wb.getValue(other.id, r, 1)).bg).toBe(wide[r]);
    }
  });

  it('still count values an array formula spilled into the column, and formulas\' results', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(5)'); // A1:A5 = 1..5
    wb.setInput(id, 0, 2, '=A5*2'); // C1 = 10, the largest number of the sheet
    wb.addRule(id, { range: column(0), type: 'scale', from: '#000000', to: '#ffffff' });
    wb.addRule(id, { range: { r1: 0, c1: 0, r2: WHOLE_ROWS, c2: 2 }, type: 'top', value: 1, style: { bg: '#00ff00' } });
    expect(wb.conditionalStyle(id, 4, 0, wb.getValue(id, 4, 0))).toEqual({ bg: '#ffffff' }); // 5 is the column's maximum
    expect(wb.conditionalStyle(id, 0, 0, wb.getValue(id, 0, 0))).toEqual({ bg: '#000000' });
    expect(wb.conditionalStyle(id, 0, 2, wb.getValue(id, 0, 2))).toEqual({ bg: '#00ff00' }); // the top value is the formula's 10
    expect(wb.conditionalStyle(id, 4, 0, 5).bg).not.toBe('#00ff00');
  });

  it('paint nothing for a rule over an empty column, as before', () => {
    const { wb, id } = sheetOf(50, 2);
    wb.addRule(id, { range: column(5), type: 'scale', from: '#000000', to: '#ffffff' });
    wb.addRule(id, { range: column(6), type: 'top', value: 3, style: { bg: '#00ff00' } });
    expect(wb.conditionalStyle(id, 0, 5, null)).toBeNull();
    expect(wb.conditionalStyle(id, 0, 6, null)).toBeNull();
  });
});
