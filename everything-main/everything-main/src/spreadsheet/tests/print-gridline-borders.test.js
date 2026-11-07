// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { buildPrintTable } from '../src/ui/print.js';
import { parseRules, stylesheet } from './helpers/css.js';

function print(wb, gridlines) {
  const style = document.createElement('style');
  style.textContent = parseRules(stylesheet('editor.css'))
    .filter(rule => rule.selectors.some(s => s.startsWith('.print-')))
    .map(rule => `${rule.selectors.join(',')} {${rule.body}}`).join('\n');
  document.head.append(style);
  const table = buildPrintTable(wb, wb.activeSheetId, { range: parseRange('A1:D4'), gridlines });
  document.body.append(table);
  return table;
}
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });

it.each([
  { gridlines: false, fill: null },
  { gridlines: false, fill: '#fcdea0' },
  { gridlines: true, fill: '#ffffff' },
  { gridlines: true, fill: '#387654' },
])('omits hidden gridline edges beside explicit top/left rules (%j)', ({ gridlines, fill }) => {
  const wb = new Workbook({ sheets: [{ cells: { '1,1': { v: 'Wrapped heading', s: {
    wrap: true, bt: true, bl: true,
    btBorder: { bs: 'thin', bc: '#b52143' }, blBorder: { bs: 'dashed', bc: '#4268bd' },
  } } } }] }), id = wb.activeSheetId;
  if (fill) wb.applyStyle(id, parseRange('A1:D4'), { bg: fill });
  const table = print(wb, gridlines), cell = (r,c) => table.rows[r].cells[c];
  // A transparent or fill-colored solid border still wins over these real
  // borders in CSS's collapsed-border conflict resolution. There must be no
  // implicit edge, not merely an invisible one, on the neighboring cells.
  for (const [td, side] of [[cell(0,1), 'Bottom'], [cell(1,0), 'Right']]) {
    expect(['', 'none']).toContain(getComputedStyle(td)[`border${side}Style`]);
  }
  expect(getComputedStyle(cell(1,1)).borderTop).toBe('1px solid rgb(181, 33, 67)');
  expect(getComputedStyle(cell(1,1)).borderLeft).toBe('1px dashed rgb(66, 104, 189)');
});

it('retains table and conditional rules beside filled merged cells', () => {
  const wb = new Workbook({ sheets: [{ tables: [{ name: 'Items', range: parseRange('A2:B4'), style: 'custom', customStyle: {
    wholeTable: { bg: '#eeddaa' }, headerRow: { bt: true, btBorder: { bs: 'thin', bc: '#226644' } },
  } }] }] }), id = wb.activeSheetId;
  wb.applyStyle(id, parseRange('A1:D4'), { bg: '#eeddaa' });
  wb.mergeCells(id, parseRange('A1:B1'));
  wb.setInput(id, 1, 0, 'Item'); wb.setInput(id, 1, 1, 'Amount');
  wb.addRule(id, { range: parseRange('C3:D3'), type: 'empty', style: { bt: true, btBorder: { bs: 'dotted', bc: '#772299' } } });
  const table = print(wb, false);
  expect(table.rows[0].cells[0].colSpan).toBe(2);
  expect(['', 'none']).toContain(getComputedStyle(table.rows[0].cells[0]).borderBottomStyle);
  for (const td of [...table.rows[1].cells].slice(0,2)) expect(getComputedStyle(td).borderTop).toBe('1px solid rgb(34, 102, 68)');
  for (const td of [...table.rows[2].cells].slice(2)) expect(getComputedStyle(td).borderTop).toBe('1px dotted rgb(119, 34, 153)');
});

it('keeps requested gridlines on unfilled cells', () => {
  const wb = new Workbook();
  const table = print(wb, true);
  expect(getComputedStyle(table.rows[0].cells[0]).borderBottom).toBe('1px solid rgb(204, 204, 204)');
});
