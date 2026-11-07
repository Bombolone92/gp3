import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';

function fixture(rows, ref, predicate) {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet(rows), 'Data');
  const content = X.write(book, { type: 'string', bookType: 'fods' });
  const definition = `<table:database-ranges><table:database-range table:name="Native" table:target-range-address="$Data.${ref}" table:contains-header="true" table:display-filter-buttons="true"><table:filter>${predicate}</table:filter></table:database-range></table:database-ranges>`;
  return workbookFromFile(new TextEncoder().encode(content.replace('</office:spreadsheet>', () => definition + '</office:spreadsheet>')), 'native.fods');
}
const condition = (field, operator, value, extra = '') => `<table:filter-condition table:field-number="${field}" table:operator="${operator}" table:value="${value}"${extra}/>`;
const rows = [[null, 'Name', 'Amount', 'Flag'], [null, 'a', 3, 'x'], [null, 'b', 9, 'y'], [null, 'c', 12, 'x']];

// A native condition on the second or third column of the range was attached to the range's
// first column, so the filter menu showed it on the wrong column and clearing that column's
// filter, or editing the right one, worked on the wrong criteria.
it('attaches a single native condition to the column it tests', async () => {
  const wb = await fixture(rows, '$B$1:.$D$4', condition(1, '>', 5, ' table:data-type="number"'));
  const { filter, filterHidden } = wb.activeSheet;
  expect(filter.range).toEqual({ r1: 0, c1: 1, r2: 3, c2: 3 });
  expect(Object.keys(filter.criteria)).toEqual(['2']);
  expect(filter.criteria[2].formula).toContain('$C2');
  expect([...filterHidden]).toEqual([1]);
  wb.setFilterCriteria(wb.activeSheetId, 2, null);
  expect([...wb.activeSheet.filterHidden]).toEqual([]);
});

it('does the same for a condition wrapped in a group of its own', async () => {
  const wb = await fixture(rows, '$B$1:.$D$4', `<table:filter-and>${condition(2, '=', 'x')}</table:filter-and>`);
  expect(Object.keys(wb.activeSheet.filter.criteria)).toEqual(['3']);
  expect([...wb.activeSheet.filterHidden]).toEqual([2]);
});

it('keeps a condition spanning several fields on the range\'s first column', async () => {
  const wb = await fixture(rows, '$B$1:.$D$4', `<table:filter-and>${condition(1, '>', 5, ' table:data-type="number"')}${condition(2, '=', 'x')}</table:filter-and>`);
  expect(Object.keys(wb.activeSheet.filter.criteria)).toEqual(['1']);
  expect([...wb.activeSheet.filterHidden]).toEqual([1, 2]);
});
