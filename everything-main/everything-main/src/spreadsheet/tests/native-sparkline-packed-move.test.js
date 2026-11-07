import { expect, it } from 'vitest';
import { cellName } from '../src/core/cell.js';
import { Workbook } from '../src/core/workbook.js';
const make = () => new Workbook({ sheets: [
  { id: 's', name: 'Source', sparklineGroups: [{ dateFormula: 'A10:B10', sparklines: [
    { ref: 'D1', formula: 'A1:B1' }, { ref: 'D2', formula: 'A2:B2' }, { ref: 'D3', formula: 'A3:B3' },
  ] }] }, { id: 't', name: 'Target', sparklineGroups: [{ sparklines: [{ ref: 'G5', formula: 'Source!$A$3:$B$3' }] }] },
] });
const move = (wb, rows, cols, r, c, to = 's') => wb.transaction('Move cells', () => wb.moveNativeSparklinesFromCells('s', to, rows, cols, r, c));
const sparks = (wb, id = 's') => wb.sheet(id).sparklineGroups.flatMap(g => g.sparklines);
it('packs visible destinations once, leaves hidden members, and replaces overwritten destinations', () => {
  const wb = make(), before = wb.toJSON();
  move(wb, [0, 2], [3], 1, 3);
  expect(sparks(wb)).toEqual([{ ref: 'D2', formula: 'A1:B1' }, { ref: 'D3', formula: 'A3:B3' }]);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('splits groups across sheets with fresh identities and explicit source bindings', () => {
  const wb = make(), uid = wb.sheet('s').sparklineGroups[0].uid;
  move(wb, [0, 2], [3], 4, 6, 't');
  expect(sparks(wb)).toEqual([{ ref: 'D2', formula: 'A2:B2' }]);
  expect(sparks(wb, 't')).toEqual([{ ref: 'G5', formula: 'Source!A1:B1' }, { ref: 'G6', formula: 'Source!A3:B3' }]);
  const group = wb.sheet('t').sparklineGroups[0];
  expect(group.uid).not.toBe(uid); expect(group.dateFormula).toBe('Source!A10:B10');
});
it('follows moved source vectors everywhere, including absolute refs, only once', () => {
  const wb = make();
  wb.sheet('t').sparklineGroups[0].sparklines[0].ref = 'H5';
  move(wb, [0, 2], [0, 1, 3], 4, 4, 't');
  expect(sparks(wb)).toEqual([{ ref: 'D2', formula: 'A2:B2' }]);
  expect(sparks(wb, 't')).toEqual([
    { ref: 'H5', formula: 'Target!$E$6:$F$6' },
    { ref: 'G5', formula: 'Target!E5:F5' }, { ref: 'G6', formula: 'Target!E6:F6' },
  ]);
});
it('retains references spanning hidden source cells and three-dimensional ranges', () => {
  const wb = make(); wb.sheet('t').sparklineGroups[0].sparklines.push(
    { ref: 'H5', formula: 'Source!A1:A3' }, { ref: 'I5', formula: 'Source:Target!A1:B1' });
  move(wb, [0, 2], [0, 1], 5, 4);
  expect(sparks(wb, 't').slice(1)).toEqual([
    { ref: 'H5', formula: 'Source!A1:A3' }, { ref: 'I5', formula: 'Source:Target!A1:B1' },
  ]);
});
it('preserves a whole group identity and source-scoped names when every member moves', () => {
  const wb = make(); expect(wb.defineName('SeriesValues', 'Source!A1:B1', 'Source')).toBeNull();
  wb.sheet('s').sparklineGroups[0].sparklines[0].formula = 'SeriesValues';
  const uid = wb.sheet('s').sparklineGroups[0].uid;
  move(wb, [0, 1, 2], [3], 10, 6, 't');
  expect(wb.sheet('s').sparklineGroups).toEqual([]);
  expect(wb.sheet('t').sparklineGroups[1].uid).toBe(uid);
  expect(sparks(wb, 't')[1].formula).toBe('Source!SeriesValues');
});


it.each(['s', 't'])('indexes fragmented row and column selections when moving anchors to %s', to => {
  let reads = 0;
  const indexed = length => new Proxy(Array.from({ length }, (_, i) => i * 2), {
    get(target, key, receiver) { if (/^\d+$/.test(String(key))) reads++; return Reflect.get(target, key, receiver); },
  });
  const rows = indexed(80), cols = indexed(60), destination = cellName(579, 359);
  const wb = new Workbook({ sheets: [
    { id: 's', name: 'Source', sparklineGroups: [{ sparklines: [
      { ref: cellName(158, 118), formula: 'A1:A2' }, { ref: 'B2', formula: 'A3:A4' },
      ...(to === 's' ? [{ ref: destination, formula: 'A5:A6' }] : []),
    ] }] },
    { id: 't', name: 'Target', sparklineGroups: to === 't' ? [{ sparklines: [{ ref: destination, formula: 'A5:A6' }] }] : [] },
  ] });
  wb.ensureSize(to, 580, 360); const before = wb.toJSON();
  move(wb, rows, cols, 500, 300, to);
  // Work on selection indices must be linear, not their Cartesian product.
  expect(reads).toBeLessThanOrEqual(4 * (rows.length + cols.length));
  expect(sparks(wb, to).filter(s => s.ref === destination)).toEqual([
    { ref: destination, formula: to === 's' ? 'A1:A2' : 'Source!A1:A2' },
  ]);
  expect(sparks(wb).some(s => s.ref === 'B2')).toBe(true);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
