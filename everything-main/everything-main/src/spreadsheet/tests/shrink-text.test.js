import { expect, it } from 'vitest';
import { shrinkCellText } from '../src/core/shrink-text.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookToOds, workbookFromFile } from '../src/core/io.js';
import { nativeRoundTrip } from './helpers/linked-model-workbook.js';
import { xlsxAlignment } from '../src/core/xlsx-styles.js';
import * as X from '../src/vendor/xlsx.mjs';

const measure = (text, font) => text.length * Number(/([\d.]+)px/.exec(font)[1]) / 2;
it('fits text by measuring the display font without changing a stored size', () => {
  const fit = shrinkCellText({ text: 'abcdefghijklmnopqrst', font: '600 20px Arial', width: 80, measure });
  expect(fit.scale).toBeCloseTo(0.4, 2);
  expect(fit.measure('abcdefghijklmnopqrst')).toBeLessThanOrEqual(80);
  const full = shrinkCellText({ text: 'short', font: '20px Arial', width: 80, measure });
  expect(full.scale).toBe(1);
});
it('fits rich sizes and format padding together while retaining fill and source runs', () => {
  const parts = [{ type: 'text', text: 'AAAA', rich: true, s: { size: 40 } }, { type: 'pad', char: '0' }, { type: 'fill', char: '.' }];
  const before = structuredClone(parts);
  const fit = shrinkCellText({ text: 'AAAA', parts, font: '20px Arial', width: 40, measure });
  expect(fit.scale).toBeCloseTo(40 / 90, 2);
  expect(fit.measure('AAAA', parts[0]) + fit.measure('0')).toBeLessThanOrEqual(40);
  expect(parts).toEqual(before);
});
it('scales at worksheet zoom and fits the horizontal extent of rotated text', () => {
  const one = shrinkCellText({ text: 'abcdefghijklmnopqrst', font: '20px Arial', width: 80, measure });
  const two = shrinkCellText({ text: 'abcdefghijklmnopqrst', font: '40px Arial', zoom: 2, width: 160, measure });
  expect(two.scale).toBeCloseTo(one.scale, 3);
  const turned = shrinkCellText({ text: 'abcdefghijklmnopqrst', font: '20px Arial', width: 80, angle: 45, measure });
  expect((turned.measure('abcdefghijklmnopqrst') + 24 * turned.scale) / Math.sqrt(2)).toBeLessThanOrEqual(80);
});
it.each([0, -1, NaN, Infinity])('keeps font valid when there is no measurable room (%s)', width => {
  expect(shrinkCellText({ text: 'label', font: '20px Arial', width, measure }).scale).toBe(1);
});
it('reads the public alignment flag with its boolean lexical forms', () => {
  for (const value of [true, 1, '1', 'true']) expect(xlsxAlignment({ shrinkToFit: value })).toMatchObject({ shrink: true });
  for (const value of [false, 0, '0', 'false', 'yes', null]) expect(xlsxAlignment({ shrinkToFit: value })).not.toHaveProperty('shrink');
});
function fixture() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Long text without wrapping');
  wb.setInput(id, 0, 1, '=LEN(A1)');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, { shrink: true, size: 20, bold: true });
  wb.sheets[0].colStyles.set(3, { shrink: true });
  wb.setInput(id, 1, 3, 'Inherited');
  wb.setInput(id, 2, 3, 'Reset');
  wb.applyStyle(id, { r1: 2, r2: 2, c1: 3, c2: 3 }, { shrink: null });
  return wb;
}
function verify(wb) {
  const id = wb.activeSheetId;
  for (const c of [0, 1]) expect(wb.styleAt(id, 0, c)).toMatchObject({ shrink: true, size: 20, bold: true });
  expect(wb.getValue(id, 0, 1)).toBe(26);
  expect(wb.styleAt(id, 1, 3).shrink).toBe(true);
  expect(wb.styleAt(id, 2, 3).shrink || false).toBe(false);
  const before = wb.toJSON(); wb.setInput(id, 0, 0, 'Changed');
  expect(wb.getValue(id, 0, 1)).toBe(7); wb.undo(); expect(wb.toJSON()).toEqual(before);
}
it('preserves enabled cells and inherited resets through public XLSX, private XLSX, ODS and extraction', async () => {
  const wb = fixture();
  verify(await nativeRoundTrip(wb));
  verify(await workbookFromFile(await workbookToXlsx(wb), 'shrink.xlsx'));
  verify(await workbookFromFile(await workbookToOds(wb), 'shrink.ods'));
  verify(await nativeRoundTrip(wb.sheetToWorkbook(wb.activeSheetId)));
});
it('adopts a native Shrink flag edit instead of reinstating stale private metadata', async () => {
  const wb = fixture();
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const styles = X.CFB.find(zip, '/xl/styles.xml');
  styles.content = new TextEncoder().encode(new TextDecoder().decode(styles.content).replace(/shrinkToFit="1"/g, 'shrinkToFit="0"'));
  styles.size = styles.content.length;
  const copy = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
  expect(copy.styleAt(copy.activeSheetId, 0, 0).shrink || false).toBe(false);
  expect(copy.styleAt(copy.activeSheetId, 1, 3).shrink || false).toBe(false);
  expect(copy.getValue(copy.activeSheetId, 0, 1)).toBe(26);
});
