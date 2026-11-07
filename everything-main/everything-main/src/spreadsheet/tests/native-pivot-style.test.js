import { expect, it } from 'vitest';
import { readNativePivotStyle, nativePivotStyleLayers, nativePivotBodyStyleLayers } from '../src/core/native-pivot-style.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const xml = (name, content = '', attrs = '') => `<${name} xmlns="${MAIN}" ${attrs}>${content}</${name}>`;
function fixture(parts = ['headerRow', 'wholeTable']) {
  return {
    pivot: { xml: xml('pivotTableDefinition', '<pivotTableStyleInfo name="Custom" showRowHeaders="1" showColHeaders="1" showLastColumn="1"/>') },
    native: { styles: [{ name: 'Custom', xml: xml('tableStyle', parts.map((type, i) => `<tableStyleElement type="${type}" dxfId="${i}"/>`).join(''), `name="Custom" count="${parts.length}"`) }],
      dxfs: parts.map((_type, i) => xml('dxf', `<font><b val="${i % 2}"/><i val="0"/><color theme="4" tint="0.2"/></font><border><horizontal/></border>`)) },
  };
}
function layout() {
  return { range: { r1: 7, c1: 2, r2: 11, c2: 5 }, firstDataRow: 1, firstDataCol: 2,
    rows: { items: ['data', 'data', 'blank', 'grand'].map(type => ({ type })) },
    columns: { items: ['data', 'grand'].map(type => ({ type })) } };
}
it('resolves native custom-style references without losing differential properties or theme identity', () => {
  const f = fixture(), before = structuredClone(f), style = readNativePivotStyle(f.pivot, f.native);
  expect(style).toMatchObject({ name: 'Custom', options: { showRowHeaders: true, showColHeaders: true, showRowStripes: false, showColStripes: false, showLastColumn: true } });
  expect(style.elements.map(p => p.dxf)).toEqual(f.native.dxfs);
  expect(f).toEqual(before);
});
it('applies specification precedence independently of XML and region order', () => {
  const f = fixture(['totalRow', 'headerRow', 'wholeTable', 'firstColumn', 'firstHeaderCell', 'lastColumn']);
  const style = readNativePivotStyle(f.pivot, f.native), range = layout().range;
  const layers = nativePivotStyleLayers(style, style.elements.map(part => ({ type: part.type, range })));
  expect(layers.map(l => l.type)).toEqual(['wholeTable', 'firstColumn', 'headerRow', 'firstHeaderCell', 'lastColumn', 'totalRow']);
  expect(layers[0].dxf).toBe(f.native.dxfs[2]);
});
it('retains band sizes and recognizes all subtotal/subheading levels for semantic selectors', () => {
  const f = fixture(['firstRowStripe', 'thirdSubtotalRow', 'secondColumnSubheading']);
  f.native.styles[0].xml = f.native.styles[0].xml.replace('type="firstRowStripe"', 'type="firstRowStripe" size="3"');
  const style = readNativePivotStyle(f.pivot, f.native);
  expect(style.elements[0].size).toBe(3);
  expect(nativePivotStyleLayers(style, [{ type: 'thirdSubtotalRow', range: layout().range }])[0].dxf).toBe(f.native.dxfs[1]);
});
it('builds report-wide header/label, separator and grand-total regions at the actual origin', () => {
  const f = fixture(['wholeTable', 'firstColumn', 'headerRow', 'firstHeaderCell', 'blankRow', 'lastColumn', 'totalRow']);
  const layers = nativePivotBodyStyleLayers(layout(), readNativePivotStyle(f.pivot, f.native));
  expect(layers.map(({ type, range }) => [type, range])).toEqual([
    ['wholeTable', { r1: 7, c1: 2, r2: 11, c2: 5 }], ['firstColumn', { r1: 7, c1: 2, r2: 11, c2: 3 }],
    ['headerRow', { r1: 7, c1: 2, r2: 7, c2: 5 }], ['firstHeaderCell', { r1: 7, c1: 2, r2: 7, c2: 3 }],
    ['blankRow', { r1: 10, c1: 2, r2: 10, c2: 5 }], ['lastColumn', { r1: 7, c1: 5, r2: 11, c2: 5 }],
    ['totalRow', { r1: 11, c1: 2, r2: 11, c2: 5 }],
  ]);
});
it('honors header and last-column style flags without disabling whole-table or total-row formatting', () => {
  const f = fixture(['wholeTable', 'headerRow', 'firstColumn', 'firstHeaderCell', 'lastColumn', 'totalRow']);
  f.pivot.xml = f.pivot.xml.replaceAll('="1"', '="0"');
  expect(nativePivotBodyStyleLayers(layout(), readNativePivotStyle(f.pivot, f.native)).map(p => p.type)).toEqual(['wholeTable', 'totalRow']);
});
it('ignores ordinary-table corner elements for pivots, as specified by MS-XLSB TSEType', () => {
  const f = fixture(['lastHeaderCell', 'firstTotalCell', 'lastTotalCell']), style = readNativePivotStyle(f.pivot, f.native);
  expect(nativePivotStyleLayers(style, style.elements.map(e => ({ type: e.type, range: layout().range })))).toEqual([]);
  expect(nativePivotBodyStyleLayers(layout(), style)).toEqual([]);
});
it('distinguishes absent styles and no-format elements from unresolved named styles', () => {
  const f = fixture(); expect(readNativePivotStyle({ xml: xml('pivotTableDefinition') }, f.native)).toBeNull();
  f.native.styles[0].xml = f.native.styles[0].xml.replaceAll(/ dxfId="\d+"/g, '');
  expect(nativePivotBodyStyleLayers(layout(), readNativePivotStyle(f.pivot, f.native))).toEqual([]);
  f.native.styles = []; expect(() => readNativePivotStyle(f.pivot, f.native)).toThrow(/not implemented/);
});
it.each([
  ['duplicate elements', f => { f.native.styles[0].xml = f.native.styles[0].xml.replace('type="wholeTable"', 'type="headerRow"'); }],
  ['missing dxf', f => { f.native.dxfs = []; }],
  ['wrong dxf root', f => { f.native.dxfs[0] = xml('font'); }],
  ['invalid count', f => { f.native.styles[0].xml = f.native.styles[0].xml.replace('count="2"', 'count="3"'); }],
  ['invalid flag', f => { f.pivot.xml = f.pivot.xml.replace('showRowHeaders="1"', 'showRowHeaders="yes"'); }],
  ['table-only definition', f => { f.native.styles[0].xml = f.native.styles[0].xml.replace('name="Custom"', 'name="Custom" pivot="0"'); }],
])('rejects malformed %s', (_name, change) => {
  const f = fixture(); change(f); expect(() => readNativePivotStyle(f.pivot, f.native)).toThrow(/Invalid native pivot style/);
});
it('bounds region plans and refuses unsupported active geometry rather than dropping formatting', () => {
  const f = fixture(['firstRowStripe']), style = readNativePivotStyle(f.pivot, f.native);
  expect(nativePivotBodyStyleLayers(layout(), style)).toEqual([]); // disabled stripes
  style.options.showRowStripes = true; expect(() => nativePivotBodyStyleLayers(layout(), style)).toThrow(/region layout/);
  expect(() => nativePivotStyleLayers(style, [{ type: 'firstRowStripe', range: layout().range }], { maxRegions: 0 })).toThrow(/limit/);
  expect(() => nativePivotStyleLayers(style, [{ type: 'firstRowStripe', range: { ...layout().range, r2: 1048576 } }])).toThrow(/bounds/);
});

it('does not scan report rows for unrelated style elements and stops at the region budget', () => {
  const f = fixture(), report = layout(), style = readNativePivotStyle(f.pivot, f.native);
  report.rows.items = new Proxy(report.rows.items, { get(target, key) { if (key === 'entries') throw new Error('Unexpected row scan'); return Reflect.get(target, key); } });
  expect(nativePivotBodyStyleLayers(report, style)).toHaveLength(2);
  expect(() => nativePivotBodyStyleLayers(layout(), style, { maxRegions: 1 })).toThrow(/limit/);
});
