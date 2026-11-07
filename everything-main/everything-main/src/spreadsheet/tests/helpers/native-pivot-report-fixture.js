import { Workbook } from '../../src/core/workbook.js';

const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** A Data sheet (Region, Amount, When) and a Report sheet with an Excel-shaped PivotTable summing Amount by Region.
 * The When field is a date field kept inline in the cache records, as Excel keeps a field nothing has filtered. */
export function pivotBook({ dateField = false } = {}) {
  const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Report' }] });
  const [data, report] = wb.sheets;
  [['Region', 'Amount', 'When'], ['East', 4, 45292], ['West', 9, 45383], ['East', 2, 45658]].forEach((row, r) => row.forEach((v, c) => wb.setInput(data.id, r, c, String(v))));
  const cache = `<pivotCacheDefinition xmlns="${M}" recordCount="3"><cacheSource type="worksheet"><worksheetSource sheet="Data" ref="A1:C4"/></cacheSource><cacheFields count="3">`
    + '<cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField>'
    + '<cacheField name="Amount"><sharedItems containsSemiMixedTypes="0" containsString="0" containsNumber="1" containsInteger="1" minValue="2" maxValue="9"/></cacheField>'
    + `<cacheField name="When"${dateField ? ' numFmtId="14"' : ''}><sharedItems containsSemiMixedTypes="0" containsNonDate="0" containsDate="1" containsString="0" minDate="2024-01-01T00:00:00" maxDate="2025-01-01T00:00:00"/></cacheField></cacheFields></pivotCacheDefinition>`;
  const records = `<pivotCacheRecords xmlns="${M}" count="3"><r><x v="0"/><n v="4"/><d v="2024-01-01T00:00:00"/></r><r><x v="1"/><n v="9"/><d v="2024-04-01T00:00:00"/></r><r><x v="0"/><n v="2"/><d v="2025-01-01T00:00:00"/></r></pivotCacheRecords>`;
  const definition = `<pivotTableDefinition xmlns="${M}" name="PivotTable1" cacheId="5" dataCaption="Values"><location ref="A3:B6" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/>`
    + '<pivotFields count="3"><pivotField axis="axisRow" showAll="0"><items count="3"><item x="0"/><item x="1"/><item t="default"/></items></pivotField><pivotField dataField="1" showAll="0"/><pivotField showAll="0"/></pivotFields>'
    + '<rowFields count="1"><field x="0"/></rowFields><rowItems count="3"><i><x/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><colItems count="1"><i/></colItems>'
    + '<dataFields count="1"><dataField name="Sum of Amount" fld="1" baseField="0" baseItem="0"/></dataFields></pivotTableDefinition>';
  wb.nativePivots = { version: 1, caches: [{ key: 'c1', scope: 'main', sourceSheetId: data.id, sourceRef: 'A1:C4', xml: cache, records }],
    tables: [{ name: 'PivotTable1', cache: 'c1', owner: report.id, ref: 'A3:B6', xml: definition }], formats: {}, dxfs: [], styles: [] };
  [['Row Labels', 'Sum of Amount'], ['East', 6], ['West', 9], ['Grand Total', 15]].forEach((row, r) => row.forEach((v, c) => wb.setInput(report.id, 2 + r, c, String(v))));
  return { wb, data, report, pivot: wb.nativePivots.tables[0] };
}
