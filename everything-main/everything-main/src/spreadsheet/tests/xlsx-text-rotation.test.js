import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { xlsxAlignment } from '../src/core/xlsx-styles.js';
import { readNativePivotPaint, nativePivotPaintLayers, nativePivotPaintAt } from '../src/core/native-pivot-paint.js';
import { writeNativePivotPaint } from '../src/core/native-pivot-paint-xml.js';
import { nativePivotPaintDelta } from '../src/core/native-pivot-paint-delta.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
const dxf = value => `<dxf xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><alignment textRotation="${value}"/></dxf>`;
it.each([[0, 0], [1, 1], [45, 45], [90, 90], [91, -1], [135, -45], [180, -90], [' +0091 ', -1]])('reads native angle %s as editor angle %s', (raw, expected) => {
  expect(xlsxAlignment({ textRotation: raw }).rot).toBe(expected);
  expect(readNativePivotPaint(dxf(raw))).toEqual({ rot: expected });
  expect(readNativePivotPaint(writeNativePivotPaint({ rot: expected }))).toEqual({ rot: expected });
  expect(nativePivotPaintDelta({ rot: expected, bold: true }, ['rot'])).toEqual({ rot: expected });
});
it.each(['', '181', '-1', '1.5', 'NaN', 'Infinity', '0x45', '1e2', '4294967296'])('rejects malformed or out-of-range native rotation %s', raw => {
  expect(xlsxAlignment({ textRotation: raw })).not.toHaveProperty('rot');
  expect(() => readNativePivotPaint(dxf(raw))).toThrow(/rotation/);
});
it.each([255, '+0255'])('keeps stacked text distinct from angular rotation (%s)', raw => {
  expect(xlsxAlignment({ textRotation: raw })).not.toHaveProperty('rot');
  expect(() => readNativePivotPaint(dxf(raw))).toThrow(/stacked-text.*not implemented/);
});
it.each([NaN, Infinity, -91, 91, 0.5, '45', false, null])('rejects unresolved editor rotation %s', rot => {
  expect(() => writeNativePivotPaint({ rot })).toThrow(/rotation/);
});
it('distinguishes omitted rotation from an explicit reset across differential layers', () => {
  const range = { r1: 2, r2: 4, c1: 3, c2: 5 };
  const layers = nativePivotPaintLayers([{ range, dxf: dxf(135) }, { range, dxf: writeNativePivotPaint({ bold: true }) },
    { range: { r1: 3, r2: 3, c1: 4, c2: 4 }, dxf: dxf(0) }]);
  expect(nativePivotPaintAt(layers, 2, 3, { base: { rot: 90 } })).toEqual({ rot: -45, bold: true });
  expect(nativePivotPaintAt(layers, 3, 4, { base: { rot: 90 } })).toEqual({ rot: 0, bold: true });
  expect(readNativePivotPaint(writeNativePivotPaint({}))).not.toHaveProperty('rot');
  expect(nativePivotPaintDelta({}, ['rot'])).toEqual({ rot: 0 });
  expect(nativePivotPaintDelta({ rot: null }, ['rot'])).toEqual({ rot: 0 });
});
it('retains ordinary cell rotation through native-only XLSX export and sheet extraction', async () => {
  const angles = [-90, -45, -1, 0, 1, 45, 90];
  let wb = new Workbook({ sheets: [{ name: 'Angles', cells: Object.fromEntries(angles.map((rot, r) => [`${r},0`, { v: `Angle ${rot}`, s: { rot, bg: '#abcdef' } }])) }] });
  const verify = w => angles.forEach((rot, r) => {
    expect(w.getValue(w.sheets[0].id, r, 0)).toBe(`Angle ${rot}`);
    expect(w.styleAt(w.sheets[0].id, r, 0).rot || 0).toBe(rot);
    expect(w.styleAt(w.sheets[0].id, r, 0).bg).toBe('#abcdef');
  });
  for (let i = 0; i < 2; i++) { wb = await nativeRoundTrip(wb); verify(wb); }
  verify(await nativeRoundTrip(wb.sheetToWorkbook(wb.sheets[0].id, { sourceWorkbook: '/Angles.xlsx' })));
});
it('preserves a horizontal cell reset over rotated column defaults on native import', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Inherited', cells: { '2,3': { v: 'Horizontal', s: { rot: null } }, '3,3': { v: 'Tilted' } } }] });
  wb.sheets[0].colStyles.set(3, { rot: -30 });
  const copy = await nativeRoundTrip(wb), id = copy.sheets[0].id;
  expect(copy.styleAt(id, 2, 3).rot || 0).toBe(0);
  expect(copy.styleAt(id, 3, 3).rot).toBe(-30);
});
