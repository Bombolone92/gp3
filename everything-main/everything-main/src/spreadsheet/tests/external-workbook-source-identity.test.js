import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const f = "'[1]Data'!$A$1";
const book = (target = '/SourceA.xlsx', cells = null) => ({ target, sheets: [{ name: 'Data', cells }] });
const value = wb => wb.getValue(wb.activeSheetId, 0, 0);
function source(formula = f, books = [book()], names = []) {
  return new Workbook({ names, externalWorkbooks: { version: 1, books },
    sheets: [{ name: 'Report', cells: { '0,0': { f: formula, externalResult: { formula, value: 40 } } } }] });
}
it.each([f, `${f}+1`, `IFERROR(${f},7)`, 'ExternalAmount'])('rejects a different unavailable source for %s', formula => {
  const wb = source(formula, [book()], [{ name: 'ExternalAmount', ref: f }]);
  expect(value(wb)).toBe(40);
  const json = wb.toJSON(); json.externalWorkbooks.books[0].target = '/SourceB.xlsx';
  expect(value(new Workbook(json))).toEqual(formula.startsWith('IFERROR') ? 7 : { error: '#REF!' });
  json.externalWorkbooks.books[0].target = '/SourceA.xlsx';
  expect(value(new Workbook(json))).toBe(40);
});
it('does not upgrade provenance which never identified the unavailable source', () => {
  const json = source().toJSON(); json.sheets[0].cells['0,0'].externalResult.context = {};
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('ignores unrelated links and fields on an unused source', () => {
  const json = source(f, [book(), book('/Unused.xlsx')]).toJSON();
  json.externalWorkbooks.books[1].target = '/OtherUnused.xlsx';
  expect(value(new Workbook(json))).toBe(40);
});
it('keeps identities ordered across unavailable sheets of a 3D reference', () => {
  const wb = source("'[1]Start:End'!$A$1", [{ target: '/SourceA.xlsx', sheets: ['Start', 'Middle', 'End'].map(name => ({ name, cells: null })) }]);
  expect(value(wb)).toBe(40);
  const json = wb.toJSON(); json.externalWorkbooks.books[0].sheets.splice(1, 0, { name: 'Inserted', cells: null });
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('includes unavailable source identity beside available supporting values', () => {
  const wb = source(`${f}+'[2]Data'!$A$1`, [book(), book('/SourceB.xlsx', { '0,0': 3 })]);
  const json = wb.toJSON(); json.externalWorkbooks.books[0].target = '/SourceC.xlsx';
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('uses available source data instead of a saved result even after a source change', () => {
  const json = source().toJSON(); json.externalWorkbooks.books[0] = book('/SourceB.xlsx', { '0,0': 73 });
  expect(value(new Workbook(json))).toBe(73);
});
it('preserves identity across workbook-index changes in cell transfer and undo', () => {
  const src = source(), dest = new Workbook({ externalWorkbooks: { version: 1, books: [book('/Unrelated.xlsx', { '0,0': 9 })] } });
  const id = dest.activeSheetId;
  dest.pasteCells(id, src.copyCells(src.activeSheetId, [0], [0]), 0, 0, { r: 0, c: 0 }, null, { externalWorkbooks: src.externalWorkbooks });
  expect(value(dest)).toBe(40);
  expect(dest.getCell(id, 0, 0).f).toContain('[2]Data');
  dest.undo(); expect(dest.getCell(id, 0, 0)).toBeFalsy();
  dest.redo(); expect(value(dest)).toBe(40);
});
it.each([false, true])('exports current native results after changing source=%s', async changed => {
  const json = source().toJSON();
  if (changed) json.externalWorkbooks.books[0].target = '/SourceB.xlsx';
  let wb = new Workbook(json);
  for (let cycle = 0; cycle < 2; cycle++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(value(wb)).toEqual(changed ? { error: '#REF!' } : 40);
  }
});

it.each([null, 'source', [null], [4], [''], ['a'.repeat(32768)]])('rejects malformed source provenance %j', sources => {
  const json = source().toJSON(); json.sheets[0].cells['0,0'].externalResult.context.sources = sources;
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('clones source provenance rather than sharing mutable URI arrays', () => {
  const wb = source(), copied = wb.copyCells(wb.activeSheetId, [0], [0]);
  copied[0][0].externalResult.context.sources[0] = '/Other.xlsx';
  expect(value(wb)).toBe(40);
  expect(wb.getCell(wb.activeSheetId, 0, 0).externalResult.context.sources).toEqual(['/SourceA.xlsx']);
});
it('tracks changes to unresolved supporting-link identity conservatively', () => {
  const wb = source(f, [{ kind: 'dde', xml: '<externalLink><ddeLink ddeService="ServiceA" ddeTopic="Topic"/></externalLink>', sheets: [] }]);
  expect(value(wb)).toBe(40);
  const json = wb.toJSON(); json.externalWorkbooks.books[0].xml = json.externalWorkbooks.books[0].xml.replace('ServiceA', 'ServiceB');
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
