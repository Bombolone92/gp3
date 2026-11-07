// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { externalProvenance, sourceUri } from '../src/core/external-provenance.js';
import * as X from '../src/vendor/xlsx.mjs';
const missing = "'[1]Data'!$A$1", available = "'[2]Data'!$A$1";
const base = 'https://example.com/reports/Report.xlsx';
const value = wb => wb.getValue(wb.activeSheetId, 0, 0);
function source(f, cell = { v: 3 }) {
  return new Workbook({ names: [{ name: 'Amount', ref: missing }], externalWorkbooks: { version: 1, books: [
    { target: '../data/Source.xlsx', sheets: [{ name: 'Data', cells: null }], names: [{ name: 'RemoteAmount', ref: '40' }] },
    { target: '../data/Other.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 3 } }] },
  ] }, sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 40 } }, '0,1': cell } }] });
}
function transfer(src, change = () => {}) {
  const cells = src.copyCells(src.activeSheetId, [0], [0, 1]);
  const parsed = parseHtmlClipboard(cellsToHtml([['40', '3']], cells, null, [[40, 3]], { r: 0, c: 0 },
    { externalWorkbooks: src.externalWorkbooks, sourceWorkbook: base }), '40\t3');
  const dest = new Workbook({ names: src.names, sheets: [{ name: 'Report' }] });
  change(parsed, dest);
  dest.pasteCells(dest.activeSheetId, parsed.cells, 0, 0, parsed.origin, null, { externalWorkbooks: parsed.externalWorkbooks });
  return dest;
}
const cases = [
  ['named definition', 'Amount', { v: 3 }],
  ['available supporting input', `${missing}+${available}`, { v: 3 }],
  ['local formula input', `${missing}+B1`, { f: available }],
  ['opaque dependency snapshot', `${missing}+INDIRECT("B1")`, { v: 3 }],
  ['supporting defined name', "'[1]Data'!RemoteAmount", { v: 3 }],
];
it.each(cases)('resolves relative URIs inside %s without rebinding calculation state', (_, f, cell) => {
  const src = source(f, cell);
  expect(value(src)).toBe(40);
  expect(value(transfer(src))).toBe(40);
  expect(src.externalWorkbooks.books[0].target).toBe('../data/Source.xlsx');
});
it.each(cases.slice(0, 4))('rejects a changed source after rebasing %s', (_, f, cell) => {
  expect(value(transfer(source(f, cell), parsed => { parsed.externalWorkbooks.books[0].target = 'https://example.com/data/Different.xlsx'; })))
    .toEqual({ error: '#REF!' });
});
it('does not rebind changed local values during URI resolution', () => {
  expect(value(transfer(source(`${missing}+B1`), parsed => { parsed.cells[0][1] = { v: 9 }; }))).toEqual({ error: '#REF!' });
});
it('does not rebind changed available supporting data during URI resolution', () => {
  expect(value(transfer(source(`${missing}+${available}`), parsed => { parsed.externalWorkbooks.books[1].sheets[0].cells['0,0'] = 9; })))
    .toEqual({ error: '#REF!' });
});
it('does not rebind changed name definitions during URI resolution', () => {
  expect(value(transfer(source('Amount'), (_, dest) => { dest.names[0].ref = "'[1]Data'!$A$2"; }))).toEqual({ error: '#REF!' });
});
it('retains ordered URI bindings when two supporting payloads otherwise match', () => {
  const src = source(`${missing}-${available}`);
  const json = src.toJSON(); json.externalWorkbooks.books[1].sheets[0].cells = null;
  delete json.sheets[0].cells['0,0'].externalResult.context;
  const wb = new Workbook(json), changed = wb.toJSON();
  changed.externalWorkbooks.books.reverse();
  expect(value(new Workbook(changed))).toEqual({ error: '#REF!' });
});
it('separates URI leaves without normalizing ordinary URL-like text values', () => {
  const a = externalProvenance({ value: '../data/value', source: sourceUri('../data/Source.xlsx') });
  const b = externalProvenance({ source: sourceUri('https://example.com/data/Source.xlsx'), value: '../data/value' });
  expect(a.signature).toBe(b.signature);
  expect(a.sources).toEqual(['../data/Source.xlsx']);
  expect(externalProvenance({ value: 'https://example.com/data/value', source: sourceUri('../data/Source.xlsx') }).signature).not.toBe(a.signature);
});
it.each(['Amount', `${missing}+${available}`, `${missing}+INDIRECT("B1")`])('keeps %s through two native-only cycles after URI transfer', async f => {
  let wb = transfer(source(f));
  for (let cycle = 0; cycle < 2; cycle++) {
    const blob = await workbookToXlsx(wb);
    const bytes = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
    });
    const zip = X.CFB.read(new Uint8Array(bytes), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(value(wb)).toBe(40);
  }
});

it('keeps opaque namespace ordering when INDIRECT uses a literal workbook index', () => {
  const src = source(`${missing}+INDIRECT("[2]Data!A1")`), json = src.toJSON();
  json.externalWorkbooks.books.reverse();
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('does not share cached whole-state URI arrays between cell snapshots', () => {
  const src = source(`${missing}+INDIRECT("B1")`), json = src.toJSON();
  json.sheets[0].cells['1,0'] = { f: `${missing}+INDIRECT("B1")`, externalResult: { formula: `${missing}+INDIRECT("B1")`, value: 40 } };
  delete json.sheets[0].cells['0,0'].externalResult.context;
  const wb = new Workbook(json), first = wb.getCell(wb.activeSheetId, 0, 0), second = wb.getCell(wb.activeSheetId, 1, 0);
  expect(first.externalResult.context.sources).toEqual(second.externalResult.context.sources);
  expect(first.externalResult.context.sources).not.toBe(second.externalResult.context.sources);
});
it('keeps named 3D references portable when package link indexes move', () => {
  const src = source('Amount'), json = src.toJSON();
  json.names[0].ref = "'[1]Start:End'!$A$1";
  json.externalWorkbooks.books[0].sheets = ['Start', 'Middle', 'End'].map(name => ({ name, cells: null }));
  delete json.sheets[0].cells['0,0'].externalResult.context;
  const wb = new Workbook(json), dest = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Other.xlsx', sheets: [] }] } });
  const [sheet] = dest.importSheets(wb);
  expect(dest.getValue(sheet.id, 0, 0)).toBe(40);
});

it('keeps opaque non-URI link identity in the calculation snapshot', () => {
  const json = source('Amount').toJSON();
  json.names[0].ref = "'[1]'!Remote";
  json.externalWorkbooks.books = [{ kind: 'dde', xml: '<externalLink><ddeLink ddeService="ServiceA" ddeTopic="Topic"/></externalLink>', sheets: [] }];
  delete json.sheets[0].cells['0,0'].externalResult.context;
  const wb = new Workbook(json);
  expect(value(wb)).toBe(40);
  const changed = wb.toJSON(); changed.externalWorkbooks.books[0].xml = changed.externalWorkbooks.books[0].xml.replace('ServiceA', 'ServiceB');
  // The opaque link has no evaluable Remote definition.
  expect(value(new Workbook(changed))).toEqual({ error: '#NAME?' });
});
