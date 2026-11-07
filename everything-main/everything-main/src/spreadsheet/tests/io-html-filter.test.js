import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { sheetToHtml } from '../src/core/io.js';

it('exports the visible filtered rows to HTML and includes them again when the filter is removed', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['Status', 'Excluded', 'Included'].forEach((text, r) => wb.setInput(id, r, 0, text));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 });
  wb.setFilterCriteria(id, 0, { values: ['Included'] });
  const html = sheetToHtml(wb, id);
  expect(html).toContain('Status');
  expect(html).toContain('Included');
  expect(html).not.toContain('Excluded');
  expect(wb.getValue(id, 1, 0)).toBe('Excluded');
  wb.clearFilter(id);
  expect(sheetToHtml(wb, id)).toContain('Excluded');
});
