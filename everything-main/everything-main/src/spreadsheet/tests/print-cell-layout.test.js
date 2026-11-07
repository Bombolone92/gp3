// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { buildPrintTable } from '../src/ui/print.js';
import { parseRules, stylesheet } from './helpers/css.js';

// jsdom does not paginate or measure table rows. Apply the print rules here to
// check the content formatting; row geometry is also checked in Chrome print.
function print(wb, opts = {}) {
  const css = document.createElement('style');
  css.textContent = parseRules(stylesheet('editor.css'))
    .filter(rule => rule.media.includes('@media print') || rule.selectors.some(s => s.startsWith('.print-')))
    .map(rule => `${rule.selectors.join(',')} {${rule.body}}`).join('\n');
  document.head.append(css);
  const table = buildPrintTable(wb, wb.activeSheetId, { fit: 'actual', ...opts });
  document.body.append(table);
  return table;
}
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); });

it('prints inherited sheet alignment without a Normal font or row/column styles', () => {
  const wb = new Workbook({ sheets: [{ defaultVAlign: 'bottom', rowHeights: { 0: 10 }, cells: { '0,0': { v: 'Inherited alignment' } } }] });
  const table = print(wb);
  expect(table.querySelector('td').style.verticalAlign).toBe('bottom');
  expect(getComputedStyle(table.querySelector('.print-cell')).alignContent).toBe('unsafe end');
});

it.each(['thin', 'medium', 'thick', 'double', 'dashed'])('keeps %s collapsed borders on unpositioned cells when clipping their contents', bs => {
  const wb = new Workbook({ sheets: [{ rowHeights: { 0: 17, 1: 9, 2: 31, 3: 1 } }] }), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'A wrapped heading');
  wb.setInput(id, 1, 0, 'A merged label');
  wb.mergeCells(id, parseRange('A2:B3'));
  wb.applyStyle(id, parseRange('A1:B4'), { wrap: true, bg: '#245678' });
  wb.applyBorders(id, parseRange('A1:B4'), 'all', { style: bs, color: '#ffffff' });
  const table = print(wb, { range: parseRange('A1:B4'), headers: true, repeatRows: 1 });
  expect(getComputedStyle(table).borderCollapse).toBe('collapse');
  const merged = table.querySelector('td[rowspan="2"]');
  expect(merged.colSpan).toBe(2);
  for (const cell of table.querySelectorAll('td,th')) {
    // jsdom cannot exercise Chromium's paged border painter. Guard the layout
    // contract that avoids its positioned-table-cell failure instead.
    expect(['', 'static']).toContain(getComputedStyle(cell).position);
    if (cell.tagName === 'TD') {
      // Shared ties belong to the lower cell; its top paints the same line.
      expect(cell.style.borderTopColor).toBe('rgb(255, 255, 255)');
      if (cell.parentElement === table.tBodies[0].lastElementChild) {
        expect(cell.style.borderBottomColor).toBe('rgb(255, 255, 255)');
      }
      expect(cell.style.backgroundColor).toBe('rgb(36, 86, 120)');
    }
    const content = cell.querySelector('.print-cell');
    if (!content) continue;
    expect(getComputedStyle(cell).height).toBe('0px');
    expect(content.parentElement.className).toBe('print-cell-box');
    expect(getComputedStyle(content.parentElement).position).toBe('relative');
    expect(getComputedStyle(content.parentElement).height).toBe('100%');
    expect(getComputedStyle(content).position).toBe('absolute');
  }
  expect([...table.querySelectorAll('tbody tr')].map(tr => tr.style.height)).toEqual(['9px', '31px', '1px']);
  expect(table.querySelector('thead').textContent).toContain('A wrapped heading');
});

