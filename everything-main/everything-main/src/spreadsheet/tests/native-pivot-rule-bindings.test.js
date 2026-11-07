import { expect, it } from 'vitest';
import { bindNativePivotRules, writeNativePivotRuleBindings, copyPivotRuleBindings } from '../src/core/native-pivot-rule-bindings.js';
import { planNativePivotConditionalRules } from '../src/core/native-pivot-condformat.js';
import { parseModelXml, standaloneModelXml } from '../src/core/data-model-metadata.js';
import { reconcileConditionalFormats, conditionalFormatSignature } from '../src/core/xlsx-condformat-reconcile.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const format = (priority, scope = 'data') => `<conditionalFormat priority="${priority}" scope="${scope}"><pivotAreas count="1"><pivotArea/></pivotAreas></conditionalFormat>`;
const root = body => parseModelXml(`<pivotTableDefinition xmlns="${MAIN}"><conditionalFormats count="1">${body}</conditionalFormats></pivotTableDefinition>`);
const range = { r1: 1, c1: 1, r2: 3, c2: 1 };
it('binds priorities within their owner worksheet and removes unrelated temporary identities', () => {
  const sheets = ['one', 'two'].map(id => ({ id, name: id, rules: [{ pivotRuleIds: [id] }, { pivotRuleIds: ['unrelated'] }] }));
  const pivots = { tables: sheets.map(s => ({ owner: s.id, xml: standaloneModelXml(root(format(8))) })) };
  bindNativePivotRules(pivots, sheets, new Map(sheets.map(s => [s.name, new Map([[8, s.id]])])));
  expect(pivots.tables.map(p => p.conditionalRules)).toEqual([[{ priority: 8, id: 'one' }], [{ priority: 8, id: 'two' }]]);
  expect(sheets[0].rules[1]).not.toHaveProperty('pivotRuleIds');
});
it('refuses a missing worksheet rule instead of creating a dangling identity', () => {
  expect(() => bindNativePivotRules({ tables: [{ owner: 'one', xml: standaloneModelXml(root(format(8))) }] }, [{ id: 'one', name: 'one', rules: [] }], new Map([['one', new Map([[8, 'lost']])]]))).toThrow(/Missing/);
});
it('coalesces identical rejoined projections but rejects incompatible areas sharing a priority', () => {
  const p = { conditionalRules: [{ priority: 1, id: 'a' }, { priority: 2, id: 'b' }] }, priorities = new Map([['a', [3]], ['b', [3]]]);
  const node = root(format(1) + format(2));
  writeNativePivotRuleBindings(node, p, priorities);
  expect(standaloneModelXml(node)).toContain('count="1"');
  expect(standaloneModelXml(node)).toContain('priority="3"');
  expect(() => writeNativePivotRuleBindings(root(format(1) + format(2, 'field')), p, priorities)).toThrow(/Ambiguous/);
});
it('uses stable identities for report plans after worksheet priorities change', () => {
  const rule = { id: 'rule', pivotRuleIds: ['stable'], type: 'formula', value: 'B2>0', range };
  const plan = planNativePivotConditionalRules([{ priority: 8, ranges: [range] }], [rule], { bindings: [{ priority: 8, id: 'stable' }] });
  expect(plan[0].rules[0].id).toBe('rule');
});
it('detaches ordinary rule copies and remaps shared identities for complete report copies', () => {
  const rule = { pivot: true, pivotRuleIds: ['one', 'two'], range };
  expect(copyPivotRuleBindings(rule)).toEqual({ range });
  expect(copyPivotRuleBindings(rule, new Map([['one', ['new1', 'new2']]]))).toMatchObject({ pivot: true, pivotRuleIds: ['new1', 'new2'] });
  expect(rule.pivotRuleIds).toEqual(['one', 'two']);
});
it('excludes session identities from native fingerprints and refreshes them on private restoration', async () => {
  const native = { type: 'formula', value: 'B2>0', range, style: {}, pivot: true, pivotRuleIds: ['current'] }, saved = { ...native, id: 'saved', pivotRuleIds: ['old'] };
  const signature = await conditionalFormatSignature(native);
  expect(await conditionalFormatSignature({ ...native, pivotRuleIds: ['another'] })).toBe(signature);
  const result = await reconcileConditionalFormats([saved], { version: 3, entries: [{ start: 0, end: 0, signatures: [signature] }] }, [native]);
  expect(result).toEqual([{ ...saved, pivotRuleIds: ['current'] }]);
  expect(await reconcileConditionalFormats([saved], null, [native])).toEqual([native]);
});
it('preserves the pivot-only flag on standalone extended icon rules', () => {
  const xml = `<worksheet xmlns="${MAIN}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main"><extLst><ext><x14:conditionalFormattings><x14:conditionalFormatting pivot="true"><x14:cfRule type="iconSet" priority="1"><x14:iconSet iconSet="3Arrows"><x14:cfvo type="percent"><xm:f>0</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>33</xm:f></x14:cfvo><x14:cfvo type="percent"><xm:f>67</xm:f></x14:cfvo></x14:iconSet></x14:cfRule><xm:sqref>B2:B4</xm:sqref></x14:conditionalFormatting></x14:conditionalFormattings></ext></extLst></worksheet>`;
  expect(readXlsxConditionalFormats(xml, {}, null, [])[0]).toMatchObject({ type: 'icons', pivot: true });
});

it('keeps historical private ownership for ordinary rules in books that also contain pivots', async () => {
  const native = { type: 'formula', value: 'B2>0', range, style: {}, pivotRuleIds: ['temporary'] };
  const saved = { type: 'gt', value: 0, range, style: {} };
  expect(await reconcileConditionalFormats([saved], null, [native])).toEqual([saved]);
});

it.each([['duplicate priorities', format(8) + format(8)], ['fractional priority', format('8.0')], ['bad count', format(8) + format(9)]])('rejects malformed native binding %s', (_label, body) => {
  const sheet = { id: 'one', name: 'one', rules: [{ pivotRuleIds: ['a', 'b'] }] };
  const node = root(body);
  if (_label === 'duplicate priorities') node.firstChild.setAttribute('count', '2');
  expect(() => bindNativePivotRules({ tables: [{ owner: sheet.id, xml: standaloneModelXml(node) }] }, [sheet], new Map([['one', new Map([[8, 'a'], [9, 'b']])]]))).toThrow();
});
it('omits an explicitly deleted managed rule from future report plans', () => {
  expect(planNativePivotConditionalRules([{ priority: 8, ranges: [range] }], [], { bindings: [{ priority: 8, id: 'deleted' }] })).toEqual([]);
  expect(() => planNativePivotConditionalRules([{ priority: 8, ranges: [range] }], [], { bindings: [] })).toThrow(/missing worksheet/);
});

it('refuses to silently drop a bound rule that the worksheet exporter cannot represent', () => {
  expect(() => writeNativePivotRuleBindings(root(format(8)), { conditionalRules: [{ priority: 8, id: 'present' }] }, new Map([['present', new Set()]]))).toThrow(/no native representation/);
});
