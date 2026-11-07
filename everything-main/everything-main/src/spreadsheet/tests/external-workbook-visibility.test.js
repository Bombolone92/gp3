import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { normalizeExternalWorkbooks } from '../src/core/external-workbooks.js';
import { normalizeExternalVisibility } from '../src/core/external-visibility.js';
import * as X from '../src/vendor/xlsx.mjs';
const NS = 'urn:puter:spreadsheet:external-visibility:1';
function fixture(kind = 'row', includeHidden = false) {
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: {
    '10,0': { f: 'SUBTOTAL(9,Data!B2:B4)' }, '11,0': { f: 'SUBTOTAL(109,Data!B2:B4)' },
    '12,0': { f: 'SUM(Data!B2:B4)' },
  }, charts: [{ type: 'column', includeHidden, anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    sourceRefs: [{ name: 'Volume', categories: 'Data!A2:A4', values: 'Data!B2:B4' }] }] },
  { name: 'Data', cells: { '0,0': { v: 'Category' }, '0,1': { v: 'Amount' }, '1,0': { v: 'A' }, '2,0': { v: 'B' }, '3,0': { v: 'C' },
    '1,1': { v: 3 }, '2,1': { v: 7 }, '3,1': { v: 5 } },
  ...(kind === 'row' ? { hiddenRows: [2] } : kind === 'column' ? { hiddenCols: [1] }
    : { filter: { range: { r1: 0, c1: 0, r2: 3, c2: 1 }, criteria: {} } }) }] });
  if (kind === 'filter') { wb.setFilterCriteria(wb.sheets[1].id, 0, { values: ['A', 'C'] }); expect([...wb.sheets[1].filterHidden]).toEqual([2]); }
  return wb;
}
const copied = wb => wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: 'https://example.com/Original.xlsx' });
const data = wb => { const d = chartData(wb, wb.activeSheetId, wb.activeSheet.charts[0]); return [d.categories, d.series.map(s => s.values)]; };
const formulas = wb => [10, 11, 12].map(r => wb.getValue(wb.activeSheetId, r, 0));
const decode = part => new TextDecoder().decode(part.content);
async function native(wb, mutate) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const put = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  put('/xl/workbook.xml', decode(X.CFB.find(zip, '/xl/workbook.xml')).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  if (mutate) mutate(zip, put);
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), zip };
}
it.each(['row', 'column', 'filter'])('retains %s visibility, formulas and live values through copying and two XLSX cycles', async kind => {
  const source = fixture(kind), expected = data(source), calculated = formulas(source), before = JSON.stringify(source.toJSON());
  let wb = copied(source);
  for (let pass = 0; pass < 3; pass++) {
    expect(data(wb)).toEqual(expected); expect(formulas(wb)).toEqual(calculated);
    const cache = wb.externalWorkbooks.books[0].sheets[0];
    expect(cache.cells['2,1']).toBe(7); // Hidden values remain available to SUM and later visibility changes.
    const included = new Workbook(wb.toJSON()); included.activeSheet.charts[0].includeHidden = true;
    expect(data(included)).toEqual([['A', 'B', 'C'], [[3, 7, 5]]]);
    if (pass < 2) {
      const result = await native(wb); wb = result.wb;
      const xml = decode(X.CFB.find(result.zip, '/xl/charts/chart1_1.xml'));
      expect(xml).toContain(`<c:ptCount val="${kind === 'column' ? 0 : 2}"/>`);
      const external = decode(X.CFB.find(result.zip, '/xl/externalLinks/externalLink1.xml'));
      expect(external).toContain(NS); expect(external).not.toMatch(/<row[^>]*hidden=/);
    }
  }
  const edited = wb.toJSON(); edited.externalWorkbooks.books[0].sheets[0].cells['1,1'] = 30;
  const live = new Workbook(edited);
  expect(formulas(live)[2]).toBe(42);
  if (kind !== 'column') expect(data(live)[1]).toEqual([[30, 5]]);
  const updated = await native(live); expect(data(updated.wb)).toEqual(data(live));
  expect(formulas(updated.wb)).toEqual(formulas(live));
  expect(JSON.stringify(source.toJSON())).toBe(before);
});
it.each(['row', 'column', 'filter'])('honors includeHidden for copied %s sources', async kind => {
  const source = fixture(kind, true), result = await native(copied(source));
  expect(data(result.wb)).toEqual(data(source));
});
it('keeps filter and manual hiding distinct for subtotal semantics', () => {
  expect(formulas(copied(fixture('row')))).toEqual([15, 8, 15]);
  expect(formulas(copied(fixture('filter')))).toEqual([8, 8, 15]);
});
it('normalizes and bounds visibility without aliasing caller arrays', () => {
  const raw = { hiddenRows: [4, 2, 4], hiddenCols: [16383], filteredRows: [1048575] };
  const normalized = normalizeExternalVisibility(raw);
  expect(normalized).toEqual({ hiddenRows: [2, 4], hiddenCols: [16383], filteredRows: [1048575] });
  raw.hiddenRows.push(8); expect(normalized.hiddenRows).toEqual([2, 4]);
  expect(normalizeExternalVisibility({ hiddenRows: [] })).toBeUndefined();
});
it.each([[], true, { hiddenRows: [-1] }, { hiddenRows: [1048576] }, { hiddenRows: ['2'] }, { filteredRows: [2.5] }, { hiddenCols: [16384] }, { hiddenCols: {} }])('rejects malformed visibility %j', visibility => {
  expect(() => normalizeExternalWorkbooks({ version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: {}, visibility }] }] })).toThrow(/visibility/);
});
it.each(['values', 'sheet', 'target', 'refresh', 'signature', 'json', 'duplicate'])('discards a stale or malformed %s visibility extension while retaining native data', async change => {
  const result = await native(copied(fixture()), (zip, put) => {
    const path = '/xl/externalLinks/externalLink1.xml'; let xml = decode(X.CFB.find(zip, path));
    if (change === 'values') xml = xml.replace('<v>7</v>', '<v>70</v>');
    if (change === 'sheet') xml = xml.replace('val="Data"', 'val="Renamed"');
    if (change === 'refresh') xml = xml.replace('<sheetData sheetId="0"', '<sheetData refreshError="1" sheetId="0"');
    if (change === 'signature') xml = xml.replace(/signature="[a-f0-9]+"/, 'signature="invalid"');
    if (change === 'json') xml = xml.replace('{&quot;hiddenRows&quot;:[2]}', '{bad').replace('{"hiddenRows":[2]}', '{bad');
    if (change === 'duplicate') xml = xml.replace(/(<v:sheet\b[\s\S]*?<\/v:sheet>)/, '$1$1');
    put(path, xml);
    if (change === 'target') {
      const rels = '/xl/externalLinks/_rels/externalLink1.xml.rels';
      put(rels, decode(X.CFB.find(zip, rels)).replace('Original.xlsx', 'Different.xlsx'));
    }
  });
  expect(result.wb.externalWorkbooks.books[0].sheets[0].visibility).toBeUndefined();
  expect(Object.keys(result.wb.externalWorkbooks.books[0].sheets[0].cells)).toHaveLength(8);
});
it('retains unrelated extensions and removes its own snapshot when visibility clears', async () => {
  let result = await native(copied(fixture()), (zip, put) => {
    const path = '/xl/externalLinks/externalLink1.xml';
    put(path, decode(X.CFB.find(zip, path)).replace('</extLst>', '<ext uri="urn:test:other"><test xmlns="urn:test">keep</test></ext></extLst>'));
  });
  const json = result.wb.toJSON(); delete json.externalWorkbooks.books[0].sheets[0].visibility;
  result = await native(new Workbook(json));
  const xml = decode(X.CFB.find(result.zip, '/xl/externalLinks/externalLink1.xml'));
  expect(xml).not.toContain(NS); expect(xml).toContain('urn:test:other'); expect(xml).toContain('keep');
  expect(data(result.wb)[1]).toEqual([[3, 7, 5]]);
});
it('keeps native values if an application removes the optional extension', async () => {
  const result = await native(copied(fixture()), (zip, put) => {
    const path = '/xl/externalLinks/externalLink1.xml';
    put(path, decode(X.CFB.find(zip, path)).replace(/<extLst>[\s\S]*?<\/extLst>/, ''));
  });
  expect(result.wb.externalWorkbooks.books[0].sheets[0].visibility).toBeUndefined();
  expect(formulas(result.wb)).toEqual([15, 15, 15]);
});
it('includes supporting visibility in saved-result provenance for an unavailable companion link', () => {
  const f = "'[2]Missing'!A1+SUBTOTAL(109,'[1]Data'!B2:B4)";
  const base = copied(fixture()).toJSON();
  base.externalWorkbooks.books.push({ target: '/Missing.xlsx', sheets: [{ name: 'Missing', cells: null }] });
  base.sheets[0].cells['13,0'] = { f, externalResult: { formula: f, value: 48 } };
  const wb = new Workbook(base); expect(wb.getValue(wb.activeSheetId, 13, 0)).toBe(48);
  const changed = wb.toJSON(); delete changed.externalWorkbooks.books[0].sheets[0].visibility;
  const restored = new Workbook(changed);
  expect(restored.getValue(restored.activeSheetId, 13, 0)).toEqual({ error: '#REF!' });
});
it('retains visibility through a second sheet copy and destination link reindexing', async () => {
  const first = copied(fixture('filter'));
  const second = first.sheetToWorkbook(first.activeSheetId, { sourceWorkbook: '/Intermediate.xlsx' });
  const dest = new Workbook({ externalWorkbooks: { version: 1, books: [{ target: '/Other.xlsx', sheets: [{ name: 'Data', cells: { '1,1': 99 } }] }] } });
  dest.pasteCells(dest.activeSheetId, second.copyCells(second.activeSheetId, [10, 11, 12], [0]), 10, 0, { r: 10, c: 0 }, null, { externalWorkbooks: second.externalWorkbooks });
  expect([10, 11, 12].map(r => dest.getValue(dest.activeSheetId, r, 0))).toEqual([8, 8, 15]);
  dest.undo(); expect(dest.externalWorkbooks.books).toHaveLength(1);
  dest.redo(); expect(dest.externalWorkbooks.books).toHaveLength(2);
  const result = await native(second); expect(data(result.wb)).toEqual(data(first));
});
it('retains a verified visibility snapshot when source URIs are explicitly rebased on import', async () => {
  const wb = copied(fixture()); const json = wb.toJSON(); json.externalWorkbooks.books[0].target = '../Sources/Data.xlsx';
  const bytes = new Uint8Array(await (await workbookToXlsx(new Workbook(json))).arrayBuffer());
  const restored = await workbookFromFile(bytes, '', { sourceWorkbook: 'https://example.com/Reports/Report.xlsx' });
  expect(restored.externalWorkbooks.books[0].target).toBe('https://example.com/Sources/Data.xlsx');
  expect(restored.externalWorkbooks.books[0].sheets[0].visibility).toEqual({ hiddenRows: [2] });
  expect(data(restored)).toEqual(data(wb));
});