it('keeps wrapped and merged content aligned and indented within fixed row boxes', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'A large merged title');
  wb.mergeCells(id, parseRange('A1:B2'));
  wb.applyStyle(id, parseRange('A1'), { size: 60, valign: 'middle', align: 'center' });
  wb.setInput(id, 2, 0, 'A wrapped label with several lines');
  wb.applyStyle(id, parseRange('A3'), { font: 'calibri', wrap: true, indent: 2, valign: 'top', underline: true, strike: true });
  wb.setInput(id, 3, 0, 'Bottom aligned');
  wb.setRowHeight(id, 3, 18);
  wb.applyStyle(id, parseRange('A4'), { align: 'right', indent: 1, valign: 'bottom' });
  const table = print(wb, { range: parseRange('A1:B4') });
  const cells = [...table.querySelectorAll('td')].filter(td => td.textContent);
  expect(cells.map(td => td.textContent)).toEqual([
    'A large merged title', 'A wrapped label with several lines', 'Bottom aligned',
  ]);
  expect(cells[0].rowSpan).toBe(2);
  expect(cells[0].colSpan).toBe(2);
  expect(getComputedStyle(cells[0].querySelector('.print-cell')).alignContent).toBe('unsafe center');
  expect(getComputedStyle(cells[1].querySelector('.print-cell')).alignContent).toBe('start');
  expect(getComputedStyle(cells[1].querySelector('.print-cell')).paddingLeft).toBe('26px');
  expect(getComputedStyle(cells[1].querySelector('.print-cell')).paddingTop).toBe('0px');
  expect(getComputedStyle(cells[1]).whiteSpace).toBe('pre-wrap');
  expect(getComputedStyle(cells[1]).textDecoration).toBe('underline line-through');
  expect(getComputedStyle(cells[1].firstElementChild).textDecoration).toBe('inherit');
  expect(getComputedStyle(cells[1].firstElementChild).textOverflow).toBe('inherit');
  expect(getComputedStyle(cells[1].querySelector('.print-cell')).textDecoration).toBe('inherit');
  expect(getComputedStyle(cells[2].querySelector('.print-cell')).alignContent).toBe('unsafe end');
  expect(getComputedStyle(cells[2].querySelector('.print-cell')).paddingRight).toBe('14px');
  // Padding must not give the table cell a minimum taller than its stored row.
  for (const td of cells) expect(getComputedStyle(td).padding).toBe('0px');
});

it('keeps label overflow above adjacent fills and below floating objects', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Terms & Conditions:');
  wb.applyStyle(id, parseRange('A1:B1'), { bg: '#ffffff' });
  wb.applyStyle(id, parseRange('A1'), { indent: 1 });
  const table = print(wb, { range: parseRange('A1:B1') });
  const label = table.querySelector('td').querySelector('.print-cell');
  expect(label.textContent).toBe('Terms & Conditions:');
  expect(label.style.width).toBe('200%');
  expect(getComputedStyle(label).paddingLeft).toBe('14px');
  expect(getComputedStyle(label).zIndex).toBe('1');
  expect(getComputedStyle(table).isolation).toBe('isolate');
  expect(table.querySelectorAll('td')[1].childElementCount).toBe(0);
});

it('retains column letters and row numbers when repeating the first row', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Heading');
  wb.setInput(id, 1, 0, 'Body');
  const table = print(wb, { headers: true, repeatRows: 1 });
  expect([...table.querySelectorAll('thead tr')].map(tr => tr.textContent)).toEqual(['A', '1Heading']);
  expect(table.querySelector('tbody').textContent).toBe('2Body');
  const header = table.querySelector('th:last-child').querySelector('.print-cell');
  expect(getComputedStyle(header).alignContent).toBe('unsafe center');
  expect(getComputedStyle(header).padding).toBe('2px 3px');
});

it('lets right-aligned invoice labels extend left through blank cells without moving their right edge', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 2, 'SUBTOTAL LESS DISCOUNT');
  wb.setInput(id, 0, 3, '7500');
  wb.setColWidth(id, 0, 40); wb.setColWidth(id, 1, 80); wb.setColWidth(id, 2, 60);
  wb.setRowHeight(id, 0, 20);
  wb.applyStyle(id, parseRange('C1'), { align: 'right', indent: 1, bg: '#eeeeee', bb: true });
  const table = print(wb, { range: parseRange('A1:D1') });
  const cell = table.querySelectorAll('td')[2], label = cell.querySelector('.print-cell');
  expect(cell.classList.contains('spill')).toBe(true);
  expect(label.style.left).toBe('-200%');
  expect(label.style.width).toBe('300%');
  expect(getComputedStyle(label).paddingRight).toBe('14px');
  expect(label.style.backgroundColor).toBe('');
  expect(cell.style.borderBottom).not.toBe('');
  expect(table.querySelectorAll('td')[3].classList.contains('spill')).toBe(false);
});

