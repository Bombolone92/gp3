import { expect, it } from 'vitest';
import { rebaseWorkbookTarget, relativeWorkbookTarget, workbookPathUri } from '../src/core/workbook-location.js';
import { rebaseExternalWorkbooks } from '../src/core/external-workbooks.js';
it.each([
  ['../data/Book%20A.xlsx','https://example.com/reports/quarter/Report.xlsx','https://example.com/reports/data/Book%20A.xlsx'],
  ['?revision=2','https://example.com/Book.xlsx?revision=1#old','https://example.com/Book.xlsx?revision=2'],
  ['#part','../reports/Book.xlsx?revision=1','../reports/Book.xlsx?revision=1#part'],
  ['../../Source.xlsx','../reports/Book.xlsx','../../Source.xlsx'],
  ['../data/Book.xlsx','/drive/reports/Book.xlsx','/drive/data/Book.xlsx'],
  ['https://other.example/Book.xlsx','../Report.xlsx','https://other.example/Book.xlsx'],
])('resolves %s against %s', (target,source,expected) => expect(rebaseWorkbookTarget(target,source)).toBe(expected));
it('encodes filesystem names exactly once when producing a relative package URI', () => {
  expect(relativeWorkbookTarget('/drive/data/100% #1.xlsx','/drive/reports/Report.xlsx')).toBe('../data/100%25%20%231.xlsx');
});
it('rebases supplemental source relationships without changing cache data or the original graph', () => {
  const graph = {version:1,books:[{target:'../Source.xlsx',sheets:[{name:'Data',cells:{'0,0':3}}],names:[],relationships:[{id:'alternate',type:'example',target:'./Source.xlsx?revision=1'}]}]};
  const before = JSON.stringify(graph);
  const moved = rebaseExternalWorkbooks(graph,'https://example.com/reports/Report.xlsx');
  expect(moved.books[0].target).toBe('https://example.com/Source.xlsx');
  expect(moved.books[0].relationships[0].target).toBe('https://example.com/reports/Source.xlsx?revision=1');
  expect(moved.books[0].sheets).toEqual(graph.books[0].sheets);
  expect(JSON.stringify(graph)).toBe(before);
});

it('represents known drive paths without inventing a local filesystem URL', () => {
  expect(workbookPathUri('/drive/100% #1.xlsx')).toBe('/drive/100%25%20%231.xlsx');
  expect(workbookPathUri('Spreadsheets/Report.xlsx')).toBeNull();
  expect(workbookPathUri('~/Spreadsheets/Report.xlsx')).toBeNull();
  expect(workbookPathUri(null)).toBeNull();
});
