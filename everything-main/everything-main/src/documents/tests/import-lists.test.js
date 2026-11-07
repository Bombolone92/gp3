import { describe, expect, it } from 'vitest';
import { hoistListBlocks, refusedListBlock } from '../src/lib/import-lists.js';

const p = (text) => ({ kind: 'paragraph', paragraph: { inlines: [{ kind: 'run', run: { text } }] } });
const table = { kind: 'table', table: { rows: [] } };
const heading = { kind: 'heading', heading: { level: 1, inlines: [] } };
const list = (levels, items) => ({ kind: 'list', list: { levels, items } });

describe('hoistListBlocks', () => {
  it('leaves fragments without such items alone', () => {
    const fragment = [p('a'), list([{ level: 0, kind: 'bullet' }], [{ level: 0, path: [0], content: [p('one')] }])];
    expect(hoistListBlocks(fragment)).toEqual(fragment);
    expect(hoistListBlocks(null)).toBeNull();
  });

  it('lifts a table out of its item and continues the numbering after it', () => {
    const fragment = [list([{ level: 0, kind: 'ordered', start: 1 }], [
      { level: 0, path: [0], content: [p('one'), table] },
      { level: 0, path: [1], content: [p('two')] },
      { level: 0, path: [2], content: [p('three'), heading, p('after')] },
      { level: 0, path: [3], content: [p('four')] },
    ])];
    expect(hoistListBlocks(fragment)).toEqual([
      list([{ level: 0, kind: 'ordered', start: 1 }], [{ level: 0, path: [0], content: [p('one')] }]),
      table,
      list([{ level: 0, kind: 'ordered', start: 2 }], [{ level: 0, path: [1], content: [p('two')] }, { level: 0, path: [2], content: [p('three'), p('after')] }]),
      heading,
      list([{ level: 0, kind: 'ordered', start: 4 }], [{ level: 0, path: [3], content: [p('four')] }]),
    ]);
  });

  it('keeps an item that held only a table as an empty item, counting nested items for no number', () => {
    const fragment = [list([{ level: 0, kind: 'ordered', start: 3 }, { level: 1, kind: 'bullet' }], [
      { level: 0, path: [0], content: [table] },
      { level: 1, path: [0, 0], content: [p('nested')] },
      { level: 0, path: [1], content: [p('next')] },
    ])];
    const out = hoistListBlocks(fragment);
    expect(out[0].list.items[0].content).toEqual([{ kind: 'paragraph', paragraph: { inlines: [] } }]);
    expect(out[1]).toBe(table);
    expect(out[2].list.levels).toEqual([{ level: 0, kind: 'ordered', start: 4 }, { level: 1, kind: 'bullet' }]);
    expect(out[2].list.items.map((item) => item.path)).toEqual([[0, 0], [1]]);
  });

  it('recognizes the receipt that hoisting mends', () => {
    expect(refusedListBlock({ success: false, failure: { code: 'CAPABILITY_UNSUPPORTED', message: 'List item block kind "table" is not materializable.' } })).toBe(true);
    expect(refusedListBlock({ success: false, failure: { code: 'CAPABILITY_UNSUPPORTED', message: 'Nested tables cannot be represented' } })).toBe(false);
    expect(refusedListBlock({ success: true })).toBe(false);
  });
});
