import { expect, it } from 'vitest';
import { runQuery } from '../src/core/formula/query.js';
import { Workbook } from '../src/core/workbook.js';

// A header of one to three letters could not be named in a query: `Qty` was still read as the
// column letters QTY and `ID` as the column ID, so the escape hatch for header names, backticks,
// did not reach them. A backtick-quoted identifier is now always a header name.
const DATA = [['ID', 'Qty', 'Name'], [1, 3, 'Pens'], [2, 9, 'Paper'], [3, 7, 'Clips']];

it('reads a backtick-quoted identifier as a header name, never as column letters', () => {
  expect(runQuery(DATA, 'select `ID` where `Qty` > 5').values).toEqual([['ID'], [2], [3]]);
  expect(runQuery(DATA, 'select `Name`, sum(`Qty`) group by `Name` order by `Name`').values)
    .toEqual([['Name', 'sum Qty'], ['Clips', 7], ['Paper', 9], ['Pens', 3]]);
  expect(runQuery(DATA, 'select `Qty` order by `ID` desc limit 1').values).toEqual([['Qty'], [7]]);
});

it('still reads unquoted letters as column letters and longer words as headers', () => {
  expect(runQuery(DATA, 'select A where B > 5').values).toEqual([['ID'], [2], [3]]);
  expect(runQuery(DATA, 'select Name where B > 5').values).toEqual([['Name'], ['Paper'], ['Clips']]);
  expect(runQuery(DATA, 'select Name where Qty > 5').error).toBe('#VALUE!'); // QTY is past the data
  expect(runQuery(DATA, 'select `Nope`').error).toBe('#VALUE!');
});

it('reaches the header from a QUERY formula', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  DATA.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.setInput(id, 0, 5, '=QUERY(A1:C4,"select `Name` where `Qty` > 5 order by `Qty`")');
  expect(wb.getValue(id, 0, 5)).toBe('Name');
  expect(wb.getValue(id, 1, 5)).toBe('Clips');
  expect(wb.getValue(id, 2, 5)).toBe('Paper');
});
