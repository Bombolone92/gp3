import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { createNamesFromSelection, guessLabelEdges, nameForLabel, namesFromSelection } from '../src/core/names-from-selection.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Item', 'Unit price', 'Qty 2024'], ['Notebook', '4.5', '3'], ['Pencil', '1.25', '6']]
    .forEach((row, r) => row.forEach((value, c) => wb.setInput(id, r, c, value)));
  return { wb, id };
}

it('spells labels as valid names', () => {
  expect(nameForLabel('Unit price')).toBe('Unit_price');
  expect(nameForLabel('2024 sales')).toBe('_2024_sales');
  expect(nameForLabel('Q1')).toBe('_Q1');
  expect(nameForLabel('Cost (USD)')).toBe('Cost__USD_');
  expect(nameForLabel('   ')).toBe('');
});

it('guesses a top-row and left-column layout from text labels', () => {
  const { wb, id } = book();
  expect(guessLabelEdges(wb, id, parseRange('A1:C3'))).toMatchObject({ top: true, left: true });
  expect(guessLabelEdges(wb, id, parseRange('B1:C3'))).toMatchObject({ top: true, left: false });
});

it('names columns after the top row and rows after the left column, excluding the labels', () => {
  const { wb, id } = book();
  const names = namesFromSelection(wb, id, parseRange('A1:C3'), { top: true, left: true });
  expect(names.map(n => [n.name, n.ref])).toEqual([
    ['Unit_price', 'Sheet1!$B$2:$B$3'], ['Qty_2024', 'Sheet1!$C$2:$C$3'],
    ['Notebook', 'Sheet1!$B$2:$C$2'], ['Pencil', 'Sheet1!$B$3:$C$3'],
  ]);
});

it('defines the names as one undo step and the names calculate', () => {
  const { wb, id } = book();
  const result = createNamesFromSelection(wb, id, parseRange('B1:C3'), { top: true });
  expect(result).toEqual({ created: 2, replaced: 0, skipped: [] });
  wb.setInput(id, 5, 0, '=SUM(Unit_price)');
  expect(wb.getValue(id, 5, 0)).toBe(5.75);
  wb.undo(); // the formula
  wb.undo(); // both names together
  expect(wb.names.map(n => n.name)).toEqual([]);
});

it('reports labels that cannot become names and keeps the others', () => {
  const { wb, id } = book();
  wb.addTable(id, parseRange('E1:F3'), { name: 'Notebook' });
  const result = createNamesFromSelection(wb, id, parseRange('A1:C3'), { left: true });
  expect(result.created).toBe(2); // Item and Pencil
  expect(result.skipped).toEqual([{ name: 'Notebook', reason: 'That name is already used' }]);
});
