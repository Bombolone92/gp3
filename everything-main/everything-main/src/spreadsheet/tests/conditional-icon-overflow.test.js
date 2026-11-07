// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { iconFor, ICON_SETS } from '../src/core/condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { buildPrintTable } from '../src/ui/print.js';

const values = [-1e308, -5e307, 0, 5e307, 1e308], rows = [0, 1, 2, 3, 4];
const expected = ['▼', '▼', '▶', '▲', '▲'];
const range = { r1: 0, c1: 0, r2: 4, c2: 0 };
const icons = (wb, c = 0, rr = rows) => rr.map(r => wb.conditionalStyle(wb.activeSheetId, r, c, wb.getValue(wb.activeSheetId, r, c))?.icon);
function setup(extra = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, values.map((v, r) => ({ r, c: 0, cell: { v } })));
  wb.addRule(id, { type: 'icons', set: 'arrows', range, ...extra });
  return wb;
}
it.each(Object.keys(ICON_SETS))('classifies an overflowing finite span for %s', set => {
  const rule = { set, iconOnly: true }, glyphs = ICON_SETS[set].glyphs, colors = ICON_SETS[set].colors;
  values.forEach((v, r) => {
    const i = [2, 2, 1, 0, 0][r];
    expect(iconFor(rule, v, values[0], values[4])).toEqual({ icon: glyphs[i], iconColor: colors[i], iconOnly: true });
  });
});
it.each([
  [-Number.MAX_VALUE, Number.MAX_VALUE], [-1.5e308, 1e308], [-1e308, 1.5e308],
  [-1e308, 9e307], [-9e307, 1e308], [-Number.MIN_VALUE, Number.MIN_VALUE],
])('preserves endpoints and the mathematical midpoint of %s to %s', (min, max) => {
  const mid = min / 2 + max / 2;
  expect([min, mid, max].map(v => iconFor({}, v, min, max).icon)).toEqual(['▼', '▶', '▲']);
});
it('keeps cutoff equality, zero/100 thresholds and the existing constant-range policy', () => {
  expect(values.map(v => iconFor({ lo: 25, hi: 75 }, v, values[0], values[4]).icon)).toEqual(['▼', '▶', '▶', '▲', '▲']);
  expect(values.map(v => iconFor({ lo: 0, hi: 100 }, v, values[0], values[4]).icon)).toEqual(['▶', '▶', '▶', '▶', '▲']);
  for (const v of [-Number.MAX_VALUE, 0, Number.MAX_VALUE]) expect(iconFor({}, v, v, v).icon).toBe('▲');
  for (const v of [null, '', '1', true, NaN, Infinity, -Infinity, { error: '#NUM!' }]) expect(iconFor({}, v, -1, 1)).toBeNull();
});
it('retains finite-span results and is invariant under scaling to an overflowing span', () => {
  for (const [min, max] of [[0, 100], [-80, 80], [-0.1, 0.9], [1e307, 1e308], [-1e308, -1e307]]) {
    for (let step = 0; step <= 100; step++) {
      const v = min + (max - min) * (step / 100), pct = (v - min) / (max - min) * 100;
      expect(iconFor({}, v, min, max).icon).toBe(pct >= 67 ? '▲' : pct >= 33 ? '▶' : '▼');
    }
  }
  for (const n of [-8, -6, -4, -2, 0, 2, 4, 6, 8]) expect(iconFor({}, n * 2e307, -1.6e308, 1.6e308)).toEqual(iconFor({}, n, -8, 8));
});
it('forms tiny percentages before a subnormal intermediate division loses precision', () => {
  const rule = { lo: 5e-307, hi: 1e-306 };
  expect([0, 0.25, 0.5, 1, 2].map(v => iconFor(rule, v, 0, 1e308).icon))
    .toEqual(['▼', '▼', '▶', '▲', '▲']);
  expect(iconFor(rule, 0, -1, 1e308).icon).toBe('▲');
});
it('invalidates statistics through edits and undo, including spill results and explicit domains', () => {
  const wb = setup(), id = wb.activeSheetId;
  expect(icons(wb)).toEqual(expected);
  wb.setInput(id, 4, 0, '0'); expect(icons(wb)).toEqual(['▼', '▶', '▶', '▲', '▶']);
  wb.undo(); expect(icons(wb)).toEqual(expected);
  wb.setInput(id, 0, 2, '=A1:A5');
  wb.addRule(id, { type: 'icons', range: { ...range, c1: 2, c2: 2 }, statisticsRange: '$A$1:$A$5' });
  expect(icons(wb, 2)).toEqual(expected);
  wb.setInput(id, 0, 0, '0'); expect(icons(wb, 2)).toEqual(['▶', '▼', '▶', '▶', '▲']);
  wb.undo(); expect(icons(wb, 2)).toEqual(expected);
});
it('keeps live icons when copying internally and through the app HTML clipboard', () => {
  const wb = setup(), id = wb.activeSheetId;
  const cells = wb.copyCells(id, rows, [0]), conditionalFormats = wb.copyConditionalFormats(id, rows, [0]), origin = { r: 0, c: 0, rows, cols: [0] };
  wb.pasteCells(id, cells, 0, 2, origin, null, { conditionalFormats });
  expect(icons(wb, 2)).toEqual(expected);
  wb.setInput(id, 4, 2, '0'); expect(icons(wb, 2)).toEqual(['▼', '▶', '▶', '▲', '▶']);
  expect(icons(wb)).toEqual(expected);
  const texts = values.map(v => [String(v)]), html = cellsToHtml(texts, cells, null, null, origin, { conditionalFormats });
  const parsed = parseHtmlClipboard(html, texts.map(row => row[0]).join('\n')), other = new Workbook();
  other.pasteCells(other.activeSheetId, parsed.cells, 0, 3, parsed.origin, null, { conditionalFormats: parsed.conditionalFormats });
  expect(icons(other, 3)).toEqual(expected);
});
it('preserves app icons and finite values in metadata XLSX round trips', async () => {
  let wb = setup();
  // Native XLSX uses built-in artwork; unchanged metadata restores app glyphs.
  for (let i = 0; i < 2; i++) {
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
    wb = await workbookFromFile(bytes, 'icons.xlsx');
    expect(icons(wb)).toEqual(expected);
    expect(rows.map(r => wb.getValue(wb.activeSheetId, r, 0))).toEqual(values);
  }
  wb.setInput(wb.activeSheetId, 4, 0, '0'); expect(icons(wb)).toEqual(['▼', '▶', '▶', '▲', '▶']);
});
it.each([false, true])('prints the correct icons (iconOnly=%s)', iconOnly => {
  const wb = setup({ iconOnly }), table = buildPrintTable(wb, wb.activeSheetId);
  const cells = [...table.querySelectorAll('tbody tr')].map(row => row.querySelector('td'));
  expect(cells.map(cell => cell.textContent.trim().slice(0, 1))).toEqual(expected);
  if (iconOnly) expect(cells.map(cell => cell.textContent.trim())).toEqual(expected);
});
