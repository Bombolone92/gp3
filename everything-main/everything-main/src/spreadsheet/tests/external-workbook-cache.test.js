import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { normalizeExternalWorkbooks, externalFormulaHasCaches } from '../src/core/external-workbooks.js';
import { chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const data = () => ({ version: 1, books: [{ target: '../Source.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 'North', '0,1': 7, '1,0': 'South', '1,1': 3, '2,0': '_x0041_\n', '2,1': true, '3,1': { error: '#N/A' } } }] }] });
const fixture = () => new Workbook({ externalWorkbooks: data(), names: [{ name: 'Linked', ref: "'[1]Data'!$B$1:$B$2" }],
  sheets: [{ name: 'Report', cells: { '0,0': { v: 2 }, '0,1': { f: 'SUM([1]Data!B1:B2)*A1' }, '1,1': { f: 'SUM(Linked)' } },
    charts: [{ type: 'column', id: 'linked', anchor: { r: 3, c: 0 }, w: 400, h: 300, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
      sourceRefs: [{ name: 'Total', categories: "'[1]Data'!A1:A2", values: "'[1]Data'!B1:B2" }] }] }] });
it('calculates against cached external ranges while local inputs remain live', () => {
  const wb = fixture(), id = wb.activeSheetId;
  expect(wb.sheets).toHaveLength(1); expect(wb.getValue(id, 0, 1)).toBe(20); expect(wb.getValue(id, 1, 1)).toBe(10);
  wb.setInput(id, 0, 0, '4'); expect(wb.getValue(id, 0, 1)).toBe(40); wb.undo(); expect(wb.getValue(id, 0, 1)).toBe(20);
  expect(chartData(wb, id, wb.sheets[0].charts[0])).toMatchObject({ categories: ['North', 'South'], series: [{ values: [7, 3] }] });
  const restored = new Workbook(wb.toJSON()); expect(restored.getValue(restored.activeSheetId, 0, 1)).toBe(20);
  wb.renameSheet(id, 'Data'); expect(wb.getValue(id, 0, 1)).toBe(20); expect(wb.getCell(id,0,1).f).toContain('[1]Data');
});
it('keeps cached data read-only and separate from workbook tabs', () => {
  const wb = fixture(), source = wb.sheetByName('[1]Data');
  const active = wb.activeSheetId;
  wb.setSheetProtected(source.id, false);
  expect(source.protected).toBe(true);
  wb.setActiveSheet(source.id); expect(wb.activeSheetId).toBe(active);
  expect(wb.renameSheet(source.id, 'Renamed')).toBe(false);
  expect(wb.setSheetHidden(source.id, true)).toBe(false);
  expect(wb.duplicateSheet(source.id)).toBeNull();
  expect(wb.sheetToWorkbook(source.id)).toBeNull();
  wb.setInput(source.id, 0, 1, '999'); expect(wb.getValue(source.id,0,1)).toBe(7);
  expect(wb.visibleSheets).toHaveLength(1); expect(wb.toJSON().sheets).toHaveLength(1);
});
it('distinguishes unavailable caches from cached blanks', () => {
  const cache = data(); cache.books[0].sheets.push({ name: 'Empty', cells: {} }, { name: 'Unknown', cells: null });
  const wb = new Workbook({ externalWorkbooks: cache });
  expect(wb.sheetByName('[1]Empty')).toBeTruthy(); expect(wb.sheetByName('[1]Unknown')).toBeUndefined();
  expect(externalFormulaHasCaches('SUM([1]Data!B1:B2)+1', cache)).toBe(true);
  for (const f of ['[2]Data!B1', '[1]Unknown!B1', '[1]!Name', '[File.xlsx]Data!B1']) expect(externalFormulaHasCaches(f, cache)).toBe(false);
});
it.each([Infinity, { f: '1+1' }, [], { error: '#N/A', extra: 1 }])('rejects unsupported cache values %s', value => {
  const cache = data(); cache.books[0].sheets[0].cells['0,1'] = value;
  expect(() => normalizeExternalWorkbooks(cache)).toThrow(/external workbook cache/);
});
it('preserves native external link targets, cell caches and formulas without private metadata', async () => {
  let wb = fixture();
  for (let i = 0; i < 2; i++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
    const get = p => new TextDecoder().decode(X.CFB.find(zip,p)?.content || new Uint8Array());
    expect(get('/xl/worksheets/sheet1.xml')).toContain('[1]Data!B1:B2');
    expect(get('/xl/externalLinks/_rels/externalLink1.xml.rels')).toContain('Target="../Source.xlsx"');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(wb.externalWorkbooks.books[0].sheets[0].cells).toEqual(data().books[0].sheets[0].cells);
    expect(wb.getCell(wb.activeSheetId,0,1).f).toBe('SUM([1]Data!B1:B2)*A1');
    expect(wb.getValue(wb.activeSheetId,0,1)).toBe(20);
    expect(chartData(wb,wb.activeSheetId,wb.sheets[0].charts[0]).series[0].values).toEqual([7,3]);
  }
});

it.each([
  null,
  { target: 'book.xlsx', sheets: [null] },
  { target: 'book.xlsx', sheets: [], names: {} },
  { target: 'book.xlsx', sheets: [], names: [null] },
  { target: 'book.xlsx', sheets: [], names: [{ name: '', ref: '1' }] },
  { target: 'book.xlsx', sheets: [], names: [{ name: 'Total', ref: '1' }, { name: 'TOTAL', ref: '2' }] },
  { target: 'book.xlsx', sheets: [], names: [{ name: 'Total', ref: '1', sheet: 0 }] },
])('rejects malformed external books with a diagnostic: %j', book => {
  expect(() => normalizeExternalWorkbooks({ version: 1, books: [book] })).toThrow(/Invalid external workbook cache:/);
});
it('allows the same external defined name in distinct sheet scopes', () => {
  const book = { target: 'book.xlsx', sheets: [{ name: 'One', cells: {} }, { name: 'Two', cells: {} }],
    names: [{ name: 'Total', ref: '1' }, { name: 'TOTAL', ref: '2', sheet: 0 }, { name: 'Total', ref: '3', sheet: 1 }] };
  expect(normalizeExternalWorkbooks({ version: 1, books: [book] }).books[0].names).toEqual(book.names);
});
it('restores external supporting cells and invalidates virtual sheets through structural undo and redo', () => {
  const wb = fixture(), id = wb.activeSheetId, before = wb.sheetByName('[1]Data');
  wb._structural('Update supporting cache', () => {
    const next = data(); next.books[0].sheets[0].cells['0,1'] = 17;
    wb.externalWorkbooks = normalizeExternalWorkbooks(next);
  });
  expect(wb.getValue(id, 0, 1)).toBe(40);
  expect(wb.sheet(before.id)).toBeUndefined();
  wb.undo(); expect(wb.getValue(id, 0, 1)).toBe(20);
  wb.redo(); expect(wb.getValue(id, 0, 1)).toBe(40);
});
it('merges independent external links without redirecting existing formulas and supports undo', () => {
  const dest = fixture(), source = fixture();
  const original = source.toJSON(), existingId = dest.activeSheetId;
  dest.externalWorkbooks.books[0].target = '../Other.xlsx';
  dest.externalWorkbooks.books[0].sheets[0].cells['0,1'] = 12;
  const [added] = dest.importSheets(source);
  expect(dest.externalWorkbooks.books.map(b => b.target)).toEqual(['../Other.xlsx', '../Source.xlsx']);
  expect(dest.getCell(added.id, 0, 1).f).toContain('[2]Data');
  expect(dest.getValue(existingId, 0, 1)).toBe(30);
  expect(dest.getValue(added.id, 0, 1)).toBe(20);
  expect(dest.getValue(added.id, 1, 1)).toBe(10);
  expect(chartData(dest, added.id, added.charts[0]).series[0].values).toEqual([7,3]);
  expect(source.toJSON()).toEqual(original);
  dest.undo(); expect(dest.externalWorkbooks.books).toHaveLength(1); expect(dest.sheets).toHaveLength(1);
  dest.redo(); expect(dest.externalWorkbooks.books).toHaveLength(2); expect(dest.getValue(added.id,0,1)).toBe(20);
});
it('rebases multiple incoming book IDs once across formula-bearing objects', () => {
  const source = fixture(), dest = fixture();
  source.externalWorkbooks.books.push({ ...data().books[0], target: '../Second.xlsx' });
  const sheet = source.activeSheet;
  source.setInput(sheet.id, 0, 1, '=[1]Data!B1+[2]Data!B2');
  sheet.validations = [{ type: 'list', source: '=[2]Data!A1:A2', range: { r1: 2, c1: 0, r2: 2, c2: 0 } }];
  const [added] = dest.importSheets(source);
  expect(dest.getCell(added.id,0,1).f).toBe("'[2]Data'!B1+'[3]Data'!B2");
  expect(added.validations[0].source).toBe("='[3]Data'!A1:A2");
  expect(dest.getValue(added.id,0,1)).toBe(10);
});
it.each([
  ['duplicate cached cells', '/xl/externalLinks/externalLink1.xml', xml => xml.replace(/(<cell\b[^>]*r="B1"[^>]*>[\s\S]*?<\/cell>)/, '$1$1')],
  ['invalid boolean', '/xl/externalLinks/externalLink1.xml', xml => xml.replace(/(r="B3" t="b"><v>)1/, '$1maybe')],
  ['nonfinite number', '/xl/externalLinks/externalLink1.xml', xml => xml.replace(/(r="B1" t="n"><v>)7/, '$1Infinity')],
  ['wrong cached sheet index', '/xl/externalLinks/externalLink1.xml', xml => xml.replace('sheetId="0"', 'sheetId="99"')],
  ['missing source relationship', '/xl/externalLinks/_rels/externalLink1.xml.rels', xml => xml.replace('Id="rId1"', 'Id="missing"')],
  ['internal source relationship', '/xl/externalLinks/_rels/externalLink1.xml.rels', xml => xml.replace('TargetMode="External"', '')],
  ['wrong relationship type', '/xl/externalLinks/_rels/externalLink1.xml.rels', xml => xml.replace('/externalLinkPath', '/worksheet')],
])('rejects %s instead of silently changing supporting data', async (_label, path, mutate) => {
  const bytes = new Uint8Array(await (await workbookToXlsx(fixture())).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, path).content), changed = mutate(xml);
  expect(changed).not.toBe(xml);
  X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(changed));
  await expect(workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }))).rejects.toThrow(/Invalid XLSX external workbook/);
});
it('copies cross-sheet dependencies as native supporting values while local inputs recalculate', async () => {
  const wb = new Workbook({ names: [{ name: 'Cost', ref: 'Hidden!$B$1' }], sheets: [
    { name: 'Report', cells: { '0,0': { v: 5 }, '0,1': { f: 'A1-Cost' } },
      charts: [{ type: 'column', anchor: { r: 3, c: 0 }, w: 400, h: 300, range: { r1: 0, c1: 0, r2: 0, c2: 1 }, sourceRefs: [{ name: 'Cost', categories: 'Hidden!A1', values: 'Hidden!B1' }] }] },
    { name: 'Hidden', hidden: true, cells: { '0,0': { v: 'Rent' }, '0,1': { f: 'Report!A1/2' }, '9,9': { v: 'Unrelated' } } },
  ] });
  const id = wb.activeSheetId, original = wb.toJSON();
  expect(() => wb.sheetToWorkbook(id)).toThrow(/Save the source/);
  let copy = wb.sheetToWorkbook(id, { sourceWorkbook: '../Source.xlsx' });
  expect(copy.sheets).toHaveLength(1);
  expect(copy.externalWorkbooks.books[0].sheets[0].cells).toEqual({ '0,0': 'Rent', '0,1': 2.5, '9,9': 'Unrelated' });
  expect(copy.getValue(id,0,1)).toBe(2.5);
  copy.setInput(id,0,0,'10'); expect(copy.getValue(id,0,1)).toBe(7.5);
  expect(wb.toJSON()).toEqual(original);
  for (let i = 0; i < 2; i++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(copy)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    copy = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(copy.sheets).toHaveLength(1); expect(copy.getValue(copy.activeSheetId,0,1)).toBe(7.5);
    expect(chartData(copy,copy.activeSheetId,copy.activeSheet.charts[0]).series[0].values).toEqual([2.5]);
  }
});

