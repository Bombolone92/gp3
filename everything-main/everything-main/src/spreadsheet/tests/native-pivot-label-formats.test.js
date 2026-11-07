import { expect, it } from 'vitest';
import { readNativePivotArea, nativePivotAreaRanges } from '../src/core/native-pivot-area.js';
import { nativePivotFormatLayers } from '../src/core/native-pivot-formats.js';
import { parseModelXml } from '../src/core/data-model-metadata.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const ref = (field, items = [], attrs = '') => `<reference field="${field}" ${attrs}>${items.map(i => `<x v="${i}"/>`).join('')}</reference>`;
const area = (refs = ref(0), attrs = 'labelOnly="1"') => readNativePivotArea(parseModelXml(`<pivotArea xmlns="${MAIN}" dataOnly="0" ${attrs}><references>${refs}</references></pivotArea>`));
const m = (field, item) => ({ field, item, index: 1 - item, type: 'string', value: 'Same' });
function layout({ compact = true, outline = true, repeat = false } = {}) {
  const a = m(0, 0), b = m(0, 1), x = m(1, 0), y = m(1, 1);
  return { range: { r1: 10, c1: 5, r2: 18, c2: 8 }, firstDataRow: 1, firstDataCol: 2,
    fields: [0, 1].map(() => ({ compact, outline, fillDownLabels: repeat, items: [{ type: 'data', index: 1 }, { type: 'data', index: 0 }] })),
    cacheFields: [0, 1].map(() => ({ items: [{ type: 'string', value: 'Same' }, { type: 'string', value: 'Same' }] })),
    measures: [{ field: 2 }], columns: { fields: [], items: [{ type: 'data', members: [] }] },
    rows: { fields: [0, 1], items: outline ? [
      { type: 'data', members: [a], header: true, aggregate: false },
      { type: 'data', members: [a, x] }, { type: 'data', members: [a, y] },
      { type: 'sum', members: [a], subtotalField: 0 }, { type: 'blank', members: [] },
      { type: 'data', members: [b], header: true, aggregate: false },
      { type: 'data', members: [b, x] }, { type: 'grand', members: [] },
    ] : [{ type: 'data', members: [a, x] }, { type: 'data', members: [a, y] }, { type: 'data', members: [b, x] }, { type: 'grand', members: [] }] } };
}
const points = ranges => ranges.flatMap(g => Array.from({ length: g.r2 - g.r1 + 1 }, (_, i) =>
  Array.from({ length: g.c2 - g.c1 + 1 }, (_, j) => [g.r1 + i, g.c1 + j])).flat());
const selected = (l, a) => points(nativePivotAreaRanges(l, a));

