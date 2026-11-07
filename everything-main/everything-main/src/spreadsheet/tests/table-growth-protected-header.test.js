import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// A table widening over a column gives that column a name of its own, rewriting its header cell: a blank
// header takes a ColumnN, and a formula, number or date becomes the text it shows. That rewrite went
// through the internal writer, the one door in the app that skips the protected-range check, so a protected
// header was silently replaced (the number 2024 became the text "2024") and nothing said so. The growth is
// now refused and announced at every door a table widens by.
const grid = (rows) => rows.flatMap((row, r) => row.map((v, c) => (v == null ? null : { r, c, cell: { v } }))).filter(Boolean);

function book(header = 2024) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, grid([['Item', 'Amt', header], ['a', 1], ['b', 2]]));
  const tid = wb.addTable(id, parseRange('A1:B3'), { name: 'T' });
  const refused = [];
  wb.addEventListener('change', (e) => { if (e.detail.type === 'protected') refused.push(e.detail); });
  const pid = wb.protectRange(id, parseRange('C1:C1'), 'keep');
  return { wb, id, tid, pid, refused };
}

it('refuses to widen a table over a protected header when typing beside it, and says which range', () => {
  const { wb, id, tid, refused } = book();
  wb.setInput(id, 1, 2, '9');
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B3'));
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 2024 });
  expect(wb.getValue(id, 1, 2)).toBe(9); // the unprotected cell typed into is still written
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({ range: parseRange('C1:C1'), description: 'keep' });
});

it('refuses the same growth from a resize, and takes the column in once the header is unprotected', () => {
  const { wb, id, tid, pid, refused } = book();
  const problems = [];
  expect(wb.resizeTable(id, tid, parseRange('A1:C3'), { onInvalid: (m) => problems.push(m) })).toBe(false);
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B3'));
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 2024 });
  expect(refused).toHaveLength(1);
  expect(problems).toEqual(['The resized table would rename a protected column header. Unprotect it first.']);
  wb.unprotectRange(id, pid);
  expect(wb.resizeTable(id, tid, parseRange('A1:C3'))).toBe(true);
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: '2024' });
  expect(wb.tableColumns(id, wb.tableById(id, tid))).toEqual(['Item', 'Amt', '2024']);
});

it('refuses a blank protected header, which would be written a ColumnN name', () => {
  const { wb, id, tid, refused } = book(null);
  wb.setInput(id, 2, 2, 'x');
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B3'));
  expect(wb.getCell(id, 0, 2)).toBeUndefined();
  expect(refused).toHaveLength(1);
});

it('refuses a protected header that repeats another column name, which would be numbered', () => {
  const { wb, id, tid, refused } = book('Amt');
  expect(wb.resizeTable(id, tid, parseRange('A1:C3'))).toBe(false);
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B3'));
  expect(wb.getCell(id, 0, 2)).toMatchObject({ v: 'Amt' });
  expect(refused).toHaveLength(1);
});

it('still grows downwards past a protected column beside it, and keeps its own refusals', () => {
  const { wb, id, tid, refused } = book();
  wb.setInput(id, 3, 0, 'c');
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B4'));
  expect(refused).toHaveLength(0);
  // A block pasted or filled past the last row takes the same door and is not refused by a neighbour's lock.
  wb.setCells(id, grid([['d', 4]]).map((e) => ({ ...e, r: 4 })), 'Paste');
  expect(wb.extendTableToCover(id, parseRange('A5:B5'))).toBe(true);
  expect(wb.tableById(id, tid).range).toEqual(parseRange('A1:B5'));
  expect(refused).toHaveLength(0);
});
