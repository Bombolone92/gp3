import { describe, it, expect, vi } from 'vitest';
import { PARAGRAPH_SORTS, leadingNumber, sortedIds, movesToOrder, paragraphText, sortParagraphs } from '../src/lib/sortparagraphs.js';

/** Apply moves to an order the way the engine would, to check they produce the target. */
function applyMoves(order, moves) {
  const out = [...order];
  for (const m of moves) {
    out.splice(out.indexOf(m.source), 1);
    const at = out.indexOf(m.destination);
    out.splice(m.placement === 'before' ? at : at + 1, 0, m.source);
  }
  return out;
}

describe('sorting paragraphs', () => {
  it('takes a hyphen as a minus sign only when it starts the number', () => {
    expect(leadingNumber('Room A-5')).toBe(5);
    expect(leadingNumber('Item B-12 (west wing)')).toBe(12);
    expect(leadingNumber('-5 degrees')).toBe(-5);
    expect(leadingNumber('reading: -3.5')).toBe(-3.5);
    expect(leadingNumber('x2-1')).toBe(2);
  });

  it('reads European decimal commas as decimals and other commas as thousands separators', () => {
    expect(leadingNumber('1,5 kg')).toBe(1.5);
    expect(leadingNumber('1.234,5 km')).toBe(1234.5);
    expect(leadingNumber('$1,200')).toBe(1200);
    expect(leadingNumber('1,200.50 total')).toBe(1200.5);
    expect(leadingNumber('Chapter 3. The end')).toBe(3);
    expect(leadingNumber('-2,5 degrees')).toBe(-2.5);
  });

  it('reads leading numbers', () => {
    expect(leadingNumber('3. Pears')).toBe(3);
    expect(leadingNumber('$1,200 budget')).toBe(1200);
    expect(leadingNumber('Total: -4.5')).toBe(-4.5);
    expect(leadingNumber('.75 rate')).toBe(0.75);
    expect(leadingNumber('-.5 change')).toBe(-0.5);
    expect(leadingNumber('...3 more')).toBe(3);
    expect(leadingNumber('Pears')).toBeNull();
  });

  it('orders by text or number, keeping ties in document order', () => {
    const items = [{ id: 'a', text: 'Cherry' }, { id: 'b', text: 'apple' }, { id: 'c', text: 'Banana' }, { id: 'd', text: 'item 10' }, { id: 'e', text: 'item 9' }];
    expect(sortedIds(items, 'textAsc')).toEqual(['b', 'c', 'a', 'e', 'd']);
    expect(sortedIds(items, 'textDesc')).toEqual(['d', 'e', 'a', 'c', 'b']);
    const nums = [{ id: 'a', text: '12 pears' }, { id: 'b', text: 'no number' }, { id: 'c', text: '3 apples' }, { id: 'd', text: '3 plums' }];
    expect(sortedIds(nums, 'numberAsc')).toEqual(['c', 'd', 'a', 'b']);
    expect(sortedIds(nums, 'numberDesc')).toEqual(['a', 'c', 'd', 'b']);
    expect(() => sortedIds(items, 'random')).toThrow('Unknown sort');
    expect(PARAGRAPH_SORTS.map((s) => s.id)).toEqual(['textAsc', 'textDesc', 'numberAsc', 'numberDesc']);
  });

  it('plans moves that reach the order, leaving settled paragraphs alone', () => {
    expect(movesToOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([]);
    const m1 = movesToOrder(['c', 'a', 'b'], ['a', 'b', 'c']);
    expect(m1).toEqual([{ source: 'a', destination: 'c', placement: 'before' }, { source: 'b', destination: 'a', placement: 'after' }]);
    expect(applyMoves(['c', 'a', 'b'], m1)).toEqual(['a', 'b', 'c']);
    expect(movesToOrder(['a', 'c', 'b'], ['a', 'b', 'c'])).toEqual([{ source: 'b', destination: 'a', placement: 'after' }]);
    for (const [cur, tgt] of [[['b', 'a'], ['a', 'b']], [['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd']], [['b', 'd', 'a', 'c'], ['a', 'b', 'c', 'd']]]) {
      expect(applyMoves(cur, movesToOrder(cur, tgt))).toEqual(tgt);
    }
    expect(movesToOrder(['d', 'c', 'b', 'a'], ['a', 'b', 'c', 'd'])).toHaveLength(3);
  });

  it('correctly sorts every permutation without moving a paragraph twice', () => {
    const permutations = (ids) => ids.length ? ids.flatMap((id, i) =>
      permutations(ids.filter((_, j) => i !== j)).map((rest) => [id, ...rest])) : [[]];
    const target = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const current of permutations(target)) {
      const moves = movesToOrder(current, target);
      expect(applyMoves(current, moves)).toEqual(target);
      expect(new Set(moves.map((move) => move.source)).size).toBe(moves.length);
      expect(moves.length).toBeLessThan(target.length);
    }
  });

  it('reads the paragraphs and moves them through the API', async () => {
    const texts = { p1: 'Cherry', p2: 'Apple', p3: 'Banana' };
    const moves = [];
    const api = {
      getNodeById: async ({ nodeId }) => ({ node: { paragraph: { inlines: [{ run: { text: texts[nodeId] } }] } } }),
      blocks: { move: async (i) => { moves.push([i.source.nodeId, i.placement, i.destination.nodeId]); return { success: true }; } },
    };
    expect(paragraphText({ node: { paragraph: { inlines: [{ run: { text: 'a' } }, { run: { text: 'b' } }] } } })).toBe('ab');
    expect(await sortParagraphs(api, ['p1', 'p2', 'p3'], 'textAsc')).toBe(2);
    expect(moves).toEqual([['p2', 'before', 'p1'], ['p3', 'after', 'p2']]);
    await expect(sortParagraphs(api, ['p1'], 'textAsc')).rejects.toThrow('at least two');
    await expect(sortParagraphs({ ...api, blocks: { move: async () => ({ success: false, failure: { message: 'stuck' } }) } }, ['p1', 'p2'], 'textAsc')).rejects.toThrow('stuck');
  });

  it('leaves every paragraph in place if reading any selected paragraph fails', async () => {
    const move = vi.fn(async () => ({ success: true }));
    const api = {
      getNodeById: async ({ nodeId }) => {
        if (nodeId === 'p2') throw new Error('The paragraph could not be read');
        return { node: { paragraph: { inlines: [{ run: { text: 'Apple' } }] } } };
      },
      blocks: { move },
    };
    await expect(sortParagraphs(api, ['p1', 'p2'], 'textAsc')).rejects.toThrow('could not be read');
    expect(move).not.toHaveBeenCalled();
  });
});

describe('sort progress', () => {
  it('reports each move as it is made, out of the total, before and after', async () => {
    const texts = { a: 'c', b: 'b', c: 'a' };
    const api = { getNodeById: async ({ nodeId }) => ({ node: { paragraph: { inlines: [{ run: { text: texts[nodeId] } }] } } }), blocks: { move: vi.fn(async () => ({ success: true })) } };
    const progress = [];
    const moved = await sortParagraphs(api, ['a', 'b', 'c'], 'textAsc', { onProgress: (done, total) => progress.push([done, total]) });
    expect(moved).toBe(progress.at(-1)[1]);
    expect(progress[0]).toEqual([0, moved]);
    expect(progress.at(-1)).toEqual([moved, moved]);
    expect(progress.length).toBe(moved + 1);
  });
});