it('selects compact descendant labels by member identity without selecting separators or subtotals', () => {
  expect(selected(layout(), area(ref(0, [0])))).toEqual([[11, 5], [12, 5], [13, 5]]);
  expect(selected(layout(), area(ref(0, [1]), 'labelOnly="1" cacheIndex="1"'))).toEqual([[11, 5], [12, 5], [13, 5]]);
});
it('intersects parent and child identities without selecting the parent label itself', () => {
  expect(selected(layout(), area(ref(0, [0]) + ref(1, [0])))).toEqual([[12, 5]]);
  expect(selected(layout(), area(ref(1, [0])))).toEqual([[12, 5], [17, 5]]);
});
it('uses actual separate-column label placement and does not paint omitted repeated labels', () => {
  const l = layout({ compact: false });
  expect(selected(l, area(ref(0, [0])))).toEqual([[11, 5], [12, 6], [13, 6]]);
  l.fields[0].fillDownLabels = true;
  expect(selected(l, area(ref(0, [0])))).toEqual([[11, 5], [12, 5], [13, 5], [12, 6], [13, 6]]);
});
it('does not let an inner member select a tabular parent printed on the same row', () => {
  expect(selected(layout({ compact: false, outline: false }), area(ref(1, [0])))).toEqual([[11, 6], [13, 6]]);
});
it('selected=false excludes its own outline label while keeping matching descendant labels', () => {
  expect(selected(layout(), area(ref(0, [0], 'selected="0"')))).toEqual([[12, 5], [13, 5]]);
  expect(selected(layout({ compact: false, outline: false }), area(ref(0, [0], 'selected="0"')))).toEqual([[11, 5], [11, 6], [12, 6]]);
});
it('limits explicit subtotal rules to their own subtotal labels, including top aggregates', () => {
  const l = layout();
  expect(selected(l, area(ref(0, [0], 'sumSubtotal="1"')))).toEqual([[14, 5]]);
  l.rows.items[0].aggregate = true;
  expect(selected(l, area(ref(0, [0], 'defaultSubtotal="1"')))).toEqual([[11, 5]]);
});
it('requires grand-row inclusion and an unrestricted default-subtotal reference for total labels', () => {
  expect(selected(layout(), area(ref(0, [], 'defaultSubtotal="1"')))).toEqual([]);
  expect(selected(layout(), area(ref(0, [], 'defaultSubtotal="1"'), 'labelOnly="1" grandRow="1"'))).toEqual([[18, 5]]);
  expect(selected(layout(), area(ref(0, [0], 'defaultSubtotal="1"'), 'labelOnly="1" grandRow="1"'))).toEqual([]);
});
it('keeps mixed label/value areas separate so blank headers and padding are not painted', () => {
  const result = selected(layout(), area(ref(0, [0]), ''));
  expect(result).toEqual([[12, 7], [13, 7], [11, 5], [12, 5], [13, 5]]);
});
it('coalesces label runs, enforces shared budgets and allows dormant rules with zero output budget', () => {
  const l = layout(), a = area(ref(0, [0])), formats = [{ area: a, dxf: `<dxf xmlns="${MAIN}"/>` }];
  expect(nativePivotFormatLayers(l, formats, { maxRanges: 1 })).toHaveLength(1);
  expect(() => nativePivotFormatLayers(l, formats, { maxWork: 10 })).toThrow(/work limit/);
  expect(() => nativePivotFormatLayers(l, [...formats, ...formats], { maxRanges: 1 })).toThrow(/range limit/);
  l.rows.items = [l.rows.items[5], l.rows.items[6]];
  expect(nativePivotAreaRanges(l, a, { maxRanges: 0 })).toEqual([]);
  expect(() => nativePivotFormatLayers(l, Array(100).fill(formats[0]), { maxWork: 100 })).toThrow(/work limit/);
});
it.each([
  ['unqualified labels', '', 'labelOnly="1"'],
  ['measure labels', ref(4294967294, [0]), 'labelOnly="1"'],
  ['column axis', ref(0), 'labelOnly="1" axis="axisCol" fieldPosition="0"'],
  ['non-outline rule', ref(0), 'labelOnly="1" outline="0"'],
])('refuses %s before widening a selection', (_name, refs, attrs) => {
  expect(() => nativePivotAreaRanges(layout(), area(refs, attrs))).toThrow(/not implemented/);
});
it('rejects unresolved label identities and unsupported merged geometry', () => {
  const l = layout(); l.rows.items[0].members[0].item = 99;
  expect(() => nativePivotAreaRanges(l, area())).toThrow(/identity/);
  expect(() => nativePivotAreaRanges({ ...layout(), mergeItem: true }, area())).toThrow(/merged/);
});
it('resolves a large mixed body with axis-linear work and coalesced label runs', () => {
  const l = layout();
  l.rows.fields = [0]; l.firstDataCol = 1;
  l.rows.items = Array.from({ length: 10000 }, (_, i) => ({ type: 'data', members: [m(0, i % 2)] }));
  l.columns.items = Array(1000).fill({ type: 'data', members: [] });
  l.range = { r1: 0, c1: 0, r2: 10000, c2: 1000 };
  expect(nativePivotAreaRanges(l, area(ref(0), ''), { maxWork: 100000, maxRanges: 2 })).toEqual([
    { r1: 1, r2: 10000, c1: 1, c2: 1000 }, { r1: 1, r2: 10000, c1: 0, c2: 0 },
  ]);
});

