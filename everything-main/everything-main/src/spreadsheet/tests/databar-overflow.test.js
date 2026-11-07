// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { dataBar } from '../src/core/condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { paintDataBar } from '../src/ui/data-bar.js';
import { buildPrintTable } from '../src/ui/print.js';
import { cellsToHtml, parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';

// App bars intentionally use a continuous minimum-to-maximum scale, including
// for negative values, and keep their historical full bar for a zero span.
// Native legacy/extended rules have separate signed and constant-range rules.
it.each([
  [-1e308, 1e308, -1e308, 0],
  [-1e308, 1e308, -5e307, .25],
  [-1e308, 1e308, 0, .5],
  [-1e308, 1e308, 5e307, .75],
  [-1e308, 1e308, 1e308, 1],
  [-1.5e308, 1e308, 0, .6],
  [-1e308, 1.5e308, 0, .4],
  [-Number.MAX_VALUE, Number.MAX_VALUE, 0, .5],
  [-1e308, 1e308, -Number.MAX_VALUE, 0],
  [-1e308, 1e308, Number.MAX_VALUE, 1],
])('interpolates finite values across overflowing bounds %s/%s at %s', (min, max, value, fraction) => {
  expect(dataBar({}, value, min, max).bar).toBeCloseTo(fraction, 14);
  expect(dataBar({ barMin: min, barMax: max }, value, -1, 1).bar).toBeCloseTo(fraction, 14);
});

it('preserves small, constant, reversed, positive and negative bound behavior', () => {
  for (const magnitude of [1e-307, 1, 1e307]) {
    expect(dataBar({}, magnitude / 2, -magnitude, magnitude).bar).toBeCloseTo(.75, 14);
    expect(dataBar({}, magnitude / 2, magnitude / 4, magnitude).bar).toBe(.5);
    expect(dataBar({}, -magnitude, -magnitude, -magnitude).bar).toBe(1);
    expect(dataBar({ barMin: magnitude, barMax: -magnitude }, 0, 0, 0).bar).toBe(1);
  }
  expect(dataBar({}, 0, 0, 0).bar).toBe(1);
  expect(dataBar({ barMin: 1e308, barMax: 1.5e308 }, -Number.MAX_VALUE, 0, 1).bar).toBe(0);
  expect(dataBar({}, '5', -1e308, 1e308)).toBeNull();
});

const make = () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setCells(id, [-1e308, -5e307, 0, 5e307, 1e308].map((v, r) => ({ r, c: 0, cell: { v } })));
  wb.addRule(id, { type: 'databar', range: { r1: 0, c1: 0, r2: 4, c2: 0 }, style: {}, barColor: '#abcdef' });
  return wb;
};
const bars = wb => Array.from({ length: 5 }, (_, r) => wb.conditionalStyle(wb.activeSheetId, r, 0, wb.getValue(wb.activeSheetId, r, 0)).bar);

it('invalidates cached statistics after edits and undo, and retains geometry through sheet transfer and app saves', async () => {
  const wb = make(), id = wb.activeSheetId;
  expect(bars(wb)).toEqual([0, .25, .5, .75, 1]);
  wb.setInput(id, 4, 0, '5e307');
  expect(bars(wb)[2]).toBeCloseTo(2 / 3, 14);
  wb.undo(); expect(bars(wb)).toEqual([0, .25, .5, .75, 1]);
  const copy = new Workbook();
  copy.placeSheetAt(copy.activeSheetId, wb, id, 0, 0);
  expect(bars(copy)).toEqual(bars(wb));
  // These historical app rules currently use private XLSX metadata. This
  // asserts that contract, not native live-rule interchange with Excel.
  const saved = await workbookToXlsx(wb);
  const bytes = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(saved);
  });
  const reopened = await workbookFromFile(bytes, 'bars.xlsx');
  expect(bars(reopened)).toEqual(bars(wb));
});

it('paints finite grid and print gradients and preserves large clipboard values', () => {
  const wb = make(), id = wb.activeSheetId;
  const table = buildPrintTable(wb, id), printed = table.querySelectorAll('tbody tr');
  for (let r = 0; r < 5; r++) {
    const value = wb.getValue(id, r, 0), look = wb.conditionalStyle(id, r, 0, value);
    const cell = document.createElement('div'); paintDataBar(cell, look);
    expect(cell.style.backgroundImage).not.toMatch(/NaN|Infinity/);
    if (r) expect(cell.style.backgroundImage).toContain(`${(r * 25).toFixed(1)}%`);
    expect(printed[r].querySelector('td').style.backgroundImage).toBe(cell.style.backgroundImage);
    const copied = wb.copyRange(id, { r1: r, c1: 0, r2: r, c2: 0 });
    const html = cellsToHtml([[String(value)]], copied, [[look]], [[value]]);
    for (const markup of [html, html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '')]) {
      const parsed = parseHtmlClipboard(markup);
      const cell = parsed.cells?.[0][0] || cellsFromHtmlRows(parsed.rows)[0].cell;
      expect(cell.v).toBe(value);
    }
  }
});