it('keeps dynamic external ranges complete when copied local inputs change', async () => {
  const wb = new Workbook({ sheets: [
    { name: 'Report', cells: { '0,0': { v: 1 }, '0,1': { f: 'SUM(OFFSET(Data!A1,0,0,1,A1))' } } },
    { name: 'Data', cells: { '0,0': { v: 3 }, '0,1': { v: 5 } } },
  ] });
  let copy = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '../Source.xlsx' });
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(3);
  copy.setInput(copy.activeSheetId,0,0,'2');
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(8);
  copy = await workbookFromFile(await workbookToXlsx(copy));
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(8);
  copy.setInput(copy.activeSheetId,0,0,'1');
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(3);
});
it('retains and reindexes supporting links when replacing a sheet, including local names and undo', () => {
  const source = fixture(), dest = fixture();
  dest.externalWorkbooks.books[0].target = '../Existing.xlsx';
  dest.externalWorkbooks.books[0].sheets[0].cells['0,1'] = 12;
  const old = dest.toJSON(), sourceJson = source.toJSON();
  const target = dest.addSheet('Replacement');
  dest.replaceSheetWith(target.id,source,source.activeSheetId);
  expect(dest.getCell(target.id,0,1).f).toContain('[2]Data');
  expect(dest.getValue(target.id,0,1)).toBe(20);
  expect(dest.getValue(target.id,1,1)).toBe(10);
  expect(dest.getValue(dest.sheets[0].id,1,1)).toBe(15);
  expect(chartData(dest,target.id,dest.sheet(target.id).charts[0]).series[0].values).toEqual([7,3]);
  dest.undo(); expect(dest.externalWorkbooks.books).toHaveLength(1);
  expect(dest.getCell(target.id,0,1)).toBeUndefined();
  dest.redo(); expect(dest.getValue(target.id,0,1)).toBe(20);
  expect(source.toJSON()).toEqual(sourceJson);
  dest.undo(); dest.undo(); expect(dest.toJSON()).toEqual(old);
});
it('does not duplicate supporting links when replacing from the same workbook', () => {
  const wb = fixture(), id = wb.activeSheetId, target = wb.addSheet('Replacement');
  wb.replaceSheetWith(target.id,wb,id);
  expect(wb.externalWorkbooks.books).toHaveLength(1);
  expect(wb.getValue(target.id,0,1)).toBe(20);
});