it.each([true, false])('addresses the parent field rather than its worksheet column (compact=%s)', compact => {
  const l = layout({ compact });
  expect(selected(l, area(ref(0, [0]), 'labelOnly="1" axis="axisRow" fieldPosition="0"'))).toEqual([[11, 5]]);
  expect(selected(l, area(ref(0, [0]), 'labelOnly="1" axis="axisRow" fieldPosition="1"'))).toEqual([[12, compact ? 5 : 6], [13, compact ? 5 : 6]]);
});
it('resolves a row-field position when row-member references establish the axis', () => {
  expect(selected(layout(), area(ref(0, [0]), 'labelOnly="1" fieldPosition="0"'))).toEqual([[11, 5]]);
});
it('uses declared axis order when cache fields have a different order', () => {
  const l = layout(); l.rows.fields = [1, 0];
  for (const entry of l.rows.items) entry.members = entry.members.map(member => ({ ...member, field: 1 - member.field }));
  for (const entry of l.rows.items) if (entry.subtotalField != null) entry.subtotalField = 1 - entry.subtotalField;
  expect(selected(l, area(ref(1, [0]), 'labelOnly="1" axis="axisRow" fieldPosition="0"'))).toEqual([[11, 5]]);
});
it('accepts an explicitly row-scoped whole-field label selection without member restrictions', () => {
  expect(selected(layout(), area('', 'labelOnly="1" axis="axisRow" fieldPosition="1"'))).toEqual([[12, 5], [13, 5], [17, 5]]);
});
it('keeps value restrictions independent of the selected label field in mixed areas', () => {
  expect(selected(layout(), area(ref(0, [0]), 'axis="axisRow" fieldPosition="0"'))).toEqual([[12, 7], [13, 7], [11, 5]]);
});
it('combines field positions with subtotal and grand-label ownership', () => {
  expect(selected(layout(), area(ref(0, [0], 'sumSubtotal="1"'), 'labelOnly="1" axis="axisRow" fieldPosition="0"'))).toEqual([[14, 5]]);
  expect(selected(layout(), area('', 'labelOnly="1" axis="axisRow" fieldPosition="0" grandRow="1"'))).toContainEqual([18, 5]);
  expect(selected(layout(), area('', 'labelOnly="1" axis="axisRow" fieldPosition="1" grandRow="1"'))).not.toContainEqual([18, 5]);
});
it.each([-1, 1.5, 2, 4294967295])('rejects invalid row-field position %s', fieldPosition => {
  const a = area(ref(0), 'labelOnly="1" axis="axisRow"'); a.fieldPosition = fieldPosition;
  expect(() => nativePivotAreaRanges(layout(), a)).toThrow(/field position/);
});
it('keeps a field-position rule dormant when its member disappears', () => {
  const l = layout(), a = area(ref(0, [0]), 'labelOnly="1" axis="axisRow" fieldPosition="0"');
  l.rows.items = [l.rows.items[5], l.rows.items[6]];
  expect(nativePivotAreaRanges(l, a, { maxRanges: 0 })).toEqual([]);
});

it('resolves explicit last-field qualifications without changing row-label ownership', () => {
  for (const compact of [true, false]) {
    const l = layout({ compact }), refs = ref(0, [0]) + ref(1, [0]);
    for (const attrs of ['labelOnly="1"', 'labelOnly="0"', 'labelOnly="1" axis="axisRow" fieldPosition="1"']) {
      expect(selected(l, area(refs, `${attrs} field="1"`))).toEqual(selected(l, area(refs, attrs)));
    }
    expect(() => selected(l, area(refs, 'labelOnly="1" field="0"'))).toThrow();
    expect(() => selected(l, area(refs, 'labelOnly="1" field="1" axis="axisRow" fieldPosition="0"'))).toThrow(/field position/);
  }
});
