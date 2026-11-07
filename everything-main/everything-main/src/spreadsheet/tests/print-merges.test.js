// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';

function mergedBook() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Report title');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bold: true, align: 'center' });
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 2, c2: 2 });
  return { wb, id };
}

it('prints merged cell spans and expands the used print area to contain them', () => {
  const { wb, id } = mergedBook();
  const table = buildPrintTable(wb, id);
  expect(table.querySelectorAll('col')).toHaveLength(3);
  expect(table.querySelectorAll('tr')).toHaveLength(3);
  expect(table.querySelectorAll('td')).toHaveLength(1);
  const title = table.querySelector('td');
  expect(title.colSpan).toBe(3);
  expect(title.rowSpan).toBe(3);
  expect(title.textContent).toBe('Report title');
  expect(title.style.fontWeight).toBe('600');
  expect(title.style.textAlign).toBe('center');
});

it('counts only visible rows and columns in merged print spans', () => {
  const { wb, id } = mergedBook();
  wb.setHidden(id, 'row', [1], true);
  wb.setHidden(id, 'col', [1], true);
  const table = buildPrintTable(wb, id, { headers: true });
  expect(table.querySelectorAll('td')).toHaveLength(1);
  expect(table.querySelector('td').rowSpan).toBe(2);
  expect(table.querySelector('td').colSpan).toBe(2);
  expect([...table.querySelectorAll('tbody th')].map((cell) => cell.textContent)).toEqual(['1', '3']);
});

it('clips merges to an explicit print selection without including hidden anchor content', () => {
  const { wb, id } = mergedBook();
  const table = buildPrintTable(wb, id, { range: { r1: 1, c1: 1, r2: 2, c2: 2 } });
  expect(table.querySelectorAll('td')).toHaveLength(1);
  expect(table.querySelector('td').rowSpan).toBe(2);
  expect(table.querySelector('td').colSpan).toBe(2);
  expect(table.textContent).not.toContain('Report title');
});

it('splits merge spans at the repeated-header boundary so body columns stay aligned', () => {
  const { wb, id } = mergedBook();
  const table = buildPrintTable(wb, id, { repeatRows: 1 });
  expect(table.querySelector('thead td').rowSpan).toBe(1);
  expect(table.querySelector('thead td').colSpan).toBe(3);
  expect(table.querySelector('tbody td').rowSpan).toBe(2);
  expect(table.querySelector('tbody td').colSpan).toBe(3);
  expect(table.querySelector('tbody').textContent).not.toContain('Report title');
});
