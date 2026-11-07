import { describe, it, expect } from 'vitest';
import { History, HISTORY_LIMIT } from '../src/lib/history.js';

/** A tiny world to move things around in, so entries have something to undo. */
function world() {
  const state = { column: 'todo' };
  const move = (to) => {
    const from = state.column;
    state.column = to;
    return { label: `move to ${to}`, undo: () => { state.column = from; }, redo: () => { state.column = to; } };
  };
  return { state, move };
}

describe('History', () => {
  it('undoes the last thing, and can do it again', () => {
    const { state, move } = world();
    const h = new History();
    h.push(move('doing'));
    expect(state.column).toBe('doing');

    expect(h.undo().label).toBe('move to doing');
    expect(state.column).toBe('todo');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    h.redo();
    expect(state.column).toBe('doing');
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it('walks back through several entries, newest first', () => {
    const { state, move } = world();
    const h = new History();
    h.push(move('doing'));
    h.push(move('review'));
    h.push(move('done'));

    expect(h.undoLabel).toBe('move to done');
    h.undo();
    expect(state.column).toBe('review');
    h.undo();
    expect(state.column).toBe('doing');
    h.undo();
    expect(state.column).toBe('todo');
    expect(h.undo()).toBe(null);
  });

  it('drops the redo future as soon as something new happens', () => {
    const { state, move } = world();
    const h = new History();
    h.push(move('doing'));
    h.undo();
    expect(h.canRedo).toBe(true);

    h.push(move('review'));
    expect(h.canRedo).toBe(false);
    expect(state.column).toBe('review');
  });

  it('says what pressing undo or redo would do', () => {
    const { move } = world();
    const h = new History();
    expect(h.undoLabel).toBe(null);
    expect(h.redoLabel).toBe(null);
    h.push(move('doing'));
    expect(h.undoLabel).toBe('move to doing');
    h.undo();
    expect(h.redoLabel).toBe('move to doing');
  });

  it('stays bounded, forgetting the oldest step first', () => {
    const h = new History({ limit: 3 });
    const seen = [];
    for (const n of [1, 2, 3, 4]) {
      h.push({ label: `step ${n}`, undo: () => seen.push(n), redo: () => {} });
    }
    expect(h.depth).toBe(3);
    h.undo(); h.undo(); h.undo();
    expect(seen).toEqual([4, 3, 2]); // step 1 fell off the end
    expect(h.canUndo).toBe(false);
    expect(new History().depth).toBe(0);
    expect(HISTORY_LIMIT).toBeGreaterThan(1);
  });

  it('keeps an entry that cannot be redone out of the redo stack', () => {
    const h = new History();
    let undone = false;
    h.push({ label: 'one-way change', undo: () => { undone = true; } });
    h.undo();
    expect(undone).toBe(true);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(null);
  });

  it('refuses an entry with nothing to undo', () => {
    const h = new History();
    expect(h.push({ label: 'nothing' })).toBe(null);
    expect(h.canUndo).toBe(false);
  });

  it('forgets everything when the ground moves', () => {
    const { move } = world();
    const h = new History();
    h.push(move('doing'));
    h.undo();
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undoLabel).toBe(null);
  });
});
