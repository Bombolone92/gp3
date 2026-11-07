import { expect, it } from 'vitest';
import { readNativePivotConditionalFormats, nativePivotConditionalRanges, planNativePivotConditionalRules } from '../src/core/native-pivot-condformat.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const pivot = (areas = '<pivotArea outline="0"><references count="1"><reference field="4294967294" count="1" selected="0"><x v="2"/></reference></references></pivotArea>', attrs = 'scope="data" priority="7"') => ({ xml: `<pivotTableDefinition xmlns="${MAIN}"><conditionalFormats count="1"><conditionalFormat ${attrs}><pivotAreas count="1">${areas}</pivotAreas></conditionalFormat></conditionalFormats></pivotTableDefinition>` });
function layout() {
  return { range: { r1: 4, c1: 2, r2: 8, c2: 6 }, firstDataRow: 1, firstDataCol: 1,
    measures: [{ field: 8 }, { field: 7 }, { field: 6 }],
    rows: { fields: [0], items: ['data', 'blank', 'data', 'grand'].map(type => ({ type, measure: 0 })) },
    columns: { fields: [-2], items: [2, 0, 1].map(measure => ({ type: 'data', measure })) } };
}
it('resolves dataFields identities, independent of cache fields and displayed measure order', () => {
  const bindings = readNativePivotConditionalFormats(pivot());
  expect(bindings[0]).toMatchObject({ priority: 7, scope: 'data', type: 'none', areas: [{ references: [{ field: 4294967294, selected: false, items: [2] }] }] });
  expect(nativePivotConditionalRanges(layout(), bindings)).toEqual([{ priority: 7, ranges: [{ r1: 5, c1: 3, r2: 8, c2: 3 }] }]);
});
it('unions data-field areas, compacts adjacent measures and retains nonadjacent pieces', () => {
  const binding = readNativePivotConditionalFormats(pivot())[0]; binding.areas[0].references[0].items = [2, 1];
  expect(nativePivotConditionalRanges(layout(), [binding])[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 8, c2: 3 }, { r1: 5, c1: 5, r2: 8, c2: 5 }]);
  binding.areas.push({ ...binding.areas[0], references: [{ ...binding.areas[0].references[0], items: [0] }] });
  expect(nativePivotConditionalRanges(layout(), [binding])[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 8, c2: 5 }]);
});
it('supports measures on rows and excludes measure-axis separators from membership', () => {
  const l = layout(); l.rows = { fields: [-2], items: [2, null, 1, 2].map(measure => ({ type: measure == null ? 'blank' : 'data', measure: measure ?? 0 })) };
  l.columns = { fields: [0], items: [{ type: 'data', measure: 0 }, { type: 'grand', measure: 0 }] };
  expect(nativePivotConditionalRanges(l, readNativePivotConditionalFormats(pivot()))[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 5, c2: 4 }, { r1: 8, c1: 3, r2: 8, c2: 4 }]);
});
it('treats an unrestricted data scope as all measures, including a fieldless single measure', () => {
  const bindings = readNativePivotConditionalFormats(pivot('<pivotArea type="data"/>'));
  expect(nativePivotConditionalRanges(layout(), bindings)[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 8, c2: 5 }]);
  const l = layout(); l.measures = [l.measures[0]]; l.columns = { fields: [], items: [{ type: 'data', measure: 0 }] };
  expect(nativePivotConditionalRanges(l, bindings)[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 8, c2: 3 }]);
});
it('follows resized axes and returns no active range for an empty report body', () => {
  const l = layout(), bindings = readNativePivotConditionalFormats(pivot()); l.rows.items = l.rows.items.slice(0, 1);
  expect(nativePivotConditionalRanges(l, bindings)[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 5, c2: 3 }]);
  l.rows.items = []; expect(nativePivotConditionalRanges(l, bindings)).toEqual([{ priority: 7, ranges: [] }]);
});
it('rebases predicates and preserves source recipes for clearing an empty selection', () => {
  const rule = { id: 'r', type: 'formula', value: 'D6<0', priority: 7, range: { r1: 5, c1: 3, r2: 8, c2: 3 }, style: { color: '#ff0000' } };
  const before = structuredClone(rule), targets = [{ priority: 7, ranges: [{ r1: 10, c1: 5, r2: 11, c2: 5 }] }];
  const plan = planNativePivotConditionalRules(targets, [rule])[0];
  expect(plan.rules[0]).toMatchObject({ id: 'r', value: 'F11<0', range: targets[0].ranges[0] });
  expect(rule).toEqual(before);
  const empty = planNativePivotConditionalRules([{ priority: 7, ranges: [] }], [rule])[0];
  expect(empty.rules).toEqual([]); expect(empty.sourceRules).toEqual([rule]);
  expect(planNativePivotConditionalRules(targets, empty.sourceRules)[0].rules).toEqual(plan.rules);
  empty.sourceRules[0].style.color = '#000000'; expect(rule.style.color).toBe('#ff0000');
});
it('moves shared statistical domains with the target pieces and assigns new piece IDs', () => {
  const rule = { id: 'old', priority: 7, type: 'scale', range: { r1: 5, c1: 3, r2: 8, c2: 3 }, style: {}, statisticsRange: '$D$6:$D$9' };
  const ranges = [{ r1: 5, c1: 3, r2: 6, c2: 3 }, { r1: 5, c1: 5, r2: 6, c2: 5 }];
  const result = planNativePivotConditionalRules([{ priority: 7, ranges }], [rule], { newId: () => 'new' })[0];
  expect(result.rules.map(r => r.id)).toEqual(['old', 'new']);
  expect(result.rules[0].statisticsRange).toBe('($D$6:$D$7,$F$6:$F$7)');
});
it.each([
  ['count', p => { p.xml = p.xml.replace('references count="1"', 'references count="2"'); }],
  ['priority', p => { p.xml = p.xml.replace('priority="7"', 'priority="0"'); }],
  ['selection flag', p => { p.xml = p.xml.replace('selected="0"', 'selected="no"'); }],
  ['missing index', p => { p.xml = p.xml.replace('<x v="2"/>', '<x/>'); }],
])('rejects malformed %s', (_name, change) => { const p = pivot(); change(p); expect(() => readNativePivotConditionalFormats(p)).toThrow(/Invalid pivot/); });
it('rejects unsupported scope and relative/member selections instead of widening the rule', () => {
  const binding = readNativePivotConditionalFormats(pivot())[0]; binding.scope = 'field'; expect(() => nativePivotConditionalRanges(layout(), [binding])).toThrow(/scopes/);
  binding.scope = 'data'; binding.areas[0].references[0].relative = true; expect(() => nativePivotConditionalRanges(layout(), [binding])).toThrow(/references/);
  binding.areas[0].references[0].relative = false; binding.areas[0].references[0].field = 0; expect(() => nativePivotConditionalRanges(layout(), [binding])).toThrow(/references/);
});
it('rejects missing or conflicting worksheet rules and enforces range limits', () => {
  const targets = nativePivotConditionalRanges(layout(), readNativePivotConditionalFormats(pivot()));
  expect(() => planNativePivotConditionalRules(targets, [])).toThrow(/missing worksheet/);
  const range = targets[0].ranges[0];
  expect(() => planNativePivotConditionalRules(targets, [{ priority: 7, type: 'formula', value: 'TRUE', range }, { priority: 7, type: 'formula', value: 'FALSE', range }])).toThrow(/ambiguous/);
  expect(() => nativePivotConditionalRanges(layout(), readNativePivotConditionalFormats(pivot()), { maxRanges: 0 })).toThrow(/limit/);
});
it('rejects stale measure identities and avoids a dense cross product for large report bodies', () => {
  const bindings = readNativePivotConditionalFormats(pivot()), l = layout(); bindings[0].areas[0].references[0].items = [3];
  expect(() => nativePivotConditionalRanges(l, bindings)).toThrow(/measure index/);
  bindings[0].areas[0].references[0].items = [2]; l.range.r2 = 100000; l.rows.items = new Proxy({ length: 99996 }, { get(target, key) { if (key !== 'length') throw new Error('Unexpected row access'); return target.length; } });
  expect(nativePivotConditionalRanges(l, bindings)[0].ranges).toEqual([{ r1: 5, c1: 3, r2: 100000, c2: 3 }]);
});

it('bounds all bindings together and refuses extended pivot-format rules', () => {
  const binding = readNativePivotConditionalFormats(pivot())[0];
  expect(() => nativePivotConditionalRanges(layout(), [binding, { ...binding, priority: 8 }], { maxRanges: 1 })).toThrow(/limit/);
  const p = pivot(); p.xml = p.xml.replace('</pivotTableDefinition>', '<extLst><ext><x:conditionalFormat xmlns:x="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"/></ext></extLst></pivotTableDefinition>');
  expect(() => readNativePivotConditionalFormats(p)).toThrow(/Extended/);
});
