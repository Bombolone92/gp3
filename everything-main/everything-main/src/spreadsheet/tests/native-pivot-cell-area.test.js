import { expect, it } from 'vitest';
import { nativePivotCellArea as select } from '../src/core/native-pivot-cell-area.js';
import { readNativePivotArea, nativePivotAreaRanges, PIVOT_DATA_FIELD } from '../src/core/native-pivot-area.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';
const member = (field, item) => ({ field, item, index: 1 - item, type: 'string', value: 'Same caption' });
const entry = (members, extra = {}) => ({ type: 'data', measure: 0, members, ...extra });
function fixture(compact = true) {
  const a = member(0, 0), b = member(0, 1), x = member(1, 1), y = member(1, 0);
  return { range: { r1: 3, c1: 2, r2: 11, c2: compact ? 7 : 8 }, firstDataRow: 1, firstDataCol: compact ? 1 : 2,
    fields: [0, 1, 2].map(() => ({ compact, items: [{ type: 'data', index: 1 }, { type: 'data', index: 0 }] })),
    cacheFields: [0, 1, 2].map(() => ({ items: [{ type: 'string', value: 'Same caption' }, { type: 'string', value: 'Same caption' }] })),
    measures: [{ field: 3 }, { field: 4 }],
    rows: { fields: [0, 1], items: [entry([a], { header: true, aggregate: false }), entry([a, x]), entry([a, y]),
      entry([a], { type: 'sum', subtotalField: 0 }), entry([], { type: 'blank' }),
      entry([b], { header: true, aggregate: false }), entry([b, x]), entry([], { type: 'grand' })] },
    columns: { fields: [2, -2], items: [0, 1].flatMap(item => [1, 0].map(measure => entry([member(2, item)], { measure }))).concat(entry([], { type: 'grand', measure: 1 })) } };
}
const parse = xml => readNativePivotArea(parseModelXml(xml));
const ranges = (l, xml) => nativePivotAreaRanges(l, parse(xml));
const point = (r, c) => [{ r1: r, r2: r, c1: c, c2: c }];
it('selects data by ancestor/member/column/measure identities, independent of duplicate captions', () => {
  const l = fixture(), xml = select(l, 5, 3), a = parse(xml);
  expect(a.references.map(ref => [ref.field, ref.items])).toEqual([[0, [0]], [1, [1]], [2, [0]], [PIVOT_DATA_FIELD, [1]]]);
  expect(xml).not.toContain('Same caption'); expect(a.offset).toBeNull(); expect(a.cacheIndex).toBe(false);
  expect(ranges(l, xml)).toEqual(point(5, 3));
  [l.rows.items[1], l.rows.items[6]] = [l.rows.items[6], l.rows.items[1]];
  [l.columns.items[0], l.columns.items[3]] = [l.columns.items[3], l.columns.items[0]];
  expect(ranges(l, xml)).toEqual(point(10, 6));
});
it.each([true, false])('selects actual row-label ownership and parent context (compact=%s)', compact => {
  const l = fixture(compact), childColumn = compact ? 2 : 3;
  const parent = select(l, 4, 2), child = select(l, 5, childColumn);
  expect(parse(parent)).toMatchObject({ dataOnly: false, labelOnly: true, axis: 'axisRow', fieldPosition: 0 });
  expect(parse(child).fieldPosition).toBe(1);
  expect(parse(parent).references.map(ref => ref.field)).toEqual([0]);
  expect(parse(child).references.map(ref => ref.field)).toEqual([0, 1]);
  expect(ranges(l, parent)).toEqual(point(4, 2)); expect(ranges(l, child)).toEqual(point(5, childColumn));
});
it('selects field positions in axis order rather than cache order or worksheet column', () => {
  const l = fixture(); l.rows.fields = [1, 0];
  for (const row of l.rows.items) { row.members = row.members.map(m => ({ ...m, field: 1 - m.field })); if (row.subtotalField != null) row.subtotalField = 1 - row.subtotalField; }
  const a = parse(select(l, 4, 2)); expect(a.fieldPosition).toBe(0); expect(a.references[0].field).toBe(1);
});
it.each(['default', 'sum', 'countA', 'avg', 'max', 'min', 'product', 'count', 'stdDev', 'stdDevP', 'var', 'varP'])('encodes the %s subtotal separately from member values and other aggregate functions', type => {
  const l = fixture(); l.rows.items[3].type = type;
  for (const c of [2, 3]) {
    const xml = select(l, 7, c);
    expect(parse(xml).references[0].subtotals).toEqual([`${type}Subtotal`]);
    expect(ranges(l, xml)).toEqual(point(7, c));
  }
});
it('selects top aggregate labels and values using the default-subtotal function', () => {
  const l = fixture(); l.rows.items[0].aggregate = true;
  for (const c of [2, 3]) {
    const xml = select(l, 4, c); expect(parse(xml).references[0].subtotals).toEqual(['defaultSubtotal']);
    expect(ranges(l, xml)).toEqual(point(4, c));
  }
});
it('addresses measures on rows and rejects labels whose geometry is not implemented', () => {
  const l = fixture();
  l.rows = { fields: [0, -2], items: [1, 0].map(measure => entry([member(0, 0)], { measure })) };
  l.columns = { fields: [2], items: [entry([member(2, 1)])] };
  const xml = select(l, 4, 3);
  expect(parse(xml).references.at(-1)).toMatchObject({ field: PIVOT_DATA_FIELD, items: [1] });
  expect(ranges(l, xml)).toEqual(point(4, 3));
  expect(() => select(l, 4, 2)).toThrow(/measure-on-rows/);
});
it('keeps a generated rule dormant across filtering and restores it by identity', () => {
  const l = fixture(), xml = select(l, 5, 3), saved = l.rows.items;
  l.rows.items = saved.slice(5); expect(ranges(l, xml)).toEqual([]);
  l.rows.items = saved; expect(ranges(l, xml)).toEqual(point(5, 3));
});
it.each([[3, 2], [4, 3], [8, 2], [8, 3], [11, 2], [11, 3], [5, 7], [12, 3], [5.5, 3], [5, -1]])('rejects unsupported, structural or out-of-range cell (%s,%s)', (r, c) => {
  expect(() => select(fixture(), r, c)).toThrow();
});
it('rejects duplicate value contexts and repeated labels instead of widening a one-cell edit', () => {
  const l = fixture(); l.rows.items[2] = l.rows.items[1];
  expect(() => select(l, 5, 3)).toThrow(/exactly this cell/);
  const tabular = fixture(false); tabular.fields[0].fillDownLabels = true;
  expect(() => select(tabular, 4, 2)).toThrow(/exactly this cell/);
  expect(() => select(fixture(false), 6, 2)).toThrow(/not an emitted/);
});
it.each(['member', 'measure', 'owner'])('rejects unresolved %s identities', problem => {
  const l = fixture();
  if (problem === 'member') l.rows.items[1].members[1] = { ...l.rows.items[1].members[1], item: 99 };
  if (problem === 'measure') l.columns.items[0].measure = 99;
  if (problem === 'owner') l.rows.items[1] = { ...l.rows.items[1], type: 'sum', subtotalField: 9 };
  expect(() => select(l, 5, 3)).toThrow(/identity|measure index/);
});
it('bounds label placement and all resolution work, including shared budgets', () => {
  const l = fixture(), before = structuredClone(l);
  expect(() => select(l, 5, 3, { maxWork: 0 })).toThrow(/work limit/);
  expect(() => select(l, 5, 2, { maxWork: 1 })).toThrow(/work limit/);
  expect(() => select(l, 5, 3, { maxWork: -1 })).toThrow(/limits/);
  expect(() => select(l, 5, 3, { workBudget: { remaining: 1 } })).toThrow(/work limit/);
  expect(l).toEqual(before);
});

