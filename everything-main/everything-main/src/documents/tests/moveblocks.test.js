// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { documentBlockOrder, moveForSelection, moveParagraphs } from '../src/lib/moveblocks.js';

describe('documentBlockOrder', () => {
  it('reads block ids in order, deduping page splits', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div data-source-node-id="a"></div>
      <div data-source-node-id="b"></div>
      <div data-source-node-id="b"></div>
      <div data-source-node-id="c"></div>
      <div data-source-node-id="a"></div>
      <div data-source-node-id=""></div>`;
    expect(documentBlockOrder(host)).toEqual(['a', 'b', 'c']);
    expect(documentBlockOrder(null)).toEqual([]);
  });
});

describe('moveForSelection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('moves a single paragraph up and down by stepping its neighbour over it', () => {
    expect(moveForSelection(order, ['c'], 'up')).toEqual({ source: 'b', destination: 'c', placement: 'after' });
    expect(moveForSelection(order, ['c'], 'down')).toEqual({ source: 'd', destination: 'c', placement: 'before' });
  });

  it('moves a span of selected paragraphs together', () => {
    expect(moveForSelection(order, ['b', 'c'], 'up')).toEqual({ source: 'a', destination: 'c', placement: 'after' });
    expect(moveForSelection(order, ['b', 'c'], 'down')).toEqual({ source: 'd', destination: 'b', placement: 'before' });
    // Out-of-order ids resolve to the min/max positions.
    expect(moveForSelection(order, ['d', 'b'], 'up')).toEqual({ source: 'a', destination: 'd', placement: 'after' });
  });

  it('returns null at the edges and for unknown selections', () => {
    expect(moveForSelection(order, ['a'], 'up')).toBeNull();
    expect(moveForSelection(order, ['e'], 'down')).toBeNull();
    expect(moveForSelection(order, ['a', 'b'], 'up')).toBeNull();
    expect(moveForSelection(order, ['x'], 'up')).toBeNull();
    expect(moveForSelection([], ['a'], 'up')).toBeNull();
    expect(moveForSelection(order, ['c'], 'sideways')).toBeNull();
  });
});

describe('moveParagraphs', () => {
  const list = async () => ({ blocks: ['a', 'b', 'c'].map((nodeId) => ({ nodeId, nodeType: 'paragraph' })) });
  function host(ids) {
    const h = document.createElement('div');
    h.innerHTML = ids.map((id) => `<div data-source-node-id="${id}"></div>`).join('');
    return h;
  }

  it('calls blocks.move with block addresses and returns the move', async () => {
    const calls = [];
    const api = { blocks: { list, move: async (m) => { calls.push(m); return { success: true }; } } };
    const move = await moveParagraphs(api, host(['a', 'b', 'c']), ['b'], 'down');
    expect(move).toEqual({ source: 'c', destination: 'b', placement: 'before' });
    expect(calls[0]).toEqual({
      source: { kind: 'block', nodeType: 'paragraph', nodeId: 'c' },
      destination: { kind: 'block', nodeType: 'paragraph', nodeId: 'b' },
      placement: 'before',
    });
  });

  it('does nothing at an edge and throws when the engine refuses', async () => {
    const api = { blocks: { list, move: async () => ({ success: true }) } };
    expect(await moveParagraphs(api, host(['a', 'b']), ['a'], 'up')).toBeNull();
    expect(await moveParagraphs({ blocks: null }, host(['a']), ['a'], 'up')).toBeNull();
    expect(await moveParagraphs(api, host(['a']), [], 'up')).toBeNull();
    const bad = { blocks: { list, move: async () => ({ success: false, failure: { message: 'no' } }) } };
    await expect(moveParagraphs(bad, host(['a', 'b', 'c']), ['b'], 'up')).rejects.toThrow('no');
  });

  it('does not move a partial selection or fall back to painted order after a failed read', async () => {
    const move = vi.fn();
    const api = { blocks: { list, move } };
    await expect(moveParagraphs(api, host(['a', 'b']), ['b', 'missing'], 'up')).rejects.toThrow('all selected paragraphs');
    api.blocks.list = async () => { throw new Error('Read failed'); };
    await expect(moveParagraphs(api, host(['a', 'b']), ['b'], 'up')).rejects.toThrow('Read failed');
    expect(move).not.toHaveBeenCalled();
  });

  it('keeps the order read and movement in the selected story', async () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '1' };
    const api = { blocks: { list: vi.fn(list), move: vi.fn(async () => ({ success: true })) } };
    await moveParagraphs(api, null, ['b'], 'up', { story });
    expect(api.blocks.list).toHaveBeenCalledWith({ in: story });
    expect(api.blocks.move).toHaveBeenCalledWith({ source: { kind: 'block', nodeType: 'paragraph', nodeId: 'a', story }, destination: { kind: 'block', nodeType: 'paragraph', nodeId: 'b', story }, placement: 'after' });
  });

  it('cancels a move if the editor closes during the order read', async () => {
    let finish, active = true;
    const api = { blocks: { list: () => new Promise((resolve) => { finish = resolve; }), move: vi.fn() } };
    const moving = moveParagraphs(api, null, ['b'], 'up', { stillWanted: () => active });
    active = false; finish(await list());
    expect(await moving).toBe(false);
    expect(api.blocks.move).not.toHaveBeenCalled();
  });
});

describe('moveParagraphs', () => {
  it('tells a move called off from one with nothing to move', async () => {
    const api = { blocks: { list: async () => ({ blocks: ['a', 'b', 'c'].map((nodeId) => ({ nodeId, nodeType: 'paragraph' })) }), move: async () => ({ success: true }) } };
    expect(await moveParagraphs(api, null, ['a'], 'up')).toBeNull();
    expect(await moveParagraphs(api, null, ['b'], 'up', { stillWanted: () => false })).toBe(false);
  });
});
