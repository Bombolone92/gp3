import { expect, it } from 'vitest';
import { nativePivotSelectionAreas as select } from '../src/core/native-pivot-selection-areas.js';
import { nativePivotAreaRanges, readNativePivotArea } from '../src/core/native-pivot-area.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const member = (field, item) => ({ field, item, index: 1 - item, type: 'string', value: 'Same' });
const entry = (members, extra = {}) => ({ type: 'data', measure: 0, members, ...extra });
const field = () => ({ compact: false, outline: false, fillDownLabels: true, items: [{ type: 'data', index: 1 }, { type: 'data', index: 0 }] });
const cacheField = () => ({ items: [{ type: 'string', value: 'Same' }, { type: 'string', value: 'Same' }] });
function fixture() {
  return { range: { r1: 3, c1: 4, r2: 5, c2: 6 }, firstDataRow: 1, firstDataCol: 1,
    fields: [field(), field()], cacheFields: [cacheField(), cacheField()], measures: [{ field: 2 }],
    rows: { fields: [0], items: [0, 1].map(i => entry([member(0, i)])) },
    columns: { fields: [1], items: [0, 1].map(i => entry([member(1, i)])) } };
}
const parse = xml => readNativePivotArea(parseModelXml(xml));
const ranges = (l, areas) => areas.flatMap(xml => nativePivotAreaRanges(l, parse(xml)));
const points = ranges => [...new Set(ranges.flatMap(g => Array.from({ length: g.r2 - g.r1 + 1 }, (_, i) =>
  Array.from({ length: g.c2 - g.c1 + 1 }, (_, j) => `${g.r1 + i},${g.c1 + j}`)).flat()))].sort();