it('centres overflowing labels on their original cells and clips only the obstructed side', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 1, 'A centred heading extending into its neighbours');
  wb.setInput(id, 0, 0, 'Occupied');
  wb.applyStyle(id, parseRange('B1'), { align: 'center' });
  const table = print(wb, { range: parseRange('A1:C1') });
  const label = table.querySelectorAll('td')[1].querySelector('.print-cell');
  expect(label.style.width).toBe('300%');
  expect(label.style.left).toBe('-100%');
  expect(label.style.clipPath).toBe('inset(0 0% 0 33.33333333333333%)');
});

it('stops text overflow at formulas, merges, checkboxes and the print boundary, skipping hidden columns', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (let r = 0; r < 4; r++) {
    wb.setInput(id, r, 3, 'A right-aligned label');
    wb.applyStyle(id, { r1:r, r2:r, c1:3, c2:3 }, { align: 'right' });
  }
  wb.setInput(id, 0, 1, '=IF(TRUE,"",1)');
  wb.mergeCells(id, parseRange('A2:B2'));
  wb.addValidation(id, { range: parseRange('B3'), type: 'checkbox' });
  wb.setHidden(id, 'col', [2], true);
  const table = print(wb, { range: parseRange('B1:D4') });
  const labels = [...table.querySelectorAll('td')].filter(td => td.textContent === 'A right-aligned label');
  expect(labels.slice(0, 3).every(td => !td.classList.contains('spill'))).toBe(true);
  expect(labels[3].querySelector('.print-cell').style.left).toBe('-100%');
  expect(labels[3].querySelector('.print-cell').style.width).toBe('200%');
});

it('leaves ordinary data cells lightweight and removes minimum padding from very short rows', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Item');
  wb.setInput(id, 0, 1, '125');
  // A row with room for a line of text (the 19.5px default has less than printed text needs).
  wb.setRowHeight(id, 0, 26);
  wb.setRowHeight(id, 1, 1);
  const table = print(wb, { range: parseRange('A1:B2') });
  const rows = table.querySelectorAll('tr');
  for (const td of rows[0].children) {
    expect(td.childElementCount).toBe(0);
    expect(td.textContent).not.toBe('');
  }
  for (const td of rows[1].children) {
    expect(td.childElementCount).toBe(0);
    expect(getComputedStyle(td).padding).toBe('0px');
  }
});

it.each(['left', 'right'])('keeps equal indentation increments for %s-aligned cells', align => {
  const wb = new Workbook(), id = wb.activeSheetId;
  for (let r = 0; r < 4; r++) {
    wb.setInput(id, r, 0, 'X');
    wb.applyStyle(id, { r1: r, r2: r, c1: 0, c2: 0 }, { align, indent: r, wrap: true });
  }
  const table = print(wb);
  const prop = align === 'right' ? 'paddingRight' : 'paddingLeft';
  const offsets = [...table.querySelectorAll('.print-cell')].map(n => parseFloat(getComputedStyle(n)[prop]));
  expect(offsets).toHaveLength(4);
  expect(offsets[1] - offsets[0]).toBe(offsets[2] - offsets[1]);
  expect(offsets[2] - offsets[1]).toBe(offsets[3] - offsets[2]);
});

it.each(['left', 'right', 'center'])('clips %s-aligned printed labels without adding an ellipsis', align => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const text = 'A long label … with literal punctuation and a final word';
  for (const r of [0, 1]) {
    wb.setInput(id, r, 1, text);
    wb.applyStyle(id, { r1: r, r2: r, c1: 1, c2: 1 }, { align });
  }
  wb.setInput(id, 0, 0, 'Left blocker'); wb.setInput(id, 0, 2, 'Right blocker');
  const table = print(wb, { range: parseRange('A1:C2') });
  const labels = [...table.querySelectorAll('td')].filter(td => td.textContent === text);
  expect(labels).toHaveLength(2);
  expect(labels[0].classList.contains('spill')).toBe(false);
  expect(labels[1].classList.contains('spill')).toBe(true);
  for (const td of labels) {
    expect(getComputedStyle(td).textOverflow).toBe('clip');
    const content = td.querySelector('.print-cell') || td;
    expect(content.textContent).toBe(text);
    expect(['clip', 'inherit']).toContain(getComputedStyle(content).textOverflow);
    expect(getComputedStyle(content).overflow).toBe('hidden');
  }
});
