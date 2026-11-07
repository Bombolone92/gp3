// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable, buildPrintRoot } from '../src/ui/print.js';

beforeEach(() => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
  font: '', measureText(text) { return { width: String(text).length * (parseFloat(this.font.match(/[\d.]+px/)?.[0]) || 10) }; },
}));
afterEach(() => vi.restoreAllMocks());
const book = (style = {}, c = 2) => new Workbook({ sheets: [{ cols: 30, colWidths: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i, 50])), cells: { [`0,${c}`]: { v: 'abcdefghij', s: { size: 10, ...style } } } }] });
const columns = w => buildPrintTable(w, w.activeSheetId, { fit: 'actual', headers: true }).querySelector('thead').textContent;

it.each([['left', 'CDE'], ['right', 'ABC'], ['center', 'BCD']])('includes measured overflow in both directions for %s text', (align, expected) => {
  const w = book({ align }), before = w.toJSON();
  expect(columns(w)).toBe(expected); expect(w.toJSON()).toEqual(before);
});

it('uses column widths and font sizes, including text beyond twelve neighboring columns', () => {
  const w = book({ size: 100 }, 0), table = buildPrintTable(w, w.activeSheetId, { fit: 'actual' });
  expect(table.querySelectorAll('col')).toHaveLength(21);
  expect(parseFloat(table.querySelector('.spill .print-cell').style.width)).toBe(2100);
});

it.each([{ wrap: true }, { clip: true }, { rot: 90 }])('keeps constrained text inside its existing range: %j', style => {
  expect(columns(book(style))).toBe('C');
});

it('does not enlarge explicit selections or saved print areas', () => {
  const w = book(), range = { r1: 0, c1: 2, r2: 0, c2: 2 };
  expect(buildPrintTable(w, w.activeSheetId, { range }).querySelectorAll('col')).toHaveLength(1);
  w.activeSheet.printSettings = { areas: [range] };
  const root = buildPrintRoot(w, w.activeSheetId, 'selection', { area: 'printArea' });
  expect(root.querySelectorAll('col')).toHaveLength(1);
});

it('stops at values, empty-result formulas, checkboxes and merged cells', () => {
  for (const kind of ['value', 'formula', 'checkbox', 'merge']) {
    const w = book({}, 0), id = w.activeSheetId;
    if (kind === 'value') w.setInput(id, 0, 1, 'x');
    if (kind === 'formula') w.setInput(id, 0, 1, '=""');
    if (kind === 'checkbox') w.addValidation(id, { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, type: 'checkbox' });
    if (kind === 'merge') w.mergeCells(id, { r1: 0, c1: 1, r2: 1, c2: 1 });
    expect(buildPrintTable(w, id).querySelector('.spill'), kind).toBeNull();
  }
});

it('ignores hidden source cells but crosses hidden neighboring columns', () => {
  const w = book({}, 0); w.activeSheet.hiddenCols.add(1);
  w.setInput(w.activeSheetId, 0, 1, 'Hidden blocker');
  expect(columns(w)).toBe('ACD');
  w.activeSheet.hiddenCols.add(0); expect(columns(w)).toBe('');
});

it('includes string formula results and spill children without storing blank neighbors', () => {
  const w = book({}, 0), id = w.activeSheetId;
  w.setInput(id, 0, 0, '={"a","abcdefghij"}');
  const before = w.toJSON(); expect(columns(w)).toBe('ABCD'); expect(w.toJSON()).toEqual(before);
});

it('measures rich text and formatted text with their actual run sizes', () => {
  const w = book({}, 0), cell = w.activeSheet.cells.get('0,0');
  cell.richText = [{ text: 'abcdefghij', s: { size: 20 } }];
  expect(columns(w)).toBe('ABCDE');
  delete cell.richText; cell.s = { size: 10, fmt: 'custom', code: '"prefix"@' };
  expect(columns(w)).toBe('ABCD');
});

it('keeps sparse full-size sheets bounded by measured ink', () => {
  const w = book({}, 0); w.activeSheet.rows = 1048576; w.activeSheet.cols = 16384;
  const get = vi.spyOn(w, 'getValue');
  expect(columns(w)).toBe('ABC'); expect(get.mock.calls.length).toBeLessThan(20);
});