it('calculates ordered external 3D spans and leaves them unchanged by local structure edits', async () => {
  const cache = { version: 1, books: [{ target: '../Source.xlsx', sheets: [
    { name: 'First', cells: { '0,0': 2 } }, { name: 'Middle', cells: { '0,0': 3 } }, { name: 'Last', cells: { '0,0': 5 } },
  ] }] };
  const formula = "SUM('[1]First:Last'!A1)";
  const wb = new Workbook({ externalWorkbooks: cache, sheets: [
    { name: 'Report', cells: { '0,0': { f: formula } } }, { name: 'Last' },
  ] });
  const id = wb.activeSheetId, local = wb.sheets[1].id;
  expect(wb.getValue(id,0,0)).toBe(10);
  expect(externalFormulaHasCaches(formula,cache)).toBe(true);
  cache.books[0].sheets[1].cells = null;
  expect(externalFormulaHasCaches(formula,cache)).toBe(false);
  wb.insertRows(local,0,1); expect(wb.getCell(id,0,0).f).toBe(formula);
  wb.renameSheet(local,'Renamed'); expect(wb.getCell(id,0,0).f).toBe(formula);
  wb.undo(); wb.deleteSheet(local); expect(wb.getCell(id,0,0).f).toBe(formula);
  expect(wb.getValue(id,0,0)).toBe(10);
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes,{type:'array'});
  const part = X.CFB.find(zip,'/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
  const again = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
  expect(again.getCell(again.activeSheetId,0,0).f).toBe(formula);
  expect(again.getValue(again.activeSheetId,0,0)).toBe(10);
  const dest = fixture(), [added] = dest.importSheets(again);
  expect(dest.getCell(added.id,0,0).f).toBe("SUM('[2]First:Last'!A1)");
  expect(dest.getValue(added.id,0,0)).toBe(10);
});
it.each(['First:Last','Last:First'])('preserves the source span %s when one of its sheets is copied', span => {
  const wb = new Workbook({ sheets: [
    {name:'First',cells:{'0,0':{v:2},'0,1':{f:`SUM(${span}!A1)`}}},
    {name:'Middle',hidden:true,cells:{'0,0':{v:3}}}, {name:'Last',cells:{'0,0':{v:5}}},
  ] });
  const before = wb.toJSON(), copy = wb.sheetToWorkbook(wb.activeSheetId,{sourceWorkbook:'../Source.xlsx'});
  expect(copy.sheets).toHaveLength(1);
  expect(copy.externalWorkbooks.books[0].sheets.map(s=>s.name)).toEqual(['First','Middle','Last']);
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(10);
  expect(copy.getCell(copy.activeSheetId,0,1).f).toBe(`SUM('[1]${span}'!A1)`);
  expect(wb.toJSON()).toEqual(before);
});
it('preserves qualified source names, transitive formulas, functions and local scope through native export', async () => {
  const source = new Workbook({ names: [
    { name:'Rate', ref:'100' }, {name:'Rate',sheet:'Other',ref:'2'},
    { name:'Scoped',sheet:'Other',ref:'Other!$A$1' },
    { name:'Charge',sheet:'Other',ref:'LAMBDA(x,x*Rate+Scoped)' },
  ], sheets: [
    {name:'Report',cells:{'0,0':{v:4},'0,1':{f:'Other!Scoped'},'0,2':{f:'Other!Charge(A1)'}}},
    {name:'Other',cells:{'0,0':{v:3}}},
  ] });
  const original = source.toJSON();
  let copy = source.sheetToWorkbook(source.activeSheetId,{sourceWorkbook:'../Original.xlsx'});
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(3);
  expect(copy.getValue(copy.activeSheetId,0,2)).toBe(11);
  copy.setInput(copy.activeSheetId,0,0,'6'); expect(copy.getValue(copy.activeSheetId,0,2)).toBe(15);
  expect(source.toJSON()).toEqual(original);
  for(let cycle=0;cycle<2;cycle++) {
    const bytes = new Uint8Array(await (await workbookToXlsx(copy)).arrayBuffer()), zip=X.CFB.read(bytes,{type:'array'});
    const part=X.CFB.find(zip,'/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
    copy=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
    expect(copy.getValue(copy.activeSheetId,0,1)).toBe(3);
    expect(copy.getValue(copy.activeSheetId,0,2)).toBe(15);
  }
  copy.setInput(copy.activeSheetId,0,1,'=[1]Other!Scoped');
  expect(copy.getValue(copy.activeSheetId,0,1)).toBe(3);
  expect(externalFormulaHasCaches('[1]Other!Scoped',copy.externalWorkbooks)).toBe(true);
  const dest = fixture(), [added] = dest.importSheets(copy);
  expect(dest.getValue(added.id,0,1)).toBe(3); expect(dest.getValue(added.id,0,2)).toBe(15);
});
it('retains supporting data when importing a cell block and restores it with the paste undo step', () => {
  const source = new Workbook({ externalWorkbooks:data(), sheets:[{name:'Source',cells:{'0,0':{f:'SUM([1]Data!$B$1:$B$2)'}},
    validations:[{range:{r1:0,c1:0,r2:0,c2:0},type:'list',source:'=[1]Data!$A$1:$A$2'}],
  }] }), dest = fixture(), id = dest.activeSheetId;
  const before = dest.toJSON(), original = source.toJSON();
  dest.placeSheetAt(id,source,source.activeSheetId,4,2);
  expect(dest.getValue(id,4,2)).toBe(10);
  expect(dest.getCell(id,4,2).f).toContain('[2]Data');
  expect(dest.activeSheet.validations[0].source).toContain('[2]Data');
  expect(dest.externalWorkbooks.books).toHaveLength(2);
  expect(dest.getValue(id,0,1)).toBe(20);
  dest.undo(); expect(dest.toJSON()).toEqual(before);
  dest.redo(); expect(dest.getValue(id,4,2)).toBe(10); expect(dest.externalWorkbooks.books).toHaveLength(2);
  expect(source.toJSON()).toEqual(original);
});
it('resolves workbook-scoped external names without binding to destination definitions', async () => {
  const externalWorkbooks=data(); externalWorkbooks.books[0].names=[
    {name:'Total',ref:'SUM(Data!$B$1:$B$2)'}, {name:'Total',ref:'100',sheet:0},
  ];
  let wb=new Workbook({externalWorkbooks,names:[{name:'Total',ref:'999'}],sheets:[{name:'Report',cells:{
    '0,0':{f:'[1]!Total'},'0,1':{f:'[1]Data!Total'},'0,2':{f:'Total'},
  }}]});
  for(let cycle=0;cycle<2;cycle++) {
    expect(wb.getValue(wb.activeSheetId,0,0)).toBe(10);
    expect(wb.getValue(wb.activeSheetId,0,1)).toBe(100);
    expect(wb.getValue(wb.activeSheetId,0,2)).toBe(999);
    expect(externalFormulaHasCaches('[1]!Total',wb.externalWorkbooks)).toBe(true);
    const bytes=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),zip=X.CFB.read(bytes,{type:'array'});
    const part=X.CFB.find(zip,'/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
    wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
  }
});
it('formats numeric external chart categories with the native chart format code', async () => {
  let wb=fixture();
  wb.activeSheet.charts[0].sourceRefs[0].categories="'[1]Data'!B1:B2";
  wb.activeSheet.charts[0].sourceRefs[0].categoryFormat='0000';
  expect(chartData(wb,wb.activeSheetId,wb.activeSheet.charts[0]).categories).toEqual(['0007','0003']);
  wb=await workbookFromFile(await workbookToXlsx(wb));
  expect(chartData(wb,wb.activeSheetId,wb.activeSheet.charts[0]).categories).toEqual(['0007','0003']);
});
it('keeps a native formula and its last calculated result when the source cache is unavailable', async () => {
  const original=fixture(); original.externalWorkbooks.books[0].sheets[0].cells=null;
  const bytes=new Uint8Array(await(await workbookToXlsx(original)).arrayBuffer()),zip=X.CFB.read(bytes,{type:'array'});
  const get=(zip,path)=>new TextDecoder().decode(X.CFB.find(zip,path).content);
  const strip=zip=>X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(get(zip,'/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
  X.CFB.utils.cfb_add(zip,'/xl/worksheets/sheet1.xml',new TextEncoder().encode(get(zip,'/xl/worksheets/sheet1.xml').replace(/<c\b[^>]*r="B1"[^>]*>[\s\S]*?<\/c>/,'<c r="B1"><f>[1]Data!B1</f><v>77</v></c>')));
  strip(zip);
  let wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
  for(let cycle=0;cycle<2;cycle++) {
    expect(wb.getValue(wb.activeSheetId,0,1)).toBe(77);
    const next=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
    expect(get(next,'/xl/worksheets/sheet1.xml')).toContain('<f>[1]Data!B1</f>');
    strip(next); wb=await workbookFromFile(X.CFB.write(next,{type:'array',fileType:'zip'}));
  }
  wb.setInput(wb.activeSheetId,0,1,'78');
  const changed=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
  expect(get(changed,'/xl/worksheets/sheet1.xml')).not.toContain('<f>[1]Data!B1</f>');
});
it('preserves DDE and OLE link parts without activating them or changing workbook link indices', async () => {
  const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  let wb=new Workbook({externalWorkbooks:{version:1,books:[
    {kind:'dde',xml:`<externalLink xmlns="${main}"><ddeLink ddeService="Service" ddeTopic="Topic"><ddeItems><ddeItem name="Value"><values rows="1" cols="1"><value t="n"><val>4</val></value></values></ddeItem></ddeItems></ddeLink></externalLink>`},
    {kind:'ole',target:'../Object.bin',xml:`<externalLink xmlns="${main}" xmlns:r="${rel}"><oleLink r:id="old" progId="Example.Object"><oleItems><oleItem name="Value" advise="0"/></oleItems></oleLink></externalLink>`},
    data().books[0],
  ]},sheets:[{name:'Report',cells:{'0,0':{f:'SUM([3]Data!B1:B2)'}}}]});
  for(let cycle=0;cycle<2;cycle++) {
    expect(wb.getValue(wb.activeSheetId,0,0)).toBe(10);
    const bytes=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),zip=X.CFB.read(bytes,{type:'array'});
    const get=path=>new TextDecoder().decode(X.CFB.find(zip,path)?.content||new Uint8Array());
    expect(get('/xl/externalLinks/externalLink1.xml')).toContain('ddeService="Service"');
    expect(get('/xl/externalLinks/externalLink1.xml')).toContain('<val>4</val>');
    expect(get('/xl/externalLinks/externalLink2.xml')).toContain('progId="Example.Object"');
    expect(get('/xl/externalLinks/_rels/externalLink2.xml.rels')).toContain('Target="../Object.bin"');
    X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
    wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
    expect(wb.externalWorkbooks.books.map(b=>b.kind||'workbook')).toEqual(['dde','ole','workbook']);
  }
  const copy=wb.sheetToWorkbook(wb.activeSheetId,{sourceWorkbook:'../Nested/Source.xlsx'});
  expect(copy.externalWorkbooks.books[1].target).toBe('../Object.bin');
});
it('preserves alternate link relationships and rebases relative targets without colliding with the primary ID', async () => {
  const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main',rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const cache=data(); cache.books[0].xml=`<externalLink xmlns="${main}" xmlns:r="${rel}" xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2021/extlinks2021"><externalBook r:id="rPrimary"><x:alternateUrls driveId="drive"><x:absoluteUrl r:id="rId1"/><x:relativeUrl r:id="rRelative"/></x:alternateUrls></externalBook></externalLink>`;
  cache.books[0].relationships=[
    {id:'rId1',type:`${rel}/externalLinkPath`,target:'https://example.test/source.xlsx'},
    {id:'rRelative',type:`${rel}/externalLinkPath`,target:'./alias.xlsx'},
  ];
  let wb=new Workbook({externalWorkbooks:cache,sheets:[{name:'Report',cells:{'0,0':{f:'SUM([1]Data!B1:B2)'}}}]});
  for(let cycle=0;cycle<2;cycle++) {
    const bytes=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),zip=X.CFB.read(bytes,{type:'array'});
    const get=path=>new TextDecoder().decode(X.CFB.find(zip,path)?.content||new Uint8Array());
    expect(get('/xl/externalLinks/externalLink1.xml')).toContain('r:id="rPrimary"');
    expect(get('/xl/externalLinks/externalLink1.xml')).toContain('r:id="rId1"');
    expect(get('/xl/externalLinks/_rels/externalLink1.xml.rels')).toContain('Id="rId1"');
    X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
    wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
    expect(wb.externalWorkbooks.books[0].relationships).toEqual(cache.books[0].relationships);
    expect(wb.getValue(wb.activeSheetId,0,0)).toBe(10);
  }
  const copy=wb.sheetToWorkbook(wb.activeSheetId,{sourceWorkbook:'../Moved/Original.xlsx'});
  expect(copy.externalWorkbooks.books[0].relationships.map(r=>r.target)).toEqual(['https://example.test/source.xlsx','../Moved/alias.xlsx']);
  expect(wb.externalWorkbooks.books[0].relationships[1].target).toBe('./alias.xlsx');
});
it('reindexes workbook links inside imported external name definitions', async () => {
  const source=new Workbook({externalWorkbooks:{version:1,books:[
    {target:'../Data.xlsx',sheets:[{name:'Data',cells:{'0,0':3}}]},
    {target:'../Named.xlsx',sheets:[{name:'Names',cells:{}}],names:[{name:'Linked',ref:"'[1]Data'!$A$1"}]},
  ]},sheets:[{name:'Report',cells:{'0,0':{f:"'[2]Names'!Linked"}}}]});
  const original=source.toJSON(),dest=fixture(),[added]=dest.importSheets(source);
  expect(dest.getValue(added.id,0,0)).toBe(3);
  expect(dest.externalWorkbooks.books[2].names[0].ref).toBe("'[2]Data'!$A$1");
  expect(source.toJSON()).toEqual(original);
  const again=await workbookFromFile(await workbookToXlsx(dest));
  expect(again.getValue(again.sheets[1].id,0,0)).toBe(3);
});
it('exports relocated link targets without changing source formulas, cache metadata or history', async () => {
  const wb = fixture(), id = wb.activeSheetId;
  wb.setInput(id,0,0,'4');
  const before = wb.toJSON();
  const blob = await workbookToXlsx(wb,{sourceWorkbook:'https://example.com/reports/Report.xlsx'});
  const bytes = new Uint8Array(await blob.arrayBuffer()), zip = X.CFB.read(bytes,{type:'array'});
  const get = path => new TextDecoder().decode(X.CFB.find(zip,path)?.content || new Uint8Array());
  expect(get('/xl/externalLinks/_rels/externalLink1.xml.rels')).toContain('Target="https://example.com/Source.xlsx"');
  X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
  const reopened = await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
  expect(reopened.externalWorkbooks.books[0].target).toBe('https://example.com/Source.xlsx');
  expect(reopened.getValue(reopened.activeSheetId,0,1)).toBe(40);
  expect(wb.toJSON()).toEqual(before);
  wb.undo();expect(wb.getValue(id,0,1)).toBe(20);
  expect(wb.externalWorkbooks.books[0].target).toBe('../Source.xlsx');
});
it.each(['INDIRECT("[1]Data!B1")','INDIRECT("[1]Data!R1C2",FALSE)','SUM(INDIRECT("Linked"))','INDIRECT("[1]Data!ExternalName")','[1]Data!Dynamic'])('does not treat supporting caches as an open workbook for %s', formula => {
  const json=fixture().toJSON();
  json.externalWorkbooks.books[0].names=[{name:'ExternalName',ref:'Data!$B$1'},{name:'Dynamic',ref:'INDIRECT("B1")',sheet:0}];
  const wb=new Workbook(json),id=wb.activeSheetId;
  wb.setInput(id,5,0,`=${formula}`);
  expect(wb.getValue(id,5,0)).toEqual({error:'#REF!'});
  wb.setInput(id,5,0,'=INDIRECT("A1")');expect(wb.getValue(id,5,0)).toBe(2);
  wb.setInput(id,5,0,'=[1]Data!B1');expect(wb.getValue(id,5,0)).toBe(7);
});
it('preserves source-derived chart number formats when a copied sheet links to omitted data', async () => {
  const source = new Workbook({sheets:[{name:'Report',charts:[{id:'formats',type:'column',range:{r1:0,c1:0,r2:1,c2:1},anchor:{r:0,c:0},w:400,h:300,
    sourceRefs:[{categories:'Data!A1:A2',values:'Data!B1:B2'}]}]},{name:'Data',cells:{
    '0,0':{v:1,s:{fmt:'custom',code:'0000'}},'1,0':{v:2,s:{fmt:'custom',code:'0000'}},
    '0,1':{v:7,s:{fmt:'currency',cur:'USD',dec:2}},'1,1':{v:9,s:{fmt:'currency',cur:'USD',dec:2}}}}]});
  const original=source.toJSON();
  let copy=source.sheetToWorkbook(source.activeSheetId,{sourceWorkbook:'https://example.com/source.xlsx'});
  for (let cycle=0;cycle<2;cycle++) {
    const chart=copy.activeSheet.charts[0],data=chartData(copy,copy.activeSheetId,chart);
    expect(data.categories).toEqual(['0001','0002']);
    expect(data.valueStyle).toMatchObject({fmt:'currency',cur:'USD',dec:2});
    expect(chart.sourceRefs[0].values).toContain('[1]Data');
    expect(chart.sourceRefs[0].literal?.values).toBeUndefined();
    expect(chart.sourceRefs[0].literal?.categories).toBeUndefined();
    const bytes=new Uint8Array(await(await workbookToXlsx(copy)).arrayBuffer()),zip=X.CFB.read(bytes,{type:'array'});
    const part=X.CFB.find(zip,'/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip,'/xl/workbook.xml',new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,'')));
    copy=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}));
  }
  expect(source.toJSON()).toEqual(original);
});
it('keeps independent copied chart formats and leaves retained local sources dynamic', () => {
  const cell=(v,code)=>({v,s:{fmt:'custom',code}});
  const source = new Workbook({sheets:[{name:'Report',cells:{'0,0':cell(1,'000'),'0,1':cell(7,'0.00')},charts:[{id:'formats',type:'column',range:{r1:0,c1:0,r2:0,c2:1},anchor:{r:2,c:0},w:400,h:300,
    sourceRefs:[{categories:'Report!A1',values:'Report!B1'},{categories:'Data!A1',values:'Data!B1'},{categories:'Data!C1',values:'Data!D1'}]}]},
    {name:'Data',cells:{'0,0':cell(.25,'0%'),'0,1':cell(7,'0.00'),'0,2':cell(12,'0000'),'0,3':cell(9,'0.000')}}]});
  const copy=source.sheetToWorkbook(source.activeSheetId,{sourceWorkbook:'https://example.com/source.xlsx'}),chart=copy.activeSheet.charts[0];
  expect(chart.sourceRefs[0].categoryFormat).toBe('');
  expect(chart.sourceRefs[1].categoryFormat).toBe('0%');expect(chart.sourceRefs[2].categoryFormat).toBe('0000');
  expect(chart.sourceRefs[1].valueFormat).toBe('0.00');expect(chart.sourceRefs[2].valueFormat).toBe('0.000');
  copy.setCells(copy.activeSheetId,[{r:0,c:0,cell:cell(1,'00000')}]);
  expect(chartData(copy,copy.activeSheetId,chart).categories).toEqual(['00001']);
  expect(chartData(copy,copy.activeSheetId,chart).series.map(s=>s.categories)).toEqual([['00001'],['25%'],['0012']]);
});
