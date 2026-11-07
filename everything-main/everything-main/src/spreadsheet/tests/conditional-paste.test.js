// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { conditionalRuleFormula } from '../src/core/condformat-formula.js';
import { scaleThresholdFormula } from '../src/core/conditional-scale.js';
import { duplicateSourceAreas } from '../src/core/conditional-duplicates.js';
const g = (r1, c1, r2 = r1, c2 = c1) => ({ r1, c1, r2, c2 });
const look = (wb, r, c = 0) => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c));
const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
function copy(wb, range, rows = seq(range.r1, range.r2), cols = seq(range.c1, range.c2)) {
  return { cells: wb.copyCells(wb.activeSheetId, rows, cols), conditionalFormats: wb.copyConditionalFormats(wb.activeSheetId, rows, cols),
    origin: { r: range.r1, c: range.c1, rows, cols } };
}
function paste(wb, copied, r, c, target = null, options = {}) {
  return wb.pasteCells(wb.activeSheetId, copied.cells, r, c, copied.origin, target, { conditionalFormats: copied.conditionalFormats, ...options });
}
function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (const c of [0, 2]) for (let r = 1; r <= 8; r++) wb.setInput(id, r, c, String(r));
  wb.addRule(id, { type: 'formula', range: g(1, 0, 8, 0), value: 'A2>3', style: { bg: '#ffaaaa' }, stopIfTrue: false });
  wb.addRule(id, { type: 'formula', range: g(1, 2, 8, 2), value: 'C2<5', style: { bg: '#aaaaff' }, stopIfTrue: false });
  return wb;
}
it('handles a partial-range paste: new priority, shifted predicate, and outside destination pieces', () => {
  const wb = setup(), before = wb.toJSON();
  paste(wb, copy(wb, g(3, 0, 5, 0)), 3, 2);
  expect(wb.activeSheet.rules[0]).toMatchObject({ value: 'C4>3', range: g(3, 2, 5, 2) });
  expect(look(wb, 3, 2)).toBeNull(); expect(look(wb, 4, 2)).toEqual({ bg: '#ffaaaa' });
  expect(look(wb, 2, 2)).toEqual({ bg: '#aaaaff' }); expect(look(wb, 6, 2)).toBeNull();
  expect(wb.activeSheet.rules.find(r => r.range.r1 === 6)?.value).toBe('C7<5');
  wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(look(wb, 4, 2)).toEqual({ bg: '#ffaaaa' });
  wb.setInput(wb.activeSheetId, 3, 2, '8'); expect(look(wb, 3, 2)).toEqual({ bg: '#ffaaaa' });
});
it('copies rule settings as an independent snapshot with mixed and absolute references', () => {
  const wb = setup(), id = wb.activeSheetId;
  wb.updateRule(id, wb.activeSheet.rules[0].id, { value: 'AND(A2>$F$1,$A2>G$2)', style: { bt: true, btBorder: { bs: 'double', bc: '#123456' } } });
  const copied = copy(wb, g(3, 0, 5, 0));
  wb.updateRule(id, wb.activeSheet.rules[0].id, { value: 'FALSE' });
  paste(wb, copied, 9, 3);
  expect(wb.activeSheet.rules[0].value).toBe('AND(D10>$F$1,$A10>J$2)');
  wb.activeSheet.rules[0].style.btBorder.bc = '#ffffff';
  expect(copied.conditionalFormats[0].rule.style.btBorder.bc).toBe('#123456');
});
it('keeps copied priority and stop behavior while tiling and transposing', () => {
  const wb = setup(), id = wb.activeSheetId;
  wb.addRule(id, { type: 'formula', range: g(1, 0, 8, 0), value: 'TRUE', style: { bold: true } });
  const copied = copy(wb, g(3, 0, 5, 0));
  paste(wb, copied, 10, 3, g(10, 3, 15, 4));
  expect(look(wb, 11, 4)).toEqual({ bg: '#ffaaaa', bold: true });
  expect(look(wb, 13, 4)).toEqual({ bold: true });
  paste(wb, copied, 18, 3, null, { transpose: true });
  expect(look(wb, 18, 3)).toEqual({ bold: true }); expect(look(wb, 18, 4)).toEqual({ bg: '#ffaaaa', bold: true });
});
it('compacts hidden source rows and columns while keeping rules live', () => {
  const wb = setup(), copied = copy(wb, g(1, 0, 8, 2), [1, 4, 8], [0, 2]);
  paste(wb, copied, 10, 5);
  expect(look(wb, 11, 5)).toEqual({ bg: '#ffaaaa' }); expect(look(wb, 10, 6)).toEqual({ bg: '#aaaaff' });
  wb.setInput(wb.activeSheetId, 10, 5, '9'); expect(look(wb, 10, 5)).toEqual({ bg: '#ffaaaa' });
});
it('clears destination rules with an empty-rule snapshot, while formulas-only and old callers keep them', () => {
  const wb = setup(), blank = copy(wb, g(0, 5));
  paste(wb, blank, 2, 2, null, { keepStyles: true }); expect(wb.activeSheet.rules).toHaveLength(2);
  paste(wb, blank, 2, 2); expect(look(wb, 2, 2)).toBeNull();
  wb.pasteCells(wb.activeSheetId, [[{ v: 1 }]], 1, 2); expect(look(wb, 1, 2)).toEqual({ bg: '#aaaaff' });
});
it('formats-only transfers live rules while leaving cell values intact', () => {
  const wb = setup(), copied = copy(wb, g(3, 0, 5, 0));
  wb.setInput(wb.activeSheetId, 4, 2, '99');
  wb.pasteStyles(wb.activeSheetId, copied.cells, 3, 2, null, { merges: [], conditionalFormats: copied.conditionalFormats });
  expect(wb.getValue(wb.activeSheetId, 4, 2)).toBe(99); expect(look(wb, 4, 2)).toEqual({ bg: '#ffaaaa' });
});
it('skip-blanks changes rules only where a cell was accepted', () => {
  const wb = setup(), copied = copy(wb, g(3, 0, 5, 0)); copied.cells[1][0] = null;
  paste(wb, copied, 3, 2, null, { skipBlanks: true });
  expect(look(wb, 4, 2)).toEqual({ bg: '#aaaaff' }); expect(look(wb, 5, 2)).toEqual({ bg: '#ffaaaa' });
});
it('refuses protected pastes atomically, including formats and undo history', () => {
  const wb = setup(), copied = copy(wb, g(3, 0, 5, 0)), id = wb.activeSheetId;
  wb.activeSheet.protectedRanges.push({ id: 'lock', range: g(4, 2) });
  const before = wb.toJSON(), version = wb.version;
  paste(wb, copied, 3, 2); expect(wb.toJSON()).toEqual(before); expect(wb.version).toBe(version);
  expect(paste(wb, copied, 3, 2, null, { checkOnly: true })).toBe(false);
});
it.each(['scale', 'icons', 'databar', 'top', 'dup'])('keeps one statistical domain when an existing %s rule is split', type => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [1, 2, 100, 2, 5].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.addRule(id, { type, range: g(0, 0, 4, 0), from: '#000000', to: '#ffffff', value: 1, style: { bold: true } });
  const blank = copy(wb, g(0, 4)); paste(wb, blank, 2, 0);
  const rules = wb.activeSheet.rules;
  expect(rules).toHaveLength(2); expect(rules[0].statisticsRange).toBe(rules[1].statisticsRange);
  if (type === 'scale') { expect(look(wb, 0)).toEqual({ bg: '#000000' }); expect(look(wb, 4)).toEqual({ bg: '#ffffff' }); }
  if (type === 'top') { expect(look(wb, 0)).toBeNull(); expect(look(wb, 4)).toEqual({ bold: true }); }
  if (type === 'dup') { expect(look(wb, 1)).toEqual({ bold: true }); expect(look(wb, 3)).toEqual({ bold: true }); }
  // A second paste updates the other surviving fragment's shared domain too.
  paste(wb, blank, 4, 0); expect(wb.activeSheet.rules[0].statisticsRange).not.toContain('$A$5');
});
it('preserves alternating-row phase and its original header when splitting band rules', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addRule(id, { type: 'bands', range: g(0, 0, 6, 0), headerColor: '#111111', color1: '#222222', color2: '#333333' });
  const before = look(wb, 4); paste(wb, copy(wb, g(0, 4)), 3, 0);
  expect(look(wb, 4)).toEqual(before); expect(look(wb, 0)).toMatchObject({ bg: '#111111', bold: true });
});
it('retains live rules in HTML between app tabs, but ignores stale or malformed payloads', () => {
  const wb = setup(), copied = copy(wb, g(3, 0, 5, 0));
  const html = cellsToHtml([['3'], ['4'], ['5']], copied.cells, null, null, copied.origin, { conditionalFormats: copied.conditionalFormats });
  const parsed = parseHtmlClipboard(html, '3\n4\n5'); expect(parsed.conditionalFormats).toEqual(copied.conditionalFormats);
  const other = new Workbook(); paste(other, { ...parsed, origin: parsed.origin }, 2, 4); expect(look(other, 3, 4)).toEqual({ bg: '#ffaaaa' });
  expect(parseHtmlClipboard(html.replace('>3<', '>30<'), '30\n4\n5').conditionalFormats).toBeUndefined();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelector('table').setAttribute('data-spreadsheet-rules', JSON.stringify([{ ...copied.conditionalFormats[0], range: g(-1, 0) }]));
  expect(parseHtmlClipboard(doc.body.innerHTML, '3\n4\n5').conditionalFormats).toBeUndefined();
});
it('keeps pasted expressions and split statistical domains in native XLSX without sidecar metadata', async () => {
  const wb = setup(); paste(wb, copy(wb, g(3, 0, 5, 0)), 3, 2);
  wb.addRule(wb.activeSheetId, { type: 'scale', range: g(1, 4, 8, 4), from: '#000000', to: '#ffffff' });
  for (let r = 1; r <= 8; r++) wb.setInput(wb.activeSheetId, r, 4, String(r));
  paste(wb, copy(wb, g(0, 8)), 4, 4);
  const blob = await workbookToXlsx(wb);
  const data = new Uint8Array(await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob); }));
  // Remove the metadata JSON from its ZIP part while preserving native styles and CF.
  const zip = X.CFB.read(data, { type: 'array' }); const part = X.CFB.find(zip, '/xl/worksheets/sheet2.xml');
  part.content = new TextEncoder().encode('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>'); part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(look(back, 4, 2)).toEqual({ bg: '#ffaaaa' }); expect(look(back, 3, 2)).toBeNull();
  expect(look(back, 1, 4)).toEqual({ bg: '#000000' }); expect(look(back, 8, 4)).toEqual({ bg: '#ffffff' });
});
it('shares split statistics after repeated copies, edits, line insertion and undo', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [1, 2, 100, 2, 5].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.addRule(id, { type: 'top', range: g(0, 0, 4, 0), value: 1, style: { bold: true } });
  paste(wb, copy(wb, g(0, 4)), 2, 0);
  paste(wb, copy(wb, g(0, 0, 4, 0)), 10, 2);
  expect(look(wb, 11, 2)).toBeNull(); expect(look(wb, 14, 2)).toEqual({ bold: true });
  wb.setInput(id, 11, 2, '99'); expect(look(wb, 14, 2)).toBeNull(); expect(look(wb, 11, 2)).toEqual({ bold: true });
  wb.insertRows(id, 11, 2); expect(look(wb, 13, 2)).toEqual({ bold: true }); expect(look(wb, 16, 2)).toBeNull();
  wb.undo(); expect(look(wb, 11, 2)).toEqual({ bold: true });
});
it('excludes merged destination body cells and refuses a partial fixed-array overwrite', () => {
  const wb = setup(), copied = copy(wb, g(3, 0, 5, 0)), id = wb.activeSheetId;
  wb.mergeCells(id, g(3, 2, 4, 2)); paste(wb, copied, 3, 2);
  expect(wb.activeSheet.rules.filter(r => r.value === 'C4>3' || r.value === 'C6>3')).toHaveLength(2);
  wb.setCells(id, [{ r: 10, c: 4, cell: { f: '{1;2;3}', array: { rows: 3, cols: 1 } } }]);
  const before = wb.toJSON(); paste(wb, copy(wb, g(3, 0)), 11, 4); expect(wb.toJSON()).toEqual(before);
});
it('clips rule coverage at the grid edge and copies to another sheet without retaining source IDs', () => {
  const wb = setup(), copied = copy(wb, g(3, 0, 5, 0));
  wb.addSheet('Other'); const id = wb.activeSheetId;
  paste(wb, copied, 1048575, 16383);
  expect(wb.activeSheet.rules[0]).toMatchObject({ range: g(1048575, 16383), value: 'XFD1048576>3' });
  expect(wb.activeSheet.rules[0].id).not.toBe(copied.conditionalFormats[0].rule.id);
});
it('sanitizes rule styles and colors from HTML and keeps threshold formulas live', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addRule(id, { type: 'scale', range: g(0, 0, 2, 0), scaleMin: 'B1', scaleMax: '$B$2', from: '#000000', to: '#ffffff' });
  const copied = copy(wb, g(1, 0, 2, 0)); paste(wb, copied, 4, 3);
  expect(wb.activeSheet.rules[0]).toMatchObject({ scaleMin: 'E4', scaleMax: '$B$2' });
  const items = [{ ...copied.conditionalFormats[0], rule: { ...copied.conditionalFormats[0].rule, type: 'bands', color1: 'url(https://invalid.example/image)', style: { bg: 'url(https://invalid.example/image)' } } }];
  const html = cellsToHtml([[''], ['']], copied.cells, null, null, copied.origin, { conditionalFormats: items });
  const rules = parseHtmlClipboard(html).conditionalFormats; expect(rules[0].rule.color1).toBeUndefined(); expect(rules[0].rule.style.bg).toBeUndefined();
});
it.each([false, true])('uses one tiled duplicate domain (native=%s)', native => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 0, '1'); wb.setInput(id, 2, 0, '2');
  wb.addRule(id, { type: 'dup', range: g(1, 0, 2, 0), ...(native ? { duplicateRange: '$A$2:$A$3' } : {}), style: { bg: '#ffaaaa' } });
  paste(wb, copy(wb, g(1, 0, 2, 0)), 1, 2, g(1, 2, 4, 2));
  for (let r = 1; r <= 4; r++) expect(look(wb, r, 2)).toEqual({ bg: '#ffaaaa' });
  expect(look(wb, 1)).toBeNull();
  wb.setInput(id, 1, 2, '9'); expect(look(wb, 3, 2)).toBeNull();
});
it('copies a partial native duplicate domain independently and updates its surviving source pieces after overwrite', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  [1, 2, 1].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.addRule(id, { type: 'dup', range: g(0, 0, 2, 0), duplicateRange: '$A$1:$A$3', style: { bold: true } });
  paste(wb, copy(wb, g(0, 0)), 0, 2); expect(look(wb, 0, 2)).toBeNull();
  paste(wb, copy(wb, g(0, 5)), 0, 0); expect(look(wb, 2, 0)).toBeNull();
});

