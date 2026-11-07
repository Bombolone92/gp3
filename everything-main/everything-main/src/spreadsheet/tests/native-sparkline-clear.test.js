import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
const make = () => new Workbook({ sheets: [{ id: 's', cells: { '0,3': { v: 'Keep text', s: { bold: true } }, '2,3': { f: '1+2' } }, notes: { '0,3': 'Keep note' }, sparklineGroups: [
  { minAxisType: 'group', sparklines: [{ ref: 'D1', formula: 'A1:C1' }, { ref: 'D3', formula: 'A3:C3' }] },
  { type: 'column', sparklines: [{ ref: 'F2', formula: 'A2:C2' }] },
] }] });
it('clears selected native members across disjoint ranges without changing cell contents or styles', () => {
  const wb = make(), before = wb.toJSON(), uid = wb.sheet('s').sparklineGroups[0].uid;
  expect(wb.clearNativeSparklines('s', [parseRange('D1'), parseRange('F2')])).toBe(2);
  expect(wb.sheet('s').sparklineGroups).toHaveLength(1);
  expect(wb.sheet('s').sparklineGroups[0]).toMatchObject({ uid, minAxisType: 'group', sparklines: [{ ref: 'D3', formula: 'A3:C3' }] });
  expect(wb.getCell('s', 0, 3)).toEqual({ v: 'Keep text', f: null, s: { bold: true } });
  expect(wb.getCell('s', 2, 3).f).toBe('1+2'); expect(wb.sheet('s').notes.get('0,3')).toBe('Keep note');
  const after = wb.toJSON(); expect(wb.undoLabels()).toHaveLength(1); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('clears every member of selected groups, including members outside the selection', () => {
  const wb = make(); expect(wb.clearNativeSparklines('s', [parseRange('D1')], { groups: true })).toBe(2);
  expect(wb.sheet('s').sparklineGroups.map(g => g.type)).toEqual(['column']);
});
it('preflights all affected groups and ranges before any removal', () => {
  const wb = make(); wb.protectRange('s', parseRange('D3')); const before = wb.toJSON();
  expect(wb.clearNativeSparklines('s', [parseRange('F2'), parseRange('D1')], { groups: true })).toBeNull(); expect(wb.toJSON()).toEqual(before);
  expect(wb.clearNativeSparklines('s', [parseRange('D1')])).toBe(1);
  wb.setSheetProtected('s', true); const locked = wb.toJSON();
  expect(wb.clearNativeSparklines('s', [parseRange('F2')])).toBeNull(); expect(wb.toJSON()).toEqual(locked);
});
it('does not let skipped rows select a group, but clearing a selected group removes its hidden members', () => {
  const wb = make(), skipRow = r => r === 0;
  expect(wb.clearNativeSparklines('s', [parseRange('D1')], { groups: true, skipRow })).toBe(0); expect(wb.canUndo()).toBe(false);
  expect(wb.clearNativeSparklines('s', [parseRange('D1:D3')], { skipRow })).toBe(1);
  wb.undo(); expect(wb.clearNativeSparklines('s', [parseRange('D3')], { groups: true, skipRow })).toBe(2);
});
it('keeps native charts when clearing scalar contents and creates no history for an empty chart selection', () => {
  const wb = make(), groups = structuredClone(wb.sheet('s').sparklineGroups);
  wb.clearRange('s', parseRange('D1'), { contents: true }); expect(wb.sheet('s').sparklineGroups).toEqual(groups);
  wb.clearHistory(); expect(wb.clearNativeSparklines('s', [parseRange('A1:C3')])).toBe(0); expect(wb.canUndo()).toBe(false);
});
