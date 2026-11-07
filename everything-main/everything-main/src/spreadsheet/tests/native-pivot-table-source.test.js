import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renameNativePivotTableSource } from '../src/core/native-pivots.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import { decodeXlsxString, encodeXlsxAttribute } from '../src/core/xlsx-string.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const source = cache => parseModelXml(cache.xml).getElementsByTagNameNS(MAIN, 'worksheetSource')[0];
const sourceName = cache => decodeXlsxString(source(cache).getAttribute('name'));
function fixture(name = 'Orders') {
  const wb = new Workbook({ sheets: [{ name: 'Input', cells: { '0,0': { v: 'Amount' }, '1,0': { v: 7 } } }, { name: 'Report' }] });
  const id = wb.addTable(wb.sheets[0].id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name });
  wb.nativePivots = { version: 1, caches: [{ key: 'source', scope: 'main', sourceSheetId: null, sourceRef: '',
    xml: `<pivotCacheDefinition xmlns="${MAIN}" recordCount="1"><cacheSource type="worksheet"><worksheetSource name="${encodeXlsxAttribute(name)}"/></cacheSource><cacheFields count="1"><cacheField name="Amount"/></cacheFields></pivotCacheDefinition>`,
    records: `<pivotCacheRecords xmlns="${MAIN}" count="1"><r><n v="7"/></r></pivotCacheRecords>` }],
    tables: [{ name: 'Summary', cache: 'source', owner: wb.sheets[1].id, ref: 'A1:A2', xml: `<pivotTableDefinition xmlns="${MAIN}" name="Summary" cacheId="0"><location ref="A1:A2" firstHeaderRow="0" firstDataRow="1" firstDataCol="0"/><pivotFields count="1"><pivotField dataField="1"/></pivotFields><dataFields count="1"><dataField fld="0" name="Total"/></dataFields></pivotTableDefinition>` }],
    dxfs: [], styles: [], formats: {}, connections: '' };
  return { wb, id };
}
it.each(['Expenses', 'ORDERS', 'Cost_x0041_'])('renames native table sources atomically and preserves them in native-only exports: %s', async name => {
  let { wb, id } = fixture();
  const before = wb.toJSON(), previous = wb.nativePivots;
  expect(wb.updateTable(wb.sheets[0].id, id, { name })).toBe(true);
  expect(sourceName(wb.nativePivots.caches[0])).toBe(name);
  expect(sourceName(previous.caches[0])).toBe('Orders');
  expect(wb.nativePivots.caches[0].records).toBe(previous.caches[0].records);
  expect(wb.nativePivots.tables).toBe(previous.tables);
  const after = wb.toJSON(); wb.undo(); expect(wb.toJSON()).toEqual(before); wb.redo(); expect(wb.toJSON()).toEqual(after);
  for (let i = 0; i < 2; i++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(sourceName(wb.nativePivots.caches[0])).toBe(name);
    expect(wb.tableByName(name)).toBeTruthy();
  }
});
it('does not rename external sources, unrelated names, or A1 sources', () => {
  const { wb } = fixture(), base = wb.nativePivots.caches[0];
  const caches = [base, { ...base, key: 'external', xml: base.xml.replace('name="Orders"', `name="Orders" xmlns:r="${REL}" r:id="externalSource"`) },
    { ...base, key: 'other', xml: base.xml.replace('name="Orders"', 'name="Other"') },
    { ...base, key: 'range', xml: base.xml.replace('name="Orders"', 'sheet="Input" ref="A1:A2"') }];
  const pivots = { ...wb.nativePivots, caches }, next = renameNativePivotTableSource(pivots, 'orders', 'NewOrders');
  expect(sourceName(next.caches[0])).toBe('NewOrders');
  for (let i = 1; i < caches.length; i++) expect(next.caches[i]).toBe(caches[i]);
  expect(renameNativePivotTableSource(pivots, 'Missing', 'Other')).toBe(pivots);
});
it('preserves defined-name bindings including sheet-local legacy collisions', () => {
  for (const scope of [null, 'Report']) {
    const { wb, id } = fixture();
    wb.names = [{ name: 'Orders', ref: 'Input!$A$1:$A$2', ...(scope ? { sheet: scope } : {}) }];
    if (scope) wb.nativePivots.caches[0].xml = wb.nativePivots.caches[0].xml.replace('<worksheetSource ', '<worksheetSource sheet="Report" ');
    const previous = wb.nativePivots;
    wb.updateTable(wb.sheets[0].id, id, { name: 'NewOrders' });
    expect(wb.nativePivots).toBe(previous);
    expect(sourceName(wb.nativePivots.caches[0])).toBe('Orders');
  }
});
it('matches decoded Unicode source names without recursively decoding literal escapes', () => {
  const { wb } = fixture('Régions_x0041_');
  const next = renameNativePivotTableSource(wb.nativePivots, 'RE\u0301GIONS_x0041_', 'Renamed_x0042_');
  expect(sourceName(next.caches[0])).toBe('Renamed_x0042_');
});
it('does not rename an external table source before its package relationship is allocated', () => {
  const { wb, id } = fixture();
  wb.nativePivots.caches[0].sourceWorkbook = 'file:///Original.xlsx';
  const previous = wb.nativePivots;
  wb.updateTable(wb.sheets[0].id, id, { name: 'NewOrders' });
  expect(wb.nativePivots).toBe(previous); expect(sourceName(wb.nativePivots.caches[0])).toBe('Orders');
});
