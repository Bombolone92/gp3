import { Workbook } from '../../src/core/workbook.js';
export const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const xml = (name, body = '', attrs = '') => `<${name} xmlns="${MAIN}" ${attrs}>${body}</${name}>`;

/** A persisted ordinary cache/report with saved axes, not a refresh fixture. */
export function pivotDisplayBook({ ref = 'C4:D7', r = 3, c = 2, name = 'Summary', styleName = 'Custom', parts = ['headerRow', 'totalRow'],
  dxfs = [xml('dxf', '<font><b/><color rgb="FF123456"/></font><fill><patternFill patternType="solid"><bgColor rgb="FFAACCEE"/></patternFill></fill><border><bottom style="medium"><color rgb="FF345678"/></bottom></border>'),
    xml('dxf', '<font><b/></font><border><top style="double"><color rgb="FF987654"/></top></border>')], normalFont = { name: 'Calibri', sz: 12 },
} = {}) {
  const cells = { [`${r},${c}`]: { v: 'Region' }, [`${r},${c + 1}`]: { v: 'Sales' },
    [`${r + 1},${c}`]: { v: 'East' }, [`${r + 1},${c + 1}`]: { v: 5 },
    [`${r + 2},${c}`]: { v: 'West' }, [`${r + 2},${c + 1}`]: { v: 8 },
    [`${r + 3},${c}`]: { v: 'Grand Total' }, [`${r + 3},${c + 1}`]: { v: 13 } };
  const wb = new Workbook({ normalFont, sheets: [{ id: 'report', name: 'Report', cells }, { id: 'other', name: 'Other' }] });
  const cache = { key: 'cache', xml: xml('pivotCacheDefinition', '<cacheSource type="worksheet"><worksheetSource sheet="Other" ref="A1:B3"/></cacheSource><cacheFields count="2"><cacheField name="Region"><sharedItems count="2"><s v="East"/><s v="West"/></sharedItems></cacheField><cacheField name="Sales"/></cacheFields>') };
  const pivot = { owner: 'report', cache: cache.key, ref, name,
    xml: xml('pivotTableDefinition', `<location ref="${ref}" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow"><items count="2"><item x="0"/><item x="1"/></items></pivotField><pivotField dataField="1"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><rowItems count="3"><i><x v="0"/></i><i><x v="1"/></i><i t="grand"><x/></i></rowItems><dataFields count="1"><dataField fld="1" name="Sales"/></dataFields><pivotTableStyleInfo name="${styleName}" showRowHeaders="1" showColHeaders="1"/>`, `name="${name}" dataCaption="Values"`) };
  wb.nativePivots = { version: 1, caches: [cache], tables: [pivot], dxfs, formats: {}, styles: styleName === 'Custom' ? [{ name: styleName,
    xml: xml('tableStyle', parts.map((type, i) => `<tableStyleElement type="${type}" dxfId="${i}"/>`).join(''), `name="${styleName}" pivot="1" count="${parts.length}"`) }] : [] };
  return { wb, id: 'report', r, c, pivot, cache };
}
