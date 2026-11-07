import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { CHIP_PALETTE, chipFor } from '../src/core/validation.js';

function book(colors = undefined) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const lists = wb.addSheet('Lists').id;
  for (const [r, text] of [[0, '2024-01-15'], [1, '2024-02-20'], [2, '12.5%'], [3, 'Red']]) wb.setInput(lists, r, 0, text);
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 5, c2: 0 }, type: 'list', source: 'Lists!$A$1:$A$4', chips: true, ...(colors ? { colors } : {}) });
  return { wb, id, rule: wb.validationAt(id, 0, 0) };
}

// A chip on a cell found its option by the cell's text while the list indexed options by their plain
// value, so a date, percentage or amount picked from a range was drawn in the first palette colour whatever
// its place in the list, and not the colour the picker showed beside it.
it('colours a cell as the picker colours its option, whatever the cell\'s own format', () => {
  const { wb, id, rule } = book();
  wb.setInput(id, 0, 0, '2024-02-20');
  wb.setCells(id, [{ r: 1, c: 0, cell: { v: 45342, f: null } }]);
  wb.setInput(id, 2, 0, '12.5%');
  wb.setInput(id, 3, 0, 'red');
  wb.setInput(id, 4, 0, '2024-01-15');
  expect(wb.getDisplay(id, 1, 0)).toBe('45342');
  expect([0, 1, 2, 3, 4].map((r) => wb.chipAt(id, r, 0).bg)).toEqual([1, 1, 2, 3, 0].map((i) => CHIP_PALETTE[i][0]));
  // The picker's swatch for each option, computed from the labels it shows, is the same colour.
  const labels = wb.listOptionsFor(id, rule, { typed: true, labels: true }).map((entry) => entry.text);
  expect(labels).toEqual(['2024-01-15', '2024-02-20', '12.50%', 'Red']);
  expect(chipFor(rule, labels[1], labels).bg).toBe(wb.chipAt(id, 1, 0).bg);
  expect(chipFor(rule, labels[2], labels).bg).toBe(wb.chipAt(id, 2, 0).bg);
  // A value outside the list, and a literal list, colour as before.
  wb.setInput(id, 5, 0, 'Blue');
  expect(wb.chipAt(id, 5, 0).bg).toBe(CHIP_PALETTE[0][0]);
  wb.addValidation(id, { range: { r1: 0, c1: 2, r2: 0, c2: 2 }, type: 'list', source: 'Low, High', chips: true });
  wb.setInput(id, 0, 2, 'High');
  expect(wb.chipAt(id, 0, 2).bg).toBe(CHIP_PALETTE[1][0]);
});

it('takes a colour chosen for the option under its label, or under its plain value', () => {
  const byLabel = book({ '2024-02-20': '#112233' });
  byLabel.wb.setInput(byLabel.id, 0, 0, '2024-02-20');
  byLabel.wb.setCells(byLabel.id, [{ r: 1, c: 0, cell: { v: 45342, f: null } }]);
  expect(byLabel.wb.chipAt(byLabel.id, 0, 0).bg).toBe('#112233');
  expect(byLabel.wb.chipAt(byLabel.id, 1, 0).bg).toBe('#112233');
  const bySerial = book({ 45342: '#445566' });
  bySerial.wb.setInput(bySerial.id, 0, 0, '2024-02-20');
  bySerial.wb.setCells(bySerial.id, [{ r: 1, c: 0, cell: { v: 45342, f: null } }]);
  expect(bySerial.wb.chipAt(bySerial.id, 0, 0).bg).toBe('#445566');
  expect(bySerial.wb.chipAt(bySerial.id, 1, 0).bg).toBe('#445566');
});
