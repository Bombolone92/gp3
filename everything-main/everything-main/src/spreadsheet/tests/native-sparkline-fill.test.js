import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { nativeSparklineData } from '../src/core/native-sparkline-data.js';
const make = (extra = {}) => new Workbook({ sheets: [{ id: 's', name: 'Trends', cells: {
  '0,0': { v: 2 }, '0,1': { v: 3 }, '1,0': { v: 8 }, '1,1': { v: 9 },
}, sparklineGroups: [{ minAxisType: 'group', dateFormula: 'A20:B20', dateAxis: false,
  sparklines: [{ ref: 'D1', formula: 'Trends!A1:B1' }] }], ...extra }] });
const groups = wb => wb.sheet('s').sparklineGroups;
it('fills blank sparkline anchors, shares axes, recalculates and undoes as one edit', () => {
  const wb = make(), before = structuredClone(groups(wb));
  wb.fillDirection('s', parseRange('D1:D2'), 'down');
  expect(groups(wb)).toHaveLength(1);
  expect(groups(wb)[0]).toMatchObject({ uid: before[0].uid, dateFormula: 'A20:B20', sparklines: [
    { ref: 'D1', formula: 'Trends!A1:B1' }, { ref: 'D2', formula: 'Trends!A2:B2' },
  ] });
  expect(wb.getValue('s', 1, 3)).toBeNull();
  expect(nativeSparklineData(wb, 's', 1, 3).points.map(p => p.value)).toEqual([8, 9]);
  const after = structuredClone(groups(wb));
  wb.undo(); expect(groups(wb)).toEqual(before); wb.redo(); expect(groups(wb)).toEqual(after);
});
it('fills right and upward with mixed absolute references and coexisting text', () => {
  const wb = make({ cells: { '2,3': { v: 'Trend' } }, sparklineGroups: [{
    sparklines: [{ ref: 'D3', formula: "'Trends'!$A3:B$8" }],
  }] });
  wb.fillDirection('s', parseRange('D3:E3'), 'right');
  expect(groups(wb)[0].sparklines[1]).toEqual({ ref: 'E3', formula: "Trends!$A3:C$8" });
  expect(wb.getValue('s', 2, 4)).toBe('Trend');
  wb.fill('s', parseRange('D3'), parseRange('D1:D3'));
  expect(groups(wb)[0].sparklines.slice(2)).toEqual([
    { ref: 'D1', formula: "Trends!$A1:B$8" }, { ref: 'D2', formula: "Trends!$A2:B$8" },
  ]);
});
it('repeats source groups and replaces destination members without duplicate anchors', () => {
  const wb = make({ sparklineGroups: [
    { type: 'line', sparklines: [{ ref: 'D1', formula: 'A1:B1' }] },
    { type: 'column', sparklines: [{ ref: 'D2', formula: '$A$1:$B$1' }] },
    { type: 'stacked', sparklines: [{ ref: 'D3' }] },
  ] });
  wb.fill('s', parseRange('D1:D2'), parseRange('D1:D6'));
  expect(groups(wb).map(g => g.type)).toEqual(['line', 'column']);
  expect(groups(wb)[0].sparklines.map(s => s.ref)).toEqual(['D1', 'D3', 'D5']);
  expect(groups(wb)[1].sparklines.slice(1)).toEqual([
    { ref: 'D4', formula: '$A$1:$B$1' }, { ref: 'D6', formula: '$A$1:$B$1' },
  ]);
});
it('skips filtered rows and covered merged cells with the same mapping as scalar fill', () => {
  const wb = make({ merges: [parseRange('C3:D3')] });
  wb.sheet('s').filterHidden.add(1);
  wb.fill('s', parseRange('D1'), parseRange('D1:D4'));
  expect(groups(wb)[0].sparklines).toEqual([
    { ref: 'D1', formula: 'Trends!A1:B1' }, { ref: 'D4', formula: 'Trends!A4:B4' },
  ]);
});
it('refuses protected fill atomically even when all scalar cells are empty', () => {
  const wb = make(); wb.protectRange('s', parseRange('D3'), 'Keep');
  const before = wb.toJSON();
  wb.fill('s', parseRange('D1'), parseRange('D1:D4'));
  expect(wb.toJSON()).toEqual(before);
});
it('keeps optional missing sources and clears overwritten members for blank source positions', () => {
  const wb = make({ sparklineGroups: [{ sparklines: [{ ref: 'D1' }, { ref: 'D4', formula: 'A4:B4' }] }] });
  wb.fill('s', parseRange('D1:D2'), parseRange('D1:D4'));
  expect(groups(wb)[0].sparklines).toEqual([{ ref: 'D1' }, { ref: 'D3' }]);
});
it('refuses a partial fixed array overwrite before changing sparkline metadata', () => {
  const wb = make({ cells: { '0,3': { v: 'Trend' }, '1,2': { f: 'A1:B1', array: { rows: 1, cols: 2 } } } });
  const before = wb.toJSON();
  wb.fillDirection('s', parseRange('D1:D2'), 'down');
  expect(wb.toJSON()).toEqual(before);
});
it('grows the grid for a filled blank native anchor without inventing scalar content', () => {
  const wb = make(), r = wb.sheet('s').rows;
  wb.fill('s', parseRange('D1'), { r1: r, r2: r, c1: 3, c2: 3 });
  expect(wb.sheet('s').rows).toBeGreaterThan(r);
  expect(wb.getCell('s', r, 3)).toBeUndefined();
  expect(groups(wb)[0].sparklines[1].ref).toBe(`D${r + 1}`);
});
