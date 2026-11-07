import { expect, it } from 'vitest';
import { nativePivotRowLabels } from '../src/core/native-pivot-row-labels.js';

function fixture({ outline = true, compact = true, fillDownLabels = false } = {}) {
  const fields = [0, 1, 2].map(() => ({ outline, compact, fillDownLabels, items: [{ type: 'data', index: 0 }, { type: 'data', index: 1 }] }));
  const member = (field, item, value) => ({ field, item, index: item, type: 'string', value });
  const a = member(0, 0, 'East'), b = member(0, 1, 'West'), x = member(1, 0, 'A'), y = member(1, 1, 'B');
  const data = members => ({ type: 'data', members });
  const items = outline ? [data([a]), data([a, x]), data([a, y]), { type: 'blank', members: [] }, data([b])] : [data([a, x]), data([a, y]), data([b, x])];
  items.push({ type: 'grand', members: [] });
  return { fields, indent: 2, firstDataRow: 1, firstDataCol: compact && outline ? 1 : 2,
    range: { r1: 5, c1: 3, r2: 30, c2: 8 }, rows: { fields: [0, 1], items } };
}
const project = layout => nativePivotRowLabels(layout).map(({ r, c, value, indent }) => [r, c, value, indent]);
it('places compact hierarchy labels in one column with indentation and separator rows', () => {
  const layout = fixture(), before = structuredClone(layout);
  expect(project(layout)).toEqual([[6, 3, 'East', 0], [7, 3, 'A', 2], [8, 3, 'B', 2], [10, 3, 'West', 0], [11, 3, 'Grand Total', 0]]);
  expect(layout).toEqual(before);
});
it('ignores repeat labels for compact outline fields', () => {
  expect(project(fixture({ fillDownLabels: true }))).toEqual(project(fixture()));
});
it('uses separate columns for outline layout and repeats only when requested', () => {
  const layout = fixture({ compact: false });
  expect(project(layout).slice(0, 3)).toEqual([[6, 3, 'East', 0], [7, 4, 'A', 0], [8, 4, 'B', 0]]);
  layout.fields[0].fillDownLabels = true;
  expect(project(layout).slice(0, 5)).toEqual([[6, 3, 'East', 0], [7, 3, 'East', 0], [7, 4, 'A', 0], [8, 3, 'East', 0], [8, 4, 'B', 0]]);
});
it('prints tabular parents on their first detail row, using the complete prefix for repetition', () => {
  const layout = fixture({ outline: false });
  expect(project(layout)).toEqual([[6, 3, 'East', 0], [6, 4, 'A', 0], [7, 4, 'B', 0], [8, 3, 'West', 0], [8, 4, 'A', 0], [9, 3, 'Grand Total', 0]]);
  layout.fields[0].fillDownLabels = true;
  expect(project(layout)).toContainEqual([7, 3, 'East', 0]);
});
it('restarts indentation after an unshared column in mixed layouts', () => {
  const layout = fixture(); layout.fields[0].compact = false; layout.firstDataCol = 2;
  layout.rows.fields.push(2);
  layout.rows.items[2].members.push({ field: 2, item: 0, index: 0, type: 'string', value: 'Leaf' });
  expect(project(layout).slice(0, 3)).toEqual([[6, 3, 'East', 0], [7, 4, 'A', 0], [8, 4, 'Leaf', 2]]);
});
it('keeps typed labels and distinguishes empty custom captions from missing captions', () => {
  const layout = fixture(); layout.rows.items = [{ type: 'data', members: [{ field: 0, item: 0, index: 0, type: 'number', value: 12 }] }];
  expect(nativePivotRowLabels(layout)[0]).toMatchObject({ value: 12, type: 'number' });
  layout.fields[0].items[0].caption = '';
  expect(nativePivotRowLabels(layout)[0]).toMatchObject({ value: '', type: 'string' });
  delete layout.fields[0].items[0].caption;
  layout.rows.items[0].members[0] = { field: 0, item: 0, index: 0, type: 'blank', value: null };
  expect(nativePivotRowLabels(layout, { blankCaption: '(empty)' })[0]).toMatchObject({ value: '(empty)', type: 'string' });
});
it('places subtotal captions for their own member even after an identical prefix', () => {
  const layout = fixture(); const members = layout.rows.items[0].members;
  layout.rows.items = [{ type: 'data', members }, { type: 'default', members }, { type: 'avg', members }];
  expect(project(layout).map(c => c[2])).toEqual(['East', 'East Total', 'East Average']);
  layout.fields[0].subtotalCaption = 'Custom';
  expect(project(layout).map(c => c[2])).toEqual(['East', 'Custom', 'Custom']);
});
it('accepts localized totals and formatted subtotal names without changing member identity', () => {
  const layout = fixture(); layout.grandTotalCaption = 'All regions';
  expect(project(layout).at(-1)[2]).toBe('All regions');
  layout.rows.items = [{ type: 'sum', members: [{ field: 0, item: 0, index: 0, type: 'number', value: 0.25 }] }];
  expect(nativePivotRowLabels(layout, { formatMember: m => `${m.value * 100}%`, subtotalCaption: s => `${s} totalisé` })[0]).toMatchObject({ value: '25% totalisé', role: 'subtotal', field: 0, item: 0 });
});
it('rejects ambiguous cached subtotals, missing identities, overlaps and unsupported layouts', () => {
  const layout = fixture(); layout.rows.items[0].members[0].type = 'subtotal';
  expect(() => project(layout)).toThrow(/identity/);
  expect(() => project({ ...fixture(), firstDataCol: 0 })).toThrow(/overlap/);
  expect(() => project({ ...fixture(), mergeItem: true })).toThrow(/merged/);
  const measures = fixture(); measures.rows.fields.push(-2); expect(() => project(measures)).toThrow(/measure-on-rows/);
});
it('bounds output and rejects rows outside the report without returning partial results', () => {
  expect(() => nativePivotRowLabels(fixture(), { maxCells: 4 })).toThrow(/limit/);
  expect(() => nativePivotRowLabels(fixture(), { maxCells: -1 })).toThrow(/limit/);
  const layout = fixture(); layout.range.r2 = 10; expect(() => project(layout)).toThrow(/location/);
});

it('uses shared member captions for labels and subtotals with report captions taking precedence', () => {
  const layout = fixture(), members = [{ field: 0, item: 0, index: 0, type: 'number', value: 42, caption: 'Answer' }];
  layout.rows.items = [{ type: 'data', members }, { type: 'default', members }];
  expect(nativePivotRowLabels(layout).map(c => [c.value, c.type])).toEqual([['Answer', 'string'], ['Answer Total', 'string']]);
  members[0].caption = '';
  expect(nativePivotRowLabels(layout).map(c => c.value)).toEqual(['', ' Total']);
  layout.fields[0].items[0].caption = 'Local';
  expect(nativePivotRowLabels(layout).map(c => c.value)).toEqual(['Local', 'Local Total']);
  expect(members[0].value).toBe(42);
});
