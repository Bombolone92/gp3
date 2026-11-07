import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
const links = value => ({ version: 1, books: [{ target: 'https://example.com/source.xlsx', sheets: [{ name: 'Data', cells: { '0,0': value } }] }] });
const setup = () => new Workbook({ externalWorkbooks: links(99), sheets: [{ name: 'Report', cells: { '0,0': { f: '[1]Data!$A$1' } } }] });
it.each([{}, { transpose: true }, { keepStyles: true }, { skipBlanks: true }])('pastes external source cells without binding to destination links %s', options => {
  const wb = setup(), id = wb.activeSheetId, source = links(3), before = JSON.stringify(source);
  const cells = [[{ f: '[1]Data!$A$1' }]];
  wb.pasteCells(id, cells, 1, 1, { r: 0, c: 0 }, null, { ...options, externalWorkbooks: source });
  expect(wb.getValue(id, 1, 1)).toBe(3);
  expect(wb.getValue(id, 0, 0)).toBe(99);
  expect(wb.externalWorkbooks.books).toHaveLength(2);
  expect(cells[0][0].f).toBe('[1]Data!$A$1');
  expect(JSON.stringify(source)).toBe(before);
  wb.undo(); expect(wb.externalWorkbooks.books).toHaveLength(1); expect(wb.getCell(id,1,1)).toBeUndefined();
  wb.redo(); expect(wb.getValue(id,1,1)).toBe(3);
});
it('keeps supporting books and history unchanged during preflight and refused pastes', () => {
  const wb = setup(), id = wb.activeSheetId, cells = [[{ f: '[1]Data!$A$1' }]];
  const options = { externalWorkbooks: links(3) };
  const before = JSON.stringify(wb.toJSON());
  expect(wb.pasteCells(id,cells,1,1,{r:0,c:0},null,{...options,checkOnly:true})).toBe(true);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  wb.setSheetProtected(id,true);
  const protectedState = JSON.stringify(wb.toJSON());
  wb.pasteCells(id,cells,1,1,{r:0,c:0},null,options);
  expect(JSON.stringify(wb.toJSON())).toBe(protectedState);
});
it('remaps external conditional formats without rewriting existing destination formulas', () => {
  const wb = setup(), id = wb.activeSheetId;
  const range = {r1:0,c1:0,r2:0,c2:0};
  wb.pasteStyles(id,[[{s:{bold:true}}]],0,0,null,{externalWorkbooks:links(3),conditionalFormats:[{range,source:{r:0,c:0},rule:{type:'formula',value:'[1]Data!$A$1=3',range,style:{bold:true}}}]});
  expect(wb.getValue(id,0,0)).toBe(99);
  expect(JSON.stringify(wb.sheets[0].rules)).toContain('[2]Data');
  wb.undo(); expect(wb.externalWorkbooks.books).toHaveLength(1); expect(wb.sheets[0].rules).toEqual([]);
});