it.each([
  [{ r1: 4, r2: 5, c1: 5, c2: 6 }, 1],
  [{ r1: 4, r2: 5, c1: 4, c2: 4 }, 1],
  [{ r1: 4, r2: 5, c1: 4, c2: 6 }, 2],
])('groups exact data, label and mixed rectangles %j', (selection, count) => {
  const l = fixture(), before = structuredClone(l), areas = select(l, [selection]);
  expect(areas).toHaveLength(count); expect(points(ranges(l, areas))).toEqual(points([selection]));
  expect(l).toEqual(before); expect(areas.join('')).not.toContain('Same');
});
it('retains disjoint selections and interns identical rules from duplicate selections', () => {
  const l = fixture(), a = { r1: 4, r2: 4, c1: 5, c2: 5 }, b = { r1: 5, r2: 5, c1: 6, c2: 6 };
  const areas = select(l, [a, b, a]); expect(areas).toHaveLength(2);
  expect(points(ranges(l, areas))).toEqual(points([a, b]));
});
it('does not turn missing tuple combinations into selected members after refresh', () => {
  const l = fixture(); l.range = { r1: 0, c1: 0, r2: 3, c2: 2 }; l.firstDataCol = 2;
  l.rows = { fields: [0, 1], items: [[0, 0], [0, 1], [1, 0]].map(([a, b]) => entry([member(0, a), member(1, b)])) };
  l.columns = { fields: [], items: [entry([])] };
  const areas = select(l, [{ r1: 1, r2: 3, c1: 2, c2: 2 }]); expect(areas).toHaveLength(2);
  l.range.r2++; l.rows.items.push(entry([member(0, 1), member(1, 1)]));
  expect(points(ranges(l, areas))).toEqual(['1,2', '2,2', '3,2']);
});
it('accepts repeated labels only when the entire semantic selection is requested', () => {
  const l = fixture(); l.range = { r1: 0, c1: 0, r2: 2, c2: 2 }; l.firstDataCol = 2;
  l.rows = { fields: [0, 1], items: [0, 1].map(i => entry([member(0, 0), member(1, i)])) };
  l.columns = { fields: [], items: [entry([])] };
  const first = { r1: 1, r2: 1, c1: 0, c2: 0 }, second = { r1: 2, r2: 2, c1: 0, c2: 0 };
  expect(() => select(l, [first])).toThrow(/unselected cells/);
  const areas = select(l, [first, second]); expect(areas).toHaveLength(1);
  expect(points(ranges(l, areas))).toEqual(points([first, second]));
  const mixed = { r1: 1, r2: 2, c1: 0, c2: 2 };
  expect(points(ranges(l, select(l, [mixed])))).toEqual(points([mixed]));
});
it('keeps duplicate contexts together and validates disjoint repeated identities', () => {
  const l = fixture(); l.range.r2++;
  l.rows.items.push(l.rows.items[0]);
  const a = { r1: 4, r2: 4, c1: 5, c2: 5 }, b = { r1: 6, r2: 6, c1: 5, c2: 5 };
  expect(() => select(l, [a])).toThrow(/unselected cells/);
  expect(points(ranges(l, select(l, [a, b])))).toEqual(points([a, b]));
});
it.each(['rows', 'columns'])('preserves member and measure correlations on %s', which => {
  const l = fixture(); l.measures = [{ field: 2 }, { field: 3 }];
  const axis = { fields: [which === 'rows' ? 0 : 1, -2], items: [[0, 0], [0, 1], [1, 0]].map(([item, measure]) => entry([member(which === 'rows' ? 0 : 1, item)], { measure })) };
  l[which] = axis;
  if (which === 'rows') l.range.r2++; else l.range.c2++;
  const selection = { r1: 4, r2: l.range.r2, c1: 5, c2: l.range.c2 }, areas = select(l, [selection]);
  expect(areas).toHaveLength(2); expect(points(ranges(l, areas))).toEqual(points([selection]));
  axis.items.push(entry([member(which === 'rows' ? 0 : 1, 1)], { measure: 1 }));
  if (which === 'rows') l.range.r2++; else l.range.c2++;
  expect(points(ranges(l, areas))).toEqual(points([selection]));
});
it('keeps subtotal functions distinct from ordinary member contexts', () => {
  const l = fixture(); l.range.r2++;
  l.rows.items.push(entry([member(0, 0)], { type: 'sum', subtotalField: 0 }));
  const selection = { r1: 4, r2: 6, c1: 5, c2: 6 }, areas = select(l, [selection]);
  expect(areas).toHaveLength(2); expect(points(ranges(l, areas))).toEqual(points([selection]));
  expect(areas.map(parse).some(a => a.references.some(r => r.subtotals.includes('sumSubtotal')))).toBe(true);
});
it('retains identity when field items differ from cache order and report rows move', () => {
  const l = fixture(), areas = select(l, [{ r1: 4, r2: 4, c1: 5, c2: 6 }]);
  expect(parse(areas[0]).references[0].items).toEqual([0]);
  l.rows.items.reverse(); expect(points(ranges(l, areas))).toEqual(['5,5', '5,6']);
  l.rows.items = l.rows.items.slice(0, 1); expect(ranges(l, areas)).toEqual([]);
});
it.each(['header', 'blank', 'grand', 'padding', 'unresolved', 'missingLabel', 'bounds', 'fraction'])('rejects unsupported or incomplete %s selections atomically', problem => {
  const l = fixture(), g = { r1: 4, r2: 5, c1: 5, c2: 6 };
  if (problem === 'header') l.rows.items[0] = { ...l.rows.items[0], header: true, aggregate: false };
  if (problem === 'blank' || problem === 'grand') l.rows.items[1] = entry([], { type: problem });
  if (problem === 'padding') { l.range.r2++; g.r2++; }
  if (problem === 'unresolved') l.rows.items[1].members[0].item = 99;
  if (problem === 'missingLabel') { l.rows.items[1] = l.rows.items[0]; l.fields[0].fillDownLabels = false; g.c1 = g.c2 = 4; }
  if (problem === 'bounds') g.r1 = 3;
  if (problem === 'fraction') g.r2 = 4.5;
  const before = structuredClone(l); expect(() => select(l, [g])).toThrow(); expect(l).toEqual(before);
});
it('bounds grouping, XML, output areas and coverage work without mutating inputs', () => {
  const l = fixture(), g = { r1: 4, r2: 5, c1: 5, c2: 6 }, before = structuredClone(l);
  expect(select(l, [], { maxAreas: 0, maxWork: 0 })).toEqual([]);
  expect(() => select(l, [g], { maxAreas: 0 })).toThrow(/area limit/);
  expect(() => select(l, [g], { maxWork: 1 })).toThrow(/work limit/);
  expect(() => select(l, [g], { maxXmlLength: 1 })).toThrow(/XML size/);
  expect(() => select(l, [g], { workBudget: { remaining: 1 } })).toThrow(/work limit/);
  expect(l).toEqual(before);
});
it('compresses a ten-million-cell rectangle with axis-linear work and one native area', () => {
  const sizes = [10000, 1000], l = { range: { r1: 0, c1: 0, r2: sizes[0], c2: sizes[1] }, firstDataRow: 1, firstDataCol: 1,
    fields: sizes.map(n => ({ items: Array.from({ length: n }, (_, index) => ({ type: 'data', index })) })),
    cacheFields: sizes.map(n => ({ items: Array.from({ length: n }, () => ({ type: 'string', value: 'Same' })) })), measures: [{ field: 2 }] };
  [l.rows, l.columns] = sizes.map((n, field) => ({ fields: [field], items: Array.from({ length: n }, (_, item) => entry([{ field, item, index: item, type: 'string', value: 'Same' }])) }));
  const g = { r1: 1, r2: sizes[0], c1: 1, c2: sizes[1] }, areas = select(l, [g], { maxWork: 200000, maxAreas: 1 });
  expect(areas).toHaveLength(1); expect(ranges(l, areas)).toEqual([g]);
});
