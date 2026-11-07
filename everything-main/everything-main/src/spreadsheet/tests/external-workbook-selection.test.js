import { expect, it } from 'vitest';
import { selectExternalWorkbooks } from '../src/core/external-workbooks.js';
const books = () => ({version:1,books:[1,2,3,4].map(n=>({target:`https://example.com/${n}.xlsx`,sheets:[{name:'Data',cells:{'0,0':n}}],names:[]}))});
it('omits supporting caches for copies with only values or local calculations', () => {
  expect(selectExternalWorkbooks(books(),[]).externalWorkbooks).toBeNull();
  expect(selectExternalWorkbooks(books(),['SUM(A1:B2)+1','"[2]Data!A1"']).externalWorkbooks).toBeNull();
});
it('compacts reachable links and their transitive defined-name references in one pass', () => {
  const source = books();source.books[3].names.push({name:'Total',ref:'[2]Data!A1'});
  source.books[1].names.push({name:'Cycle',ref:'[4]Data!A1'});
  const before = JSON.stringify(source);
  const selected = selectExternalWorkbooks(source,['[4]!Total+[2]Data!A1']);
  expect(selected.externalWorkbooks.books.map(b=>b.target)).toEqual(['https://example.com/2.xlsx','https://example.com/4.xlsx']);
  expect(selected.externalWorkbooks.books[1].names[0].ref).toContain('[1]Data');
  expect(selected.externalWorkbooks.books[0].names[0].ref).toContain('[2]Data');
  expect(selected.mapFormula('[4]!Total+[2]Data!A1')).toContain('[2]');
  expect(selected.mapFormula('[4]!Total+[2]Data!A1')).toContain('[1]Data');
  expect(JSON.stringify(source)).toBe(before);
});
it.each(['INDIRECT(A1)','INDIRECT("[4]Data!A1")','SUM(Alias)'])('retains the namespace for dynamic dependencies in %s', formula => {
  const source=books(),selected=selectExternalWorkbooks(source,[formula]);
  expect(selected.externalWorkbooks).toBe(source);expect(selected.mapFormula(formula)).toBe(formula);
});
