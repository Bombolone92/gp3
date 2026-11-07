import { expect, it } from 'vitest';
import { appendNativePivotFormats as append } from '../src/core/native-pivot-format-write.js';
import { readNativePivotFormats, nativePivotFormatLayers } from '../src/core/native-pivot-formats.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const area = `<pivotArea xmlns="${MAIN}"><references count="1"><reference field="0" count="1"><x v="0"/></reference></references></pivotArea>`;
function fixture() {
  const pivot = { name: 'Summary', owner: 's', cache: 'c', ref: 'D5:E7', xml: `<p:pivotTableDefinition xmlns:p="${MAIN}" name="Summary"><p:location ref="D5:E7"/><p:extLst><p:ext uri="keep"/></p:extLst></p:pivotTableDefinition>` };
  const layout = { name: pivot.name, owner: pivot.owner, range: { r1: 4, c1: 3, r2: 6, c2: 4 }, firstDataRow: 1, firstDataCol: 1,
    fields: [{ items: [{ type: 'data', index: 0 }] }], cacheFields: [{ items: [{ type: 'string', value: 'A' }] }], measures: [{ field: 1 }],
    rows: { fields: [0], items: [{ type: 'data', members: [{ field: 0, item: 0, index: 0, type: 'string', value: 'A' }] }, { type: 'grand', members: [] }] },
    columns: { fields: [], items: [{ type: 'data', members: [] }] } };
  return { pivot, layout, native: { tables: [pivot], caches: [{ key: 'c' }], formats: { 164: '0.0' }, dxfs: [] } };
}
it('appends rules in schema order, preserves extensions and interns formats without mutating inputs', () => {
  const { native, pivot, layout } = fixture(), before = structuredClone(native);
  const edits = [{ area, style: { bold: true, fmt: 'custom', code: '0.00" units"' } }, { area, style: { bold: true, fmt: 'custom', code: '0.00" units"' } }];
  const next = append(native, pivot, layout, edits);
  expect(native).toEqual(before); expect(next.dxfs).toHaveLength(1); expect(next.formats).toEqual({ 164: '0.0', 165: '0.00" units"' });
  const root = parseModelXml(next.tables[0].xml);
  expect(Array.from(root.childNodes).filter(n => n.nodeType === 1).map(n => n.localName)).toEqual(['location', 'formats', 'extLst']);
  expect(next.tables[0].xml).toContain('uri="keep"');
  const rules = readNativePivotFormats(next.tables[0], next); expect(rules).toHaveLength(2);
  expect(nativePivotFormatLayers(layout, rules)).toHaveLength(2);
  const twice = append(next, next.tables[0], layout, [{ area, style: { italic: false, fmt: 'custom', code: '0.0' } }]);
  expect(twice.dxfs).toHaveLength(2); expect(twice.formats).toEqual(next.formats);
  expect(readNativePivotFormats(twice.tables[0], twice)).toHaveLength(3);
});
it.each([
  { area, style: { rot: 91 } },
  { area: area.replace('v="0"', 'v="9"'), style: { bold: true } },
  { area: area.replace('<pivotArea ', '<pivotArea offset="A1" '), style: { bold: true } },
  { area: '<wrong/>', style: { bold: true } },
])('rejects an invalid late edit without changing any native metadata', bad => {
  const { native, pivot, layout } = fixture(), before = structuredClone(native);
  expect(() => append(native, pivot, layout, [{ area, style: { fmt: 'custom', code: 'new' } }, bad])).toThrow();
  expect(native).toEqual(before);
});
it('checks stale layouts, empty edits and shared limits', () => {
  const { native, pivot, layout } = fixture(), edits = [{ area, style: { bold: true } }];
  expect(append(native, pivot, layout, [])).toBe(native);
  expect(() => append(native, { ...pivot }, layout, edits)).toThrow(/stale/);
  expect(() => append(native, pivot, { ...layout, owner: 'other' }, edits)).toThrow(/layout/);
  expect(() => append(native, pivot, layout, edits, { maxFormats: 0 })).toThrow(/limit/);
  expect(() => append(native, pivot, layout, edits, { maxWork: 1 })).toThrow(/work limit/);
  expect(() => append(native, pivot, layout, edits, { maxXmlLength: 1 })).toThrow(/XML size/);
  const before = structuredClone(native);
  expect(() => append(native, pivot, layout, Array(20).fill(edits[0]), { maxXmlLength: 2000 })).toThrow(/XML size/);
  expect(native).toEqual(before);
});