it('does not turn a collapsed aggregate into an ordinary descendant-data rule', () => {
  const l = fixture(); l.rows.items = [entry([member(0, 0)])]; l.fields[0].items[0].details = false;
  expect(() => select(l, 4, 3)).toThrow(/collapsed data/);
  expect(ranges(l, select(l, 4, 2))).toEqual(point(4, 2));
});
it('resolves one cell in a ten-million-cell body using axis-linear work', () => {
  const rowCount = 10000, colCount = 1000;
  const l = { range: { r1: 0, c1: 0, r2: rowCount, c2: colCount }, firstDataRow: 1, firstDataCol: 1,
    fields: [rowCount, colCount].map(n => ({ items: Array.from({ length: n }, (_, index) => ({ type: 'data', index })) })),
    cacheFields: [rowCount, colCount].map(n => ({ items: Array.from({ length: n }, () => ({ type: 'string', value: 'Same' })) })),
    measures: [{ field: 2 }] };
  [l.rows, l.columns] = [rowCount, colCount].map((n, field) => ({ fields: [field], items: Array.from({ length: n }, (_, item) =>
    entry([{ field, item, index: item, type: 'string', value: 'Same' }])) }));
  const xml = select(l, 5001, 701, { maxWork: 60000 });
  expect(ranges(l, xml)).toEqual(point(5001, 701));
  expect(() => select(l, 5001, 701, { maxWork: 20000 })).toThrow(/work limit/);
});
