import { expect, it } from 'vitest';
import { writeNativePivotAxes } from '../src/core/native-pivot-axis-xml.js';
import { readNativePivotLayout } from '../src/core/native-pivot-layout.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
function fixture() {
  const cache = { xml: `<pivotCacheDefinition xmlns="${M}"><cacheFields count="2"><cacheField name="Outer"><sharedItems count="2"><s v="A"/><s v="B"/></sharedItems></cacheField><cacheField name="Inner"><sharedItems count="2"><s v="C"/><s v="D"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>` };
  const pivot = { name: 'Report', owner: 'sheet', cache: 'cache', ref: 'D8:F99', xml: `<p:pivotTableDefinition xmlns:p="${M}" name="Report" cacheId="7" dataCaption="Values"><p:location ref="A1:C92" firstHeaderRow="0" firstDataRow="1" firstDataCol="1"/><p:pivotFields count="2"><p:pivotField><p:items count="2"><p:item x="1"/><p:item x="0"/></p:items></p:pivotField><p:pivotField><p:items count="2"><p:item x="0"/><p:item x="1"/></p:items></p:pivotField></p:pivotFields><p:rowFields count="2"><p:field x="0"/><p:field x="1"/></p:rowFields><p:colFields count="1"><p:field x="-2"/></p:colFields><p:dataFields count="2"><p:dataField fld="0"/><p:dataField fld="1"/></p:dataFields><p:extLst><p:ext uri="urn:test"><foreign xmlns="urn:preserved" data="keep"/></p:ext></p:extLst></p:pivotTableDefinition>` };
  const a = { field: 0, item: 1, index: 0, type: 'string', value: 'A' }, b = { field: 1, item: 0, index: 0, type: 'string', value: 'C' }, c = { field: 1, item: 1, index: 1, type: 'string', value: 'D' };
  const item = (members, type = 'data', measure = 0) => ({ members, type, measure });
  const layout = { rows: { fields: [0, 1], items: [item([a]), item([a, b]), item([a, c]), item([], 'blank'), item([], 'grand')] },
    columns: { fields: [-2], items: [item([], 'data', 0), item([], 'data', 1)] } };
  return { cache, pivot, layout };
}
const children = xml => [...parseModelXml(xml).childNodes].filter(n => n.nodeType === 1).map(n => n.localName);
it('writes field-item identities, compressed prefixes and measures in native child order', () => {
  const f = fixture(), before = structuredClone(f), result = writeNativePivotAxes(f.pivot, f.layout);
  expect(result.ref).toBe('D8:F13');
  expect(result.xml).toContain('<p:i r="1"><p:x/></p:i>');
  expect(result.xml).toContain('<p:i i="1"><p:x v="1"/></p:i>');
  expect(result.xml).toContain('xmlns="urn:preserved" data="keep"');
  expect(children(result.xml)).toEqual(['location', 'pivotFields', 'rowFields', 'rowItems', 'colFields', 'colItems', 'dataFields', 'extLst']);
  const decoded = readNativePivotLayout(result, f.cache);
  expect(decoded.rows).toEqual(f.layout.rows); expect(decoded.columns).toEqual(f.layout.columns);
  expect(decoded.range).toMatchObject({ r1: 7, c1: 3, r2: 12, c2: 5 });
  expect(f).toEqual(before);
});
it('rewrites existing axis lists without duplicate nodes and uses the current moved report origin', () => {
  const f = fixture(), first = writeNativePivotAxes(f.pivot, f.layout);
  const next = { ...f.layout, rows: { ...f.layout.rows, items: f.layout.rows.items.slice(0, 1) } };
  const changed = writeNativePivotAxes({ ...first, ref: 'J20:L25' }, next);
  expect(changed.ref).toBe('J20:L21'); expect(children(changed.xml).filter(n => n === 'rowItems')).toHaveLength(1);
  expect(readNativePivotLayout(changed, f.cache).rows).toEqual(next.rows);
});
it('preserves subtotal group identities and serializes their native aggregation kinds', () => {
  const f = fixture();
  f.layout.rows.items[1] = { ...f.layout.rows.items[0], type: 'avg', subtotalField: 0 };
  const decoded = readNativePivotLayout(writeNativePivotAxes(f.pivot, f.layout), f.cache);
  expect(decoded.rows.items[1]).toEqual({ ...f.layout.rows.items[0], type: 'avg' });
});
it('writes a fieldless axis dummy item and removes an empty dimensioned axis list', () => {
  const f = fixture(); f.pivot.xml = f.pivot.xml.replace('<p:colFields count="1"><p:field x="-2"/></p:colFields>', '');
  f.layout.columns = { fields: [], items: [{ type: 'data', measure: 0, members: [] }] };
  f.layout.rows.items = [];
  const result = writeNativePivotAxes(f.pivot, f.layout), decoded = readNativePivotLayout(result, f.cache);
  expect(result.xml).not.toContain('rowItems'); expect(decoded.rows.items).toEqual([]);
  expect(decoded.columns).toEqual(f.layout.columns);
});
it.each([
  f => { f.layout.rows.fields.reverse(); },
  f => { f.layout.rows.items[0].members[0].index = 1; },
  f => { f.layout.rows.items[0].members[0].item = 99; },
  f => { f.layout.rows.items[0].members[0].field = 1; },
  f => { f.layout.rows.items[0].type = 'invented'; },
  f => { f.layout.rows.items[0].measure = 1; },
  f => { f.layout.columns.items[0].measure = 2; },
  f => { f.layout.rows.items[3].members = f.layout.rows.items[0].members; },
  f => { f.pivot.ref = 'XFD1048576'; },
  f => { f.pivot.xml = f.pivot.xml.replace('firstDataRow="1"', 'firstDataRow="-1"'); },
])('rejects an inconsistent axis plan before returning changed native state (%#)', change => {
  const f = fixture(); change(f);
  expect(() => writeNativePivotAxes(f.pivot, f.layout)).toThrow(/Invalid rebuilt pivot axis/);
});
it('enforces output budgets independently of field-prefix compression', () => {
  const f = fixture(); expect(() => writeNativePivotAxes(f.pivot, f.layout, { maxItems: 4 })).toThrow(/limit/);
});
