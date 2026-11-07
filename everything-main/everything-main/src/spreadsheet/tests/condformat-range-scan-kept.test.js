import { describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// A colour scale, data bar, icon set, top/bottom or duplicate rule reads its whole range to paint one cell,
// and the grid rebuilds its viewport after every change: the scan was thrown away on every edit anywhere in
// the book, so a rule down a 19,000-row column re-read 152,000 cells per keystroke. It is now kept until a
// change that could have reached the values it read — and a rule over anything but plain values, or on a
// sheet where an array formula spills, is scanned afresh as before.

const bg = (wb, id, r, c) => wb.conditionalStyle(id, r, c, wb.getValue(id, r, c))?.bg ?? null;
const style = (wb, id, r, c) => wb.conditionalStyle(id, r, c, wb.getValue(id, r, c));

function small(values, rule) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  values.forEach((v, r) => { if (v != null) wb.setInput(id, r, 0, String(v)); });
  wb.addRule(id, rule);
  return { wb, id };
}

describe('a conditional-format rule\'s scan of its range', () => {
  it('is taken again when a value inside the range changes', () => {
    const { wb, id } = small([1, 2, 3, 4, 5], { type: 'scale', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } });
    const before = bg(wb, id, 2, 0);
    wb.setInput(id, 4, 0, '500'); // the range's own top value
    expect(bg(wb, id, 2, 0)).not.toBe(before);
    // and again when that edit is undone
    wb.undo();
    expect(bg(wb, id, 2, 0)).toBe(before);
  });

  it('is kept, with the same answer, when the change lands outside the range', () => {
    const { wb, id } = small([1, 2, 3, 4, 5], { type: 'scale', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } });
    const before = bg(wb, id, 2, 0);
    wb.setInput(id, 40, 3, '9999');
    wb.addSheet('Other');
    wb.setInput(wb.sheets[1].id, 0, 0, '12345');
    wb.setColWidth(id, 5, 150);
    wb.setHidden(id, 'row', [30], true);
    expect(bg(wb, id, 2, 0)).toBe(before);
  });

  it('says what a book in that state would say after rows are dragged, inserted and deleted', () => {
    const rule = { type: 'scale', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } };
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    [1, 2, 3, 4, 500].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
    wb.addRule(id, rule);
    for (const edit of [() => wb.moveRows(id, 4, 1, 20), () => wb.insertRows(id, 1, 2), () => wb.deleteRows(id, 0, 1)]) {
      bg(wb, id, 2, 0); // take the scan, so a stale one would be there to be reused
      edit();
      // The same contents and the same rule, in a book that has never scanned anything.
      const fresh = new Workbook();
      const fid = fresh.sheets[0].id;
      for (const [key, cell] of wb.sheet(id).cells) if (cell.v != null) fresh.setInput(fid, Number(key.split(',')[0]), Number(key.split(',')[1]), String(cell.v));
      fresh.addRule(fid, wb.sheet(id).rules[0]);
      for (let r = 0; r < 8; r++) expect([r, bg(wb, id, r, 0)]).toEqual([r, bg(fresh, fid, r, 0)]);
    }
  });

  it('is taken again when a formula inside the range is fed from outside it', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    for (let r = 0; r < 4; r++) wb.setInput(id, r, 0, String(r + 1));
    wb.setInput(id, 4, 0, '=D1*1'); // inside the rule's range, read from outside it
    wb.setInput(id, 0, 3, '5');
    wb.addRule(id, { type: 'scale', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } });
    const before = bg(wb, id, 2, 0);
    wb.setInput(id, 0, 3, '500');
    expect(bg(wb, id, 2, 0)).not.toBe(before);
  });

  it('is taken again when a spill from outside the range grows into it', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 3, '10');
    wb.setInput(id, 0, 0, '=SEQUENCE(D1)'); // spills A1:A10, over the rule's range below it
    wb.addRule(id, { type: 'scale', range: { r1: 4, c1: 0, r2: 9, c2: 0 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } });
    const before = bg(wb, id, 6, 0);
    expect(before).not.toBe(null);
    wb.setInput(id, 0, 3, '6'); // the spill shrinks to A1:A6: the rule's range is nearly empty
    expect(bg(wb, id, 6, 0)).not.toBe(before);
  });

  it('is taken again for a top rule and for a duplicate rule when their range changes', () => {
    const top = small([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { type: 'top', value: 2, range: { r1: 0, c1: 0, r2: 9, c2: 0 }, style: { bold: true } });
    expect(style(top.wb, top.id, 2, 0)).toBe(null);
    top.wb.setInput(top.id, 2, 0, '999');
    expect(style(top.wb, top.id, 2, 0)).toMatchObject({ bold: true });

    const dup = small([1, 2, 3, 4, 5], { type: 'dup', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, style: { bold: true } });
    expect(style(dup.wb, dup.id, 0, 0)).toBe(null);
    dup.wb.setInput(dup.id, 4, 0, '1');
    expect(style(dup.wb, dup.id, 0, 0)).toMatchObject({ bold: true });
    expect(style(dup.wb, dup.id, 1, 0)).toBe(null);
  });

  it('is taken again when a volatile formula in the range is recalculated', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, '0');
    wb.setInput(id, 1, 0, '100');
    wb.setInput(id, 2, 0, '=RAND()*1000');
    wb.addRule(id, { type: 'scale', range: { r1: 0, c1: 0, r2: 2, c2: 0 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } });
    const seen = new Set();
    for (let i = 0; i < 12; i++) { seen.add(bg(wb, id, 1, 0)); wb.recalculate(); }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('does not re-read the range for an edit that cannot reach it', { timeout: 60000 }, () => {
    const ROWS = 3000, COLS = 8;
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.ensureSize(id, ROWS + 10, 26);
    const entries = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) entries.push({ r, c, cell: { v: (r * 7 + c) % 500, f: null } });
    wb.setCells(id, entries, 'Fill');
    wb.addRule(id, { type: 'scale', range: { r1: 0, c1: 0, r2: ROWS - 1, c2: COLS - 1 }, min: { color: '#ffffff' }, max: { color: '#ff0000' } });

    // One viewport's worth of painting, as the grid does after every change.
    const paint = () => { for (let r = 0; r < 40; r++) for (let c = 0; c < 12; c++) wb.conditionalStyle(id, r, c, wb.getValue(id, r, c)); };
    const computesFor = (run) => {
      const spy = vi.spyOn(wb, '_compute');
      try { run(); return spy.mock.calls.length; } finally { spy.mockRestore(); }
    };
    paint();
    // A value typed well outside the rule's range, on both axes, then the frame that follows it.
    wb.setInput(id, ROWS + 3, 11, 'x');
    const after = computesFor(paint);
    // The viewport itself is 480 cells; the rescan this used to force was another ROWS × COLS = 24,000.
    expect(after).toBeLessThan(40 * 12 * 3);

    // And the rescan still happens, once, when the edit does land inside the range.
    wb.setInput(id, 10, 2, '999999');
    const reached = computesFor(paint);
    expect(reached).toBeGreaterThan(ROWS * COLS);
    // The second frame after it costs the viewport again, not the range.
    expect(computesFor(paint)).toBeLessThan(40 * 12 * 3);
  });
});
