// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { readCopiedNativeSparklines } from '../src/core/native-sparkline-paste.js';
const make = () => new Workbook({ sheets: [{ id: 's', name: 'Source', cells: { '0,3': { v: 'Trend' } }, sparklineGroups: [{
  dateFormula: '$A$20:$B$20', minAxisType: 'group', colorSeries: { theme: 5, tint: 0.2 },
  sparklines: [{ ref: 'D1', formula: 'A1:$B$2' }, { ref: 'D3', formula: 'A3:B3' }],
}] }, { id: 't', name: 'Target' }] });
const copy = (wb, rows = [0], cols = [3]) => ({ cells: wb.copyCells('s', rows, cols),
  nativeSparklines: wb.copyNativeSparklines('s', rows, cols), origin: { r: rows[0], c: cols[0], rows, cols } });
const paste = (wb, clip, r, c, options = {}, id = 's', target = null) => wb.pasteCells(id, clip.cells, r, c, clip.origin, target, { nativeSparklines: clip.nativeSparklines, ...options });
const groups = (wb, id = 's') => wb.sheet(id).sparklineGroups;
it('copies live native members and text into the source group with atomic undo/redo', () => {
  const wb = make(), before = wb.toJSON();
  paste(wb, copy(wb), 3, 3);
  expect(groups(wb)).toHaveLength(1);
  expect(groups(wb)[0].sparklines.at(-1)).toEqual({ ref: 'D4', formula: 'A4:$B$2' });
  expect(wb.getValue('s', 3, 3)).toBe('Trend');
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
});
it('tiles compacted visible rows using each original source coordinate', () => {
  const wb = make(), clip = copy(wb, [0, 2]);
  paste(wb, clip, 4, 3, {}, 's', { r1: 4, r2: 7, c1: 3, c2: 3 });
  expect(groups(wb)[0].sparklines.slice(2)).toEqual([
    { ref: 'D5', formula: 'A5:$B$2' }, { ref: 'D6', formula: 'A6:B6' },
    { ref: 'D7', formula: 'A7:$B$2' }, { ref: 'D8', formula: 'A8:B8' },
  ]);
});
it('transposes destinations and shifts series independently while retaining group dates', () => {
  const wb = make(); paste(wb, copy(wb, [0, 2]), 4, 3, { transpose: true });
  expect(groups(wb)[0].sparklines.slice(2)).toEqual([
    { ref: 'D5', formula: 'A5:$B$2' }, { ref: 'E5', formula: 'B5:C5' },
  ]);
  expect(groups(wb)[0].dateFormula).toBe('$A$20:$B$20');
});
it('cross-sheet copies get a fresh identity and retain source-sheet bindings', () => {
  const wb = make(), clip = copy(wb);
  paste(wb, clip, 0, 3, {}, 't');
  expect(groups(wb, 't')[0].uid).not.toBe(groups(wb)[0].uid);
  expect(groups(wb, 't')[0]).toMatchObject({ dateFormula: 'Source!$A$20:$B$20', sparklines: [{ ref: 'D1', formula: 'Source!A1:$B$2' }] });
});
it('copied settings are snapshots and changed source settings do not absorb stale copies', () => {
  const wb = make(), clip = copy(wb);
  groups(wb)[0].colorSeries.tint = 0.5;
  paste(wb, clip, 4, 3);
  expect(groups(wb)).toHaveLength(2);
  expect(groups(wb)[1].colorSeries.tint).toBe(0.2);
  expect(groups(wb)[1].uid).not.toBe(groups(wb)[0].uid);
});
it('replaces destination native members, while formulas-only leaves them untouched', () => {
  const wb = make(), empty = copy(wb, [5]);
  const before = structuredClone(groups(wb));
  paste(wb, empty, 2, 3, { keepStyles: true }); expect(groups(wb)).toEqual(before);
  paste(wb, empty, 2, 3); expect(groups(wb)[0].sparklines.map(s => s.ref)).toEqual(['D1']);
});
it('skip blanks carries native-only charts but leaves truly empty positions untouched', () => {
  const wb = make(); paste(wb, copy(wb, [2, 3]), 4, 3, { skipBlanks: true });
  expect(groups(wb)[0].sparklines.at(-1)).toEqual({ ref: 'D5', formula: 'A5:B5' });
  expect(groups(wb)[0].sparklines).toHaveLength(3);
});
it('protected targets and check-only preflight leave native metadata untouched', () => {
  const wb = make(), clip = copy(wb); const before = wb.toJSON();
  expect(paste(wb, clip, 4, 3, { checkOnly: true })).toBe(true); expect(wb.toJSON()).toEqual(before);
  wb.protectRange('s', { r1: 4, r2: 4, c1: 3, c2: 3 }); const protectedState = wb.toJSON();
  paste(wb, clip, 4, 3); expect(wb.toJSON()).toEqual(protectedState);
});
it('HTML clipboard transports validated native groups and compacted coordinates across app tabs', () => {
  const wb = make(), clip = copy(wb, [0, 2]);
  const html = cellsToHtml([['Trend'], ['']], clip.cells, null, null, null, { nativeSparklines: clip.nativeSparklines });
  const parsed = parseHtmlClipboard(html, 'Trend\n');
  expect(parsed.nativeSparklines).toEqual(clip.nativeSparklines);
  paste(wb, parsed, 4, 3);
  expect(groups(wb)).toHaveLength(2); // serialized data cannot claim live same-sheet provenance
  expect(groups(wb)[1].sparklines).toEqual([{ ref: 'D5', formula: 'A5:$B$2' }, { ref: 'D6', formula: 'A6:B6' }]);
});
it('rejects invalid clipboard coordinates, repeated anchors and out-of-block destinations', () => {
  const clip = copy(make()).nativeSparklines;
  expect(readCopiedNativeSparklines({ ...clip, rows: [-1] }, 1, 1)).toBeNull();
  expect(readCopiedNativeSparklines({ ...clip, rows: [0, 0] }, 2, 1)).toBeNull();
  const bad = structuredClone(clip); bad.groups[0].sparklines[0].ref = 'B1';
  expect(readCopiedNativeSparklines(bad, 1, 1)).toBeNull();
  bad.groups[0].sparklines = [{ ref: 'A1' }, { ref: 'A1' }];
  expect(readCopiedNativeSparklines(bad, 1, 1)).toBeNull();
});
it('clips off-grid members and skips retained merge bodies', () => {
  const wb = make(), clip = copy(wb, [0, 2]);
  paste(wb, clip, 1048575, 3);
  expect(groups(wb)[0].sparklines.at(-1).ref).toBe('D1048576');
  expect(groups(wb)[0].sparklines).toHaveLength(3);
  wb.sheet('s').merges.push({ r1: 4, r2: 4, c1: 2, c2: 3 });
  paste(wb, clip, 4, 3);
  expect(groups(wb)[0].sparklines.at(-1).ref).toBe('D6');
  expect(groups(wb)[0].sparklines.some(s => s.ref === 'D5')).toBe(false);
});
it('copied merges commit native metadata and undo together', () => {
  const wb = make(), before = wb.toJSON(), clip = copy(wb, [0], [3, 4]);
  paste(wb, clip, 5, 3, { merges: [{ r1: 0, r2: 0, c1: 0, c2: 1 }] });
  expect(wb.sheet('s').merges).toContainEqual({ r1: 5, r2: 5, c1: 3, c2: 4 });
  expect(groups(wb)[0].sparklines.at(-1).ref).toBe('D6');
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('keeps an unqualified named source and date name bound to the original sheet', () => {
  const wb = make(); groups(wb)[0].sparklines[0].formula = 'Series'; groups(wb)[0].dateFormula = 'Dates';
  paste(wb, copy(wb), 0, 3, {}, 't');
  expect(groups(wb, 't')[0]).toMatchObject({ dateFormula: 'Source!Dates', sparklines: [{ ref: 'D1', formula: 'Source!Series' }] });
});
it('refused partial array writes leave copied sparklines and source groups intact', () => {
  const wb = make(); wb.sheet('s').cells.set('5,2', { f: '{1,2}', array: { rows: 1, cols: 2 } });
  const before = wb.toJSON(); paste(wb, copy(wb), 5, 3); expect(wb.toJSON()).toEqual(before);
});
