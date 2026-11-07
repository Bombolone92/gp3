import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/**
 * A hidden sheet has no tab, so it must never be the active one: _load and _restore both move the
 * active sheet away from a hidden one. Import → replace kept the replaced sheet's hidden flag but
 * made it active anyway, leaving the grid drawing a sheet with no tab until the next structural undo
 * silently moved the user somewhere else.
 */
function otherBook() {
  const other = new Workbook();
  const otherId = other.sheets[0].id;
  other.setInput(otherId, 0, 0, 'imported');
  return { other, otherId };
}

describe('replacing a hidden sheet', () => {
  it('leaves the visible sheet the user is on active', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    const b = wb.addSheet().id;
    wb.setSheetHidden(b, true);
    expect(wb.activeSheetId).toBe(a);
    const { other, otherId } = otherBook();
    expect(wb.replaceSheetWith(b, other, otherId)).toBeTruthy();
    expect(wb.sheet(b).hidden).toBe(true);
    expect(wb.activeSheetId).toBe(a);
    expect(wb.getValue(b, 0, 0)).toBe('imported');
  });

  it('keeps the active sheet through undo and reload', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    const b = wb.addSheet().id;
    wb.setSheetHidden(b, true);
    const { other, otherId } = otherBook();
    wb.replaceSheetWith(b, other, otherId);
    wb.setInput(a, 0, 0, 'after');
    wb.undo();
    expect(wb.activeSheetId).toBe(a);
    wb.undo();
    expect(wb.activeSheetId).toBe(a);
    expect(new Workbook(wb.toJSON()).activeSheetId).toBe(a);
  });

  it('still moves to a visible sheet it replaces', () => {
    const wb = new Workbook();
    const a = wb.sheets[0].id;
    const b = wb.addSheet().id;
    wb.setActiveSheet(a);
    const { other, otherId } = otherBook();
    wb.replaceSheetWith(b, other, otherId);
    expect(wb.activeSheetId).toBe(b);
  });
});
