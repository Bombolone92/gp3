import { describe, it, expect } from 'vitest';
import { baseWith, makeChoice } from './helpers/base.js';
import { runView, searchView, compileFilter, sortRecords } from '../src/data/query.js';

function setup() {
  const lo = makeChoice('Low');
  const hi = makeChoice('High', [lo]);
  const ctx = baseWith([
    { name: 'Qty', type: 'number' },
    { name: 'Due', type: 'date' },
    { name: 'Done', type: 'checkbox' },
    { name: 'Pri', type: 'singleSelect', options: { choices: [hi, lo] } },
    { name: 'Tags', type: 'multipleSelect', options: { choices: [lo, hi] } },
  ], { now: () => new Date(2026, 9, 12, 12).getTime() });
  const { base, table, f } = ctx;
  const N = f('Name').id;
  const rows = [
    { [N]: 'apple', [f('Qty').id]: 5, [f('Due').id]: '2026-10-10', [f('Pri').id]: lo.id, [f('Tags').id]: [lo.id] },
    { [N]: 'Banana', [f('Qty').id]: 2, [f('Due').id]: '2026-10-12', [f('Done').id]: true, [f('Pri').id]: hi.id, [f('Tags').id]: [lo.id, hi.id] },
    { [N]: 'cherry', [f('Due').id]: '2026-11-01', [f('Pri').id]: hi.id },
    { [N]: 'date 10', [f('Qty').id]: 10 },
    { [N]: 'date 9', [f('Qty').id]: 9 },
  ];
  base.createRecords(table.id, rows);
  return { ...ctx, lo, hi, view: table.views[0] };
}

const names = (base, table, recs) => recs.map((r) => r.c[table.schema.primaryFieldId]);

describe('filters', () => {
  it('filters by text, numbers, selects, checkbox and dates', () => {
    const { base, table, f, view, hi } = setup();
    const check = (conditions, conjunction = 'and') => {
      base.updateView(table.id, view.id, { filters: { conjunction, conditions } });
      return names(base, table, runView(base, table, view).records);
    };
    expect(check([{ fieldId: f('Name').id, op: 'contains', value: 'AN' }])).toEqual(['Banana']);
    expect(check([{ fieldId: f('Qty').id, op: '>', value: 4 }])).toEqual(['apple', 'date 10', 'date 9']);
    expect(check([{ fieldId: f('Qty').id, op: 'isEmpty' }])).toEqual(['cherry']);
    expect(check([{ fieldId: f('Pri').id, op: 'is', value: hi.id }])).toEqual(['Banana', 'cherry']);
    expect(check([{ fieldId: f('Tags').id, op: 'hasAllOf', value: [hi.id] }])).toEqual(['Banana']);
    expect(check([{ fieldId: f('Done').id, op: 'is', value: true }])).toEqual(['Banana']);
    expect(check([{ fieldId: f('Due').id, op: 'is', value: { mode: 'today' } }])).toEqual(['Banana']);
    expect(check([{ fieldId: f('Due').id, op: 'isWithin', value: { mode: 'pastWeek' } }])).toEqual(['apple', 'Banana']);
    expect(check([{ fieldId: f('Due').id, op: 'isAfter', value: { mode: 'exactDate', date: '2026-10-12' } }])).toEqual(['cherry']);
    // Or, nested groups, and incomplete conditions (ignored).
    expect(check([
      { fieldId: f('Name').id, op: 'is', value: 'apple' },
      { conjunction: 'and', conditions: [{ fieldId: f('Qty').id, op: '>=', value: 10 }, { fieldId: f('Name').id, op: 'contains', value: '' }] },
    ], 'or')).toEqual(['apple', 'date 10']);
  });

  it('ignores conditions that are not finished', () => {
    const { base, table, f } = setup();
    expect(compileFilter(base, table, { conjunction: 'and', conditions: [{ fieldId: f('Name').id, op: 'contains', value: '' }] })).toBeNull();
  });
});

describe('sorting and grouping', () => {
  it('sorts naturally with empty values last', () => {
    const { base, table, f } = setup();
    const recs = table.ordered().slice();
    sortRecords(base, table, recs, [{ fieldId: f('Name').id, dir: 'asc' }]);
    expect(names(base, table, recs)).toEqual(['apple', 'Banana', 'cherry', 'date 9', 'date 10']);
    sortRecords(base, table, recs, [{ fieldId: f('Qty').id, dir: 'desc' }]);
    expect(names(base, table, recs)).toEqual(['date 10', 'date 9', 'apple', 'Banana', 'cherry']);
  });

  it('sorts single selects by option order and groups', () => {
    const { base, table, f, view, hi, lo } = setup();
    base.updateView(table.id, view.id, { groups: [{ fieldId: f('Pri').id, dir: 'asc' }], sorts: [{ fieldId: f('Name').id, dir: 'desc' }] });
    const { tree, records } = runView(base, table, view);
    expect(tree.map((g) => g.key)).toEqual(['', hi.id, lo.id]);
    expect(tree[1].records.map((r) => r.c[f('Name').id])).toEqual(['cherry', 'Banana']);
    expect(records.length).toBe(5);
  });

  it('memoizes until the base changes', () => {
    const { base, table, view, f } = setup();
    const a = runView(base, table, view);
    expect(runView(base, table, view)).toBe(a);
    base.createRecords(table.id, [{ [f('Name').id]: 'new' }]);
    expect(runView(base, table, view)).not.toBe(a);
  });
});

describe('search', () => {
  it('finds cells in visible fields', () => {
    const { base, table, view, f } = setup();
    const { records } = runView(base, table, view);
    const hits = searchView(base, table, view, records, 'date');
    expect(hits.map((h) => h.fieldId)).toEqual([f('Name').id, f('Name').id]);
    expect(searchView(base, table, view, records, 'high').length).toBe(3);
  });
});

describe('performance', () => {
  it('filters and sorts 50k records quickly', () => {
    const { base, table, f, view } = baseWith([{ name: 'Qty', type: 'number' }, { name: 'F', type: 'formula', options: { formula: '' } }]);
    const rows = [];
    for (let i = 0; i < 50000; i++) rows.push({ [f('Name').id]: `Item ${i}`, [f('Qty').id]: (i * 7919) % 1000 });
    base.createRecords(table.id, rows);
    base.updateField(table.id, f('F').id, { options: { formula: `{${f('Qty').id}} * 2`, format: 'auto' } });
    base.updateView(table.id, table.views[0].id, {
      filters: { conjunction: 'and', conditions: [{ fieldId: f('Qty').id, op: '>', value: 100 }] },
      sorts: [{ fieldId: f('F').id, dir: 'desc' }, { fieldId: f('Name').id, dir: 'asc' }],
    });
    const t0 = performance.now();
    const { records } = runView(base, table, table.views[0]);
    const ms = performance.now() - t0;
    expect(records.length).toBe(44950);
    expect(base.compute.value(table, records[0], f('F'))).toBe(1998);
    expect(ms).toBeLessThan(1500);
    void view;
  });
});
