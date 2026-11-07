import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// lockedIn answers whether a range is protected and announces it, the way the refused edit would, so
// the editor explains once. A dialog that wants to grey a control out beforehand needs the answer alone,
// or the user hears about the protection twice.
describe('isLockedIn', () => {
  it('answers like lockedIn without announcing anything', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const two = wb.addSheet('Two').id;
    wb.protectRange(id, { r1: 2, c1: 2, r2: 4, c2: 4 }, 'core');
    wb.setSheetProtected(two, true);
    const events = [];
    wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') events.push(e.detail); });
    expect(wb.isLockedIn(id, { r1: 0, c1: 0, r2: 1, c2: 1 })).toBe(false);
    expect(wb.isLockedIn(id, { r1: 4, c1: 4, r2: 9, c2: 9 })).toBe(true); // overlaps the corner
    expect(wb.isLockedIn(id, { r1: 3, c1: 3, r2: 3, c2: 3 })).toBe(true); // inside
    expect(wb.isLockedIn(id, { r2: 0, c2: 0, r1: 5, c1: 5 })).toBe(true); // any corner order
    expect(wb.isLockedIn(two, { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(true); // a protected sheet
    expect(wb.isLockedIn('nope', { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(false);
    expect(events).toEqual([]);
    expect(wb.lockedIn(id, { r1: 3, c1: 3, r2: 3, c2: 3 })).toBe(true);
    expect(events).toEqual([{ type: 'protected', sheetId: id, range: { r1: 2, c1: 2, r2: 4, c2: 4 }, description: 'core' }]);
  });
});
