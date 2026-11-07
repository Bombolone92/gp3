import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const SPEND = 'SUM(MAKEARRAY(40,40,LAMBDA(r,c,SUM(SEQUENCE(1000,100)))))'; // more array cells than one calculation may build

// The array budget is shared by every calculation and was reset only when a cell's own
// calculation began: links, names, and validation sources evaluated afterwards ran on
// whatever the last cell had left.
it('gives a link, a name, and a validation source a fresh array budget after a cell has spent its own', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const sheet = wb.sheet(id);
  wb.setInput(id, 0, 0, `=${SPEND}`);
  wb.setInput(id, 0, 1, '=HYPERLINK(CONCAT("https://example.com/", "x"), "x")');
  wb.setInput(id, 0, 2, '5');
  wb.setInput(id, 1, 2, '6');
  expect(wb.defineName('Pick', `INDEX(${sheet.name}!$C$1:$C$2, 2)`)).toBeNull();
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#NUM!' });
  expect(wb.linkAt(id, 0, 1)).toEqual({ url: 'https://example.com/x', label: 'x' });
  expect(wb.namedLocation('Pick', sheet.name)).toMatchObject({ r1: 1, c1: 2 });
  expect(wb._resolveSource(sheet, '=INDEX(C1:C2,0)')).toEqual([5, 6]);
});

it('does not let one link address that spends the budget starve the next', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, `=HYPERLINK(IF(${SPEND}>0,"https://a.example/","https://b.example/"), "a")`);
  wb.setInput(id, 1, 0, '=HYPERLINK(CONCAT("https://c.example/", "y"), "c")');
  expect(wb.linkAt(id, 0, 0)).toBeNull();
  expect(wb.linkAt(id, 1, 0)).toEqual({ url: 'https://c.example/y', label: 'c' });
});
