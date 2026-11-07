import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import { createExternalFormulaLinks } from '../src/core/external-formula-links.js';
import * as X from '../src/vendor/xlsx.mjs';
const ref = "'[1]Data'!$A$1";
const graph = cells => ({ version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells }] }] });
const names = [{ name: 'ExternalAmount', ref }];
const value = wb => wb.getValue(wb.activeSheetId, 0, 0);
function saved(f = 'ExternalAmount', definitions = names) {
  return new Workbook({ names: definitions, externalWorkbooks: graph(null), sheets: [{ name: 'Report', cells: { '0,0': { f, externalResult: { formula: f, value: 40 } } } }] });
}
async function native(wb, patch = null) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const put = (path, text) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(text));
  put('/xl/workbook.xml', get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  if (patch) put('/xl/worksheets/sheet1.xml', patch(get('/xl/worksheets/sheet1.xml')));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
it.each(['ExternalAmount', 'ExternalAmount+0', 'LET(amount,ExternalAmount,amount)', 'LAMBDA(amount,amount)(ExternalAmount)', 'Report!ExternalAmount'])('retains a result reached through %s', async f => {
  let wb = saved(f);
  expect(value(wb)).toBe(40);
  for (let cycle = 0; cycle < 2; cycle++) {
    wb = await native(wb);
    expect(wb.getCell(wb.activeSheetId, 0, 0).f).toBe(f);
    expect(value(wb)).toBe(40);
  }
  const json = wb.toJSON(); json.externalWorkbooks = graph({ '0,0': 73 });
  expect(value(new Workbook(json))).toBe(73);
});
it('imports a native cached value with no app provenance', async () => {
  const wb = await native(saved(), xml => xml.replace(/<v>40<\/v>/, '<v>83</v>'));
  expect(value(wb)).toBe(83);
  expect(wb.getCell(wb.activeSheetId, 0, 0).externalResult.value).toBe(83);
});
it('follows multi-step names and invalidates changed definitions', () => {
  const wb = saved('TotalAmount', [{ name: 'TotalAmount', ref: 'ExternalAmount' }, ...names]);
  expect(value(wb)).toBe(40);
  const json = wb.toJSON(); json.names[1].ref = "'[1]Data'!$A$2";
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('honors sheet-local precedence and explicit qualification', () => {
  const defs = [...names, { name: 'ExternalAmount', sheet: 'Report', ref: '9' }];
  expect(value(saved('ExternalAmount', defs))).toBe(9);
  const classify = createExternalFormulaLinks(defs, graph(null));
  expect(classify('ExternalAmount', 'Report', 0, 0).external).toBe(false);
  expect(classify('ExternalAmount', 'Other', 0, 0).linked).toBe(true);
  expect(classify('Report!ExternalAmount', 'Other', 0, 0).external).toBe(false);
});
it.each(['LET(ExternalAmount,7,ExternalAmount)', 'LAMBDA(ExternalAmount,ExternalAmount)(7)'])('does not treat lexical binding %s as an external dependency', f => {
  expect(value(saved(f))).toBe(7);
  expect(createExternalFormulaLinks(names, graph(null))(f, 'Report', 0, 0).external).toBe(false);
});
it('handles recursive name definitions without recursion overflow or fabricating a link', () => {
  const classify = createExternalFormulaLinks([{ name: 'First', ref: 'Second' }, { name: 'Second', ref: 'First' }, ...names], graph(null));
  expect(classify('First', 'Report', 0, 0).external).toBe(false);
});
it('tracks relative-name caller coordinates', () => {
  const wb = saved('ExternalAmount', [{ name: 'ExternalAmount', ref: "'[1]Data'!A1", relative: true }]);
  expect(value(wb)).toBe(40);
  wb.pasteCells(wb.activeSheetId, wb.copyCells(wb.activeSheetId, [0], [0]), 1, 0, { r: 0, c: 0 });
  expect(wb.getValue(wb.activeSheetId, 1, 0)).toEqual({ error: '#REF!' });
});
it('preserves saved results through sheet copy and JSON undo/redo', async () => {
  const wb = saved(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '9'); wb.undo(); expect(value(wb)).toBe(40);
  wb.redo(); expect(value(wb)).toBe(9); wb.undo();
  expect(value(new Workbook(wb.toJSON()))).toBe(40);
  expect(value(await native(wb.sheetToWorkbook(id)))).toBe(40);
});
it('preserves ODS value-sidecar behavior for named unavailable references', async () => {
  const wb = await workbookFromFile(await workbookToOds(saved()), 'named.ods');
  expect(value(wb)).toBe(40);
  expect(wb.externalFormulas.get(wb.activeSheetId).get('0,0').f).toBe('ExternalAmount');
});

it('copies cells within their existing name scope and rejects a missing destination definition', () => {
  const wb = saved(), id = wb.activeSheetId, cells = wb.copyCells(id, [0], [0]);
  wb.pasteCells(id, cells, 2, 2, { r: 0, c: 0 });
  expect(wb.getValue(id, 2, 2)).toBe(40);
  const dest = new Workbook({ sheets: [{ name: 'Report' }] });
  dest.pasteCells(dest.activeSheetId, cells, 0, 0, { r: 0, c: 0 }, null, { externalWorkbooks: wb.externalWorkbooks });
  expect(value(dest)).toEqual({ error: '#NAME?' });
});
it('rebases supporting links inside definitions during whole-sheet import', async () => {
  const wb = saved(), dest = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Other.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 99 } }] }] } });
  const [sheet] = dest.importSheets(wb);
  expect(dest.getValue(sheet.id, 0, 0)).toBe(40);
  const reopened = await native(dest);
  expect(reopened.getValue(reopened.sheetByName('Report').id, 0, 0)).toBe(40);
});
it('follows a supporting-workbook name reached through a local definition', () => {
  const json = saved().toJSON();
  json.names[0].ref = "'[1]Data'!RemoteAmount";
  json.externalWorkbooks.books[0].names = [{ name: 'RemoteAmount', ref: 'Data!$A$1' }];
  delete json.sheets[0].cells['0,0'].externalResult.context;
  expect(value(new Workbook(json))).toBe(40);
  json.externalWorkbooks.books[0].sheets[0].cells = { '0,0': 67 };
  expect(value(new Workbook(json))).toBe(67);
});
it('distinguishes unavailable, empty, and invalid supporting graphs', () => {
  const classify = graph => createExternalFormulaLinks(names, graph)('ExternalAmount', 'Report', 0, 0);
  expect(classify(graph(null))).toEqual({ external: true, linked: true, cached: false });
  expect(classify(graph({}))).toEqual({ external: true, linked: true, cached: true });
  expect(classify(null)).toEqual({ external: true, linked: false, cached: false });
});

it('discovers links beyond the provenance fingerprint expansion budget', async () => {
  const chain = Array.from({ length: 80 }, (_, i) => ({ name: `LinkName${i}`, ref: i === 79 ? ref : `LinkName${i + 1}` }));
  const wb = saved('LinkName0', chain);
  expect(value(wb)).toBe(40);
  expect(value(await native(wb))).toBe(40);
});
it.each([false, true])('preserves named external array output (fixed=%s)', async fixed => {
  const json = saved().toJSON(), cell = json.sheets[0].cells['0,0'];
  json.names[0].ref = "'[1]Data'!$A$1:$A$2";
  delete cell.externalResult.context;
  cell.externalResult.array = { rows: 2, cols: 1, cells: { '1,0': 17 } };
  if (fixed) cell.array = { rows: 2, cols: 1 };
  let wb = new Workbook(json);
  for (let cycle = 0; cycle < 2; cycle++) {
    expect(value(wb)).toBe(40);
    expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(17);
    wb = await native(wb);
  }
  expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(17);
});
