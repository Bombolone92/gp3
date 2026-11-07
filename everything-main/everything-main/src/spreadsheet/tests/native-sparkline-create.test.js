import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { nativeSparklineData } from '../src/core/native-sparkline-data.js';
const make = () => new Workbook({ sheets: [{ id: 's', name: 'Data', cells: { '0,0': { v: 1 }, '0,1': { v: 2 }, '0,4': { v: 'Keep', s: { bold: true } } } }] });
const groups = wb => wb.sheet('s').sparklineGroups;
it('creates row series, preserves cells, shares settings and undoes in one step', () => {
  const wb = make(), before = wb.toJSON();
  expect(wb.createNativeSparklines('s', { source: 'A1:C2', location: 'E1:E2', type: 'column' })).toBeNull();
  expect(groups(wb)[0]).toMatchObject({ type: 'column', sparklines: [{ ref: 'E1', formula: 'A1:C1' }, { ref: 'E2', formula: 'A2:C2' }] });
  expect(wb.getCell('s', 0, 4)).toMatchObject({ v: 'Keep', s: { bold: true } });
  const after = wb.toJSON(); expect(wb.undoLabels()).toHaveLength(1); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('maps column series to a horizontal destination and permits an explicit orientation', () => {
  const wb = make();
  expect(wb.createNativeSparklines('s', { source: '$A$1:B3', location: 'E4:F4', type: 'stacked' })).toBeNull();
  expect(groups(wb)[0].sparklines).toEqual([{ ref: 'E4', formula: '$A$1:A3' }, { ref: 'F4', formula: '$B$1:B3' }]);
  expect(wb.createNativeSparklines('s', { source: 'A1:B2', location: 'E5:F5', orientation: 'rows' })).toBeNull();
  expect(groups(wb)[1].sparklines.map(s => s.formula)).toEqual(['A1:B1', 'A2:B2']);
});
it.each(['A1:C1', 'A1:A3', 'A1'])('creates a single automatically oriented vector from %s', source => {
  const wb = make(); expect(wb.createNativeSparklines('s', { source, location: 'F8' })).toBeNull();
  expect(groups(wb)[0].sparklines).toEqual([{ ref: 'F8', formula: source }]);
});
it('keeps live names and spills for single series and refuses to flatten a named matrix', () => {
  const wb = make(); wb.defineName('Values', 'Data!$A$1:$C$1');
  expect(wb.createNativeSparklines('s', { source: 'Values', location: 'F1' })).toBeNull();
  expect(groups(wb)[0].sparklines[0].formula).toBe('Values');
  wb.setInput('s', 5, 0, '=SEQUENCE(3)');
  expect(wb.createNativeSparklines('s', { source: 'A6#', location: 'F2' })).toBeNull();
  expect(nativeSparklineData(wb, 's', 1, 5).points.map(p => p.value)).toEqual([1, 2, 3]);
  wb.defineName('Matrix', 'Data!$A$1:$C$2'); const before = wb.toJSON();
  expect(wb.createNativeSparklines('s', { source: 'Matrix', location: 'G1:G2' }).field).toBe('source'); expect(wb.toJSON()).toEqual(before);
});
it('keeps qualified foreign-sheet series while requiring a local destination', () => {
  const wb = make(); wb.addSheet("Other data");
  expect(wb.createNativeSparklines('s', { source: "'Other data'!A1:C2", location: 'Data!E1:E2' })).toBeNull();
  expect(groups(wb)[0].sparklines.map(s => s.formula)).toEqual(["'Other data'!A1:C1", "'Other data'!A2:C2"]);
  const before = wb.toJSON(); expect(wb.createNativeSparklines('s', { source: 'A1:C1', location: "'Other data'!E1" }).field).toBe('location'); expect(wb.toJSON()).toEqual(before);
});
it('accepts a merged destination as one anchor and refuses covered cells atomically', () => {
  const wb = make(); wb.mergeCells('s', parseRange('G1:H1'));
  expect(wb.createNativeSparklines('s', { source: 'A1:C1', location: 'G1:H1' })).toBeNull();
  expect(groups(wb)[0].sparklines[0].ref).toBe('G1'); const before = wb.toJSON();
  expect(wb.createNativeSparklines('s', { source: 'A1:C2', location: 'H1:H2' }).field).toBe('location'); expect(wb.toJSON()).toEqual(before);
});
it('refuses existing sparklines, protection, invalid shapes and out-of-bounds destinations without edits', () => {
  const wb = make(); wb.createNativeSparklines('s', { source: 'A1:C1', location: 'E1' }); wb.protectRange('s', parseRange('H2'));
  for (const options of [
    { source: 'A1:C2', location: 'E1:E2' }, { source: 'A1:C2', location: 'H1:H2' },
    { source: 'A1:C2', location: 'G1' }, { source: 'A1:C2', location: 'G1:H2' },
    { source: 'A1:C1', location: 'A1048577' }, { source: 'A1:C1', location: 'A:A' },
    { source: 'Missing!A1:C1', location: 'G1' }, { source: 'A1:C1', location: 'G1', type: 'bogus' },
  ]) { const before = wb.toJSON(); expect(wb.createNativeSparklines('s', options)).toBeTruthy(); expect(wb.toJSON()).toEqual(before); }
});
it('grows the grid for a blank destination and preserves creation through undo/redo', () => {
  const wb = make();
  expect(wb.createNativeSparklines('s', { source: 'A1:B1', location: 'AZ500' })).toBeNull();
  expect(wb.sheet('s').rows).toBeGreaterThanOrEqual(500); expect(wb.sheet('s').cols).toBeGreaterThanOrEqual(52);
  expect(wb.getValue('s', 499, 51)).toBeNull(); expect(nativeSparklineData(wb, 's', 499, 51).points.map(p => p.value)).toEqual([1, 2]);
  wb.undo(); expect(groups(wb)).toEqual([]); wb.redo(); expect(groups(wb)[0].sparklines[0].ref).toBe('AZ500');
});
