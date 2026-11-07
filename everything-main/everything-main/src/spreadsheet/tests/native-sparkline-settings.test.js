import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
const make = () => new Workbook({ sheets: [{ id: 's', cells: { '0,3': { v: 'Text' } }, sparklineGroups: [{
  colorSeries: { theme: 5, tint: .4 }, sparklines: [{ ref: 'D1', formula: 'A1:C1' }, { ref: 'D2', formula: 'A2:C2' }],
}] }] });
it('edits shared settings and one series without changing scalar contents, with exact undo/redo', () => {
  const wb = make(), before = wb.toJSON(), uid = wb.sheet('s').sparklineGroups[0].uid;
  expect(wb.updateNativeSparkline('s', 'D1', { settings: { type: 'column', minAxisType: 'custom', manualMin: -10, displayHidden: true }, formula: 'A3:C3', expectedGroupUid: uid })).toBeNull();
  expect(wb.sheet('s').sparklineGroups[0]).toMatchObject({ uid, type: 'column', manualMin: -10, colorSeries: { theme: 5, tint: .4 }, sparklines: [{ ref: 'D1', formula: 'A3:C3' }, { ref: 'D2', formula: 'A2:C2' }] });
  expect(wb.getValue('s', 0, 3)).toBe('Text');
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('source-only edits can leave a protected sibling untouched, while group changes are atomic', () => {
  const wb = make(); wb.protectRange('s', { r1: 1, r2: 1, c1: 3, c2: 3 });
  const before = wb.toJSON(); expect(wb.updateNativeSparkline('s', 'D1', { settings: { high: true }, formula: 'A3:C3' })).toMatch(/protected/); expect(wb.toJSON()).toEqual(before);
  expect(wb.updateNativeSparkline('s', 'D1', { formula: 'A3:C3' })).toBeNull();
  expect(wb.updateNativeSparkline('s', 'D2', { formula: null })).toMatch(/protected/);
});
it('rejects invalid edits and stale group identities without changing the workbook', () => {
  const wb = make(), before = wb.toJSON();
  for (const settings of [{ type: 'pie' }, { lineWeight: -1 }, { uid: 'anything' }, { minAxisType: 'custom', manualMin: 2, maxAxisType: 'custom', manualMax: 1 }]) {
    expect(wb.updateNativeSparkline('s', 'D1', { settings })).toBeTypeOf('string'); expect(wb.toJSON()).toEqual(before);
  }
  expect(wb.updateNativeSparkline('s', 'D1', { expectedGroupUid: 'stale', settings: { high: true } })).toMatch(/changed/);
});
it('disconnects optional sources and colors, removes dormant bounds, and avoids no-op history', () => {
  const wb = make(); expect(wb.updateNativeSparkline('s', 'D1', { settings: {} })).toBeNull(); expect(wb.canUndo()).toBe(false);
  wb.updateNativeSparkline('s', 'D1', { settings: { colorSeries: null, manualMin: 30 }, formula: null });
  const group = wb.sheet('s').sparklineGroups[0]; expect(group.colorSeries).toBeUndefined(); expect(group.manualMin).toBeUndefined(); expect(group.sparklines[0]).toEqual({ ref: 'D1' });
});
