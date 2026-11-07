import { describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function protectedBook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) wb.setInput(id, r, c, String(r * 10 + c));
  wb.protectRange(id, { r1: 2, c1: 1, r2: 3, c2: 1 }, 'Locked totals');
  wb.clearHistory();
  const events = [];
  wb.addEventListener('change', (e) => events.push(e.detail.type));
  return { wb, id, events, before: wb.toJSON() };
}

describe('structural edits and protected ranges', () => {
  it.each([
    ['deleting the rows', (wb, id) => wb.deleteRows(id, 2, 2)],
    ['deleting the column', (wb, id) => wb.deleteCols(id, 1, 1)],
    ['deleting cells that pull them up', (wb, id) => wb.deleteCells(id, { r1: 3, c1: 1, r2: 3, c2: 1 }, 'up')],
    ['deleting cells that pull them left', (wb, id) => wb.deleteCells(id, { r1: 2, c1: 1, r2: 2, c2: 1 }, 'left')],
    ['moving their rows', (wb, id) => wb.moveRows(id, 2, 2, 5)],
    ['moving their column', (wb, id) => wb.moveCols(id, 1, 1, 3)],
  ])('refuses %s and announces the protection', (_label, act) => {
    const { wb, id, events, before } = protectedBook();
    act(wb, id);
    expect(wb.toJSON()).toEqual(before);
    expect(wb.canUndo()).toBe(false);
    expect(events).toContain('protected');
  });

  it('still allows edits that only displace the protected cells', () => {
    const { wb, id, events } = protectedBook();
    wb.deleteRows(id, 0, 1);
    expect(wb.sheet(id).protectedRanges[0].range).toEqual({ r1: 1, c1: 1, r2: 2, c2: 1 });
    expect(wb.getValue(id, 1, 1)).toBe(21);
    wb.moveRows(id, 4, 1, 0);
    expect(wb.sheet(id).protectedRanges[0].range).toEqual({ r1: 2, c1: 1, r2: 3, c2: 1 });
    expect(wb.getValue(id, 2, 1)).toBe(21);
    wb.deleteCells(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, 'up');
    expect(events).not.toContain('protected');
    expect(wb.canUndo()).toBe(true);
  });

  it('keeps refusing after the sheet grows around the range', () => {
    const { wb, id } = protectedBook();
    const spy = vi.fn();
    wb.addEventListener('change', spy);
    wb.insertRows(id, 0, 1);
    expect(spy.mock.calls.some(([e]) => e.detail.type === 'protected')).toBe(false);
    wb.deleteRows(id, 3, 1);
    expect(spy.mock.calls.some(([e]) => e.detail.type === 'protected')).toBe(true);
    expect(wb.getValue(id, 3, 1)).toBe(21);
  });
});
