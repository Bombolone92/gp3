// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { Workbook } from '../src/core/workbook.js';
const links = value => ({version:1,books:[{target:'https://example.com/data.xlsx',sheets:[{name:'Data',cells:{'0,0':value}}]}]});
const sourceCells = [[{f:'[1]Data!$A$1'}]];
const html = () => cellsToHtml([['3']],sourceCells,null,[[3]],{r:0,c:0},{externalWorkbooks:links(3)});
it('transfers source caches through actual HTML parsing without destination link collisions', () => {
  const parsed = parseHtmlClipboard(html(),'3');
  expect(parsed.externalWorkbooks.books[0].sheets[0].cells['0,0']).toBe(3);
  const wb = new Workbook({externalWorkbooks:links(99)}), id = wb.activeSheetId;
  wb.pasteCells(id,parsed.cells,0,1,parsed.origin,null,{externalWorkbooks:parsed.externalWorkbooks});
  expect(wb.getValue(id,0,1)).toBe(3);
  expect(wb.getCell(id,0,1).f).toContain('[2]Data');
  wb.undo();expect(wb.externalWorkbooks.books).toHaveLength(1);
});
it.each(['missing','malformed','empty','unknown index'])('refuses %s supporting metadata instead of silently using destination links', kind => {
  const doc = new DOMParser().parseFromString(html(),'text/html'), table = doc.querySelector('table');
  if (kind === 'missing') table.removeAttribute('data-spreadsheet-external-workbooks');
  if (kind === 'malformed') table.setAttribute('data-spreadsheet-external-workbooks','{');
  if (kind === 'empty') table.setAttribute('data-spreadsheet-external-workbooks','null');
  if (kind === 'unknown index') table.setAttribute('data-spreadsheet-cells',JSON.stringify([[{f:'[2]Data!A1'}]]));
  expect(parseHtmlClipboard(table.outerHTML,'3').error).toMatch(/external workbook links/);
});
it('does not mistake a bracketed string literal for an external formula', () => {
  const parsed = parseHtmlClipboard(cellsToHtml([['[1]Data!A1']],[[{f:'"[1]Data!A1"'}]]));
  expect(parsed.error).toBeUndefined(); expect(parsed.cells[0][0].f).toBe('"[1]Data!A1"');
});
it('makes relative source links portable when the original package URI is known', () => {
  const source = links(3);source.books[0].target = '../data/Source.xlsx';
  const parsed = parseHtmlClipboard(cellsToHtml([['3']],sourceCells,null,[[3]],{r:0,c:0},{externalWorkbooks:source,sourceWorkbook:'https://example.com/reports/Report.xlsx'}));
  expect(parsed.externalWorkbooks.books[0].target).toBe('https://example.com/data/Source.xlsx');
  expect(source.books[0].target).toBe('../data/Source.xlsx');
});
it('omits unrelated supporting data and remaps retained formulas before HTML serialization', () => {
  const source={version:1,books:[{target:'https://example.com/unrelated.xlsx',sheets:[{name:'Data',cells:{'0,0':'unrelated private value'}}]},...links(3).books]};
  const cells = [[{f:'[2]Data!$A$1'}]];
  const copied=cellsToHtml([['3']],cells,null,[[3]],{r:0,c:0},{externalWorkbooks:source});
  expect(copied).not.toContain('unrelated private value');
  const parsed=parseHtmlClipboard(copied,'3');
  expect(parsed.externalWorkbooks.books).toHaveLength(1);
  expect(parsed.cells[0][0].f).toContain('[1]Data');
  const wb=new Workbook({externalWorkbooks:links(99)}),id=wb.activeSheetId;
  wb.pasteCells(id,parsed.cells,0,0,parsed.origin,null,{externalWorkbooks:parsed.externalWorkbooks});
  expect(wb.getValue(id,0,0)).toBe(3);
  expect(cells[0][0].f).toBe('[2]Data!$A$1');
  const plain=cellsToHtml([['42']],[[{v:42}]],null,[[42]],null,{externalWorkbooks:source});
  expect(plain).not.toContain('data-spreadsheet-external-workbooks');
  expect(plain).not.toContain('unrelated private value');
});
it('carries a saved formula result through graph selection and destination reindexing', () => {
  const unavailable=links(3); unavailable.books[0].sheets[0].cells=null;
  const graph={version:1,books:[...links(99).books,...unavailable.books]};
  const f='[2]Data!$A$1', cells=[[{v:null,f,externalResult:{formula:f,value:73}}]];
  const parsed=parseHtmlClipboard(cellsToHtml([['73']],cells,null,[[73]],{r:0,c:0},{externalWorkbooks:graph}),'73');
  const wb=new Workbook({externalWorkbooks:links(99)}),id=wb.activeSheetId;
  wb.pasteCells(id,parsed.cells,2,3,parsed.origin,null,{externalWorkbooks:parsed.externalWorkbooks});
  expect(wb.getValue(id,2,3)).toBe(73);
  expect(wb.getCell(id,2,3).f).toContain('[2]Data');
  wb.undo(); expect(wb.externalWorkbooks.books).toHaveLength(1);
  wb.redo(); expect(wb.getValue(id,2,3)).toBe(73);
});
it('retains named caller-independent saved results across workbook index changes', () => {
  const unavailable=links(3); unavailable.books[0].sheets[0].cells=null;
  unavailable.books[0].names=[{name:'Amount',ref:'7'}];
  const f="'[2]'!Amount+'[2]Data'!$A$1";
  const source=new Workbook({externalWorkbooks:{version:1,books:[...links(99).books,...unavailable.books]},
    sheets:[{name:'Source',cells:{'0,0':{f,externalResult:{formula:f,value:73}}}}]});
  const copied=source.copyCells(source.activeSheetId,[0],[0]);
  const parsed=parseHtmlClipboard(cellsToHtml([['73']],copied,null,[[73]],{r:0,c:0},{externalWorkbooks:source.externalWorkbooks}),'73');
  const dest=new Workbook({externalWorkbooks:links(99)}),id=dest.activeSheetId;
  dest.pasteCells(id,parsed.cells,2,3,parsed.origin,null,{externalWorkbooks:parsed.externalWorkbooks});
  expect(dest.getValue(id,2,3)).toBe(73);
});
it.each([1, 9])('keeps local input provenance through HTML link compaction (destination input %s)', input => {
  const f = "'[2]Data'!$A$1+$B$1";
  const source = new Workbook({ externalWorkbooks: { version: 1, books: [links(7).books[0], { target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 41 } }, '0,1': { v: 1 } } }] });
  const copied = source.copyCells(source.activeSheetId, [0], [0]);
  const parsed = parseHtmlClipboard(cellsToHtml([['41']], copied, null, [[41]], { r: 0, c: 0 }, { externalWorkbooks: source.externalWorkbooks }), '41');
  const dest = new Workbook({ externalWorkbooks: links(99), sheets: [{ name: 'Report', cells: { '0,1': { v: input } } }] }), id = dest.activeSheetId;
  dest.pasteCells(id, parsed.cells, 3, 0, parsed.origin, null, { externalWorkbooks: parsed.externalWorkbooks });
  expect(dest.getValue(id, 3, 0)).toEqual(input === 1 ? 41 : { error: '#REF!' });
});
it.each([1, 2])('validates calculation-version provenance after HTML transfer to version %s', version => {
  const f = "'[1]Data'!$A$1+LEN(\"😀\")";
  const source = new Workbook({ calculationCompatibility: { version: 2 },
    externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 41 } } } }] });
  const parsed = parseHtmlClipboard(cellsToHtml([['41']], source.copyCells(source.activeSheetId, [0], [0]), null, [[41]],
    { r: 0, c: 0 }, { externalWorkbooks: source.externalWorkbooks }), '41');
  const dest = new Workbook({ calculationCompatibility: { version }, externalWorkbooks: links(99) }), id = dest.activeSheetId;
  dest.pasteCells(id, parsed.cells, 0, 0, parsed.origin, null, { externalWorkbooks: parsed.externalWorkbooks });
  expect(dest.getValue(id, 0, 0)).toEqual(version === 2 ? 41 : { error: '#REF!' });
});

