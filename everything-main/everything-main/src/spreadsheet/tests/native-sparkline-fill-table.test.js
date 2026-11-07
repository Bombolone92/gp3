import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
const make = (options = {}) => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Data', cells: {
    '0,0': { v: 'Trend' }, '0,1': { v: 'Calculated' },
    '1,3': { v: 2 }, '1,4': { v: 5 }, '2,3': { v: 3 }, '2,4': { v: 8 },
  }, sparklineGroups: [{ sparklines: [{ ref: 'A2', formula: 'D2:E2' }] }] }] });
  const tid = wb.addTable('s', parseRange('A1:B2'), { name: 'Trends', ...options });
  wb.setInput('s', 1, 1, '=ROW()*2'); wb.clearHistory();
  return { wb, tid, range: () => wb.tableById('s', tid).range };
};
it('extends a table for a native-only fill and populates its calculated column in one undo step', () => {
  const { wb, range } = make(), before = wb.toJSON();
  wb.fillDirection('s', parseRange('A2:A4'), 'down');
  expect(range()).toEqual(parseRange('A1:B4'));
  expect(wb.getValue('s', 2, 1)).toBe(6); expect(wb.getValue('s', 3, 1)).toBe(8);
  expect(wb.getCell('s', 2, 0)).toBeUndefined();
  expect(wb.sheet('s').sparklineGroups[0].sparklines.map(s => s.ref)).toEqual(['A2', 'A3', 'A4']);
  expect(wb.undoLabels()).toHaveLength(1); const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('leaves table bounds and native metadata unchanged when a destination is protected', () => {
  const { wb, range } = make(); wb.protectRange('s', parseRange('A3')); const before = wb.toJSON();
  wb.fillDirection('s', parseRange('A2:A4'), 'down');
  expect(range()).toEqual(parseRange('A1:B2')); expect(wb.toJSON()).toEqual(before);
});
it('does not grow for an unchanged native fill, a horizontal fill, or a table with totals', () => {
  const { wb, range } = make();
  wb.sheet('s').sparklineGroups[0].sparklines.push({ ref: 'A3', formula: 'D3:E3' });
  wb.fillDirection('s', parseRange('A2:A3'), 'down'); expect(range()).toEqual(parseRange('A1:B2'));
  wb.fillDirection('s', parseRange('A2:C2'), 'right'); expect(range()).toEqual(parseRange('A1:B2'));
  const totals = make({ totalsRow: true });
  totals.wb.fill('s', parseRange('A2'), parseRange('A4:A5')); expect(totals.range()).toEqual(parseRange('A1:B3'));
});