it('retains qualified statistical sources when a local paste removes only local cells', () => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Other inputs');
  [1, 10, 5].forEach((v, r) => wb.setInput(id, r, 0, String(v)));
  wb.setInput(other.id, 0, 0, '100');
  wb.addRule(id, { type: 'top', range: g(0, 0, 2, 0), value: 1,
    statisticsRange: "(Sheet1!$A$1:$A$3,'Other inputs'!$A$1:$A$1)", style: { bold: true } });
  wb.pasteCells(id, [[{ v: null }]], 0, 0, null, null, { conditionalFormats: [] });
  const rule = wb.sheet(id).rules[0];
  expect(rule.statisticsRange).toBe("($A$2:$A$3,'Other inputs'!$A$1:$A$1)");
  expect(wb.conditionalStyle(id, 1, 0, 10)).toBeNull();
  expect(conditionalRuleFormula(rule)).toContain("'Other inputs'!$A$1:$A$1");
  expect(scaleThresholdFormula('max', null, duplicateSourceAreas(rule.statisticsRange))).toContain("'Other inputs'!$A$1:$A$1");
  wb.setInput(other.id, 0, 0, '2');
  expect(wb.conditionalStyle(id, 1, 0, 10)).toEqual({ bold: true });
});

it('keeps large repeated rules compact without merging tile-relative thresholds or recovering invalid references', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '5');
  wb.addRule(id, { type: 'formula', range: g(0, 0), value: 'A1>2', style: { bold: true } });
  paste(wb, copy(wb, g(0, 0)), 1, 1, g(1, 1, 100, 100));
  expect(wb.activeSheet.rules).toHaveLength(2);
  expect(wb.activeSheet.rules[0]).toMatchObject({ range: g(1, 1, 100, 100), value: 'B2>2' });
  expect(look(wb, 100, 100)).toEqual({ bold: true });
  wb.addRule(id, { type: 'formula', range: g(0, 3), value: 'B1>0', style: { italic: true } });
  paste(wb, copy(wb, g(0, 3)), 200, 0, g(200, 0, 200, 3));
  expect(wb.activeSheet.rules.slice(0, 4).map(rule => rule.value)).toEqual(['#REF!>0', '#REF!>0', 'A201>0', 'B201>0']);
  wb.addRule(id, { type: 'scale', range: g(0, 5), scaleMin: 'A1', from: '#ffffff', to: '#000000' });
  paste(wb, copy(wb, g(0, 5)), 300, 5, g(300, 5, 300, 6));
  expect(wb.activeSheet.rules[0].scaleMin).toBe('A301');
  expect(wb.activeSheet.rules[1].scaleMin).toBe('B301');
  wb.addRule(id, { type: 'formula', range: g(3, 3), value: 'C3>0', style: { italic: true } });
  paste(wb, copy(wb, g(3, 3)), 0, 0, g(0, 0, 2, 2));
  expect(wb.activeSheet.rules.slice(0, 9)).toHaveLength(9);
  expect(wb.activeSheet.rules.find(rule => rule.range.r1 === 1 && rule.range.c1 === 1).value).toBe('A1>0');
});