it('keeps a named external saved result through HTML within the same name scope', () => {
  const f = 'ExternalAmount';
  const wb = new Workbook({ names: [{ name: f, ref: "'[1]Data'!$A$1" }],
    externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 40 } } } }] });
  const parsed = parseHtmlClipboard(cellsToHtml([['40']], wb.copyCells(wb.activeSheetId, [0], [0]), null, [[40]],
    { r: 0, c: 0 }, { externalWorkbooks: wb.externalWorkbooks }), '40');
  wb.pasteCells(wb.activeSheetId, parsed.cells, 2, 0, parsed.origin);
  expect(wb.getValue(wb.activeSheetId, 2, 0)).toBe(40);
});
it('keeps unavailable source provenance when resolving a relative clipboard target', () => {
  const f = "'[1]Data'!$A$1";
  const wb = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '../data/Source.xlsx', sheets: [{ name: 'Data', cells: null }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 40 } } } }] });
  const parsed = parseHtmlClipboard(cellsToHtml([['40']], wb.copyCells(wb.activeSheetId, [0], [0]), null, [[40]],
    { r: 0, c: 0 }, { externalWorkbooks: wb.externalWorkbooks, sourceWorkbook: 'https://example.com/reports/Report.xlsx' }), '40');
  const dest = new Workbook();
  dest.pasteCells(dest.activeSheetId, parsed.cells, 0, 0, parsed.origin, null, { externalWorkbooks: parsed.externalWorkbooks });
  expect(dest.getValue(dest.activeSheetId, 0, 0)).toBe(40);
  expect(wb.getCell(wb.activeSheetId, 0, 0).externalResult.context.sources).toEqual(['../data/Source.xlsx']);
  expect(parsed.cells[0][0].externalResult.context.sources).toEqual(['https://example.com/data/Source.xlsx']);
});
it('retains manual and filter visibility in HTML clipboard supporting caches', () => {
  const source = { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data',
    cells: { '0,0': 3, '1,0': 7, '2,0': 5 }, visibility: { hiddenRows: [1], filteredRows: [2] } }] }] };
  const cells = [[{ f: 'SUBTOTAL(9,[1]Data!A1:A3)' }, { f: 'SUBTOTAL(109,[1]Data!A1:A3)' }]];
  const parsed = parseHtmlClipboard(cellsToHtml([['10', '3']], cells, null, [[10, 3]], { r: 0, c: 0 }, { externalWorkbooks: source }));
  expect(parsed.error).toBeUndefined();
  const wb = new Workbook();
  wb.pasteCells(wb.activeSheetId, parsed.cells, 0, 0, parsed.origin, null, { externalWorkbooks: parsed.externalWorkbooks });
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(10);
  expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(3);
  expect(wb.externalWorkbooks.books[0].sheets[0].cells['1,0']).toBe(7);
  wb.undo(); expect(wb.getCell(wb.activeSheetId, 0, 0)).toBeFalsy();
  wb.redo(); expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(3);
});
