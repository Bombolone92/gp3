import { describe, it, expect } from 'vitest';
import { single, fromRange, selRange, isSingle, move, extend, jump, advance, retreat, selectAll, selectRows, selectCols } from '../src/core/selection.js';

const bounds = { rows: 10, cols: 5 };

describe('selection', () => {
  it('starts as a single cell and normalizes ranges', () => {
    const s = single(2, 3);
    expect(isSingle(s)).toBe(true);
    expect(selRange(s)).toEqual({ r1: 2, c1: 3, r2: 2, c2: 3 });
    const f = fromRange({ r1: 3, c1: 2, r2: 1, c2: 0 });
    expect(selRange(f)).toEqual({ r1: 1, c1: 0, r2: 3, c2: 2 });
    expect(f.active).toEqual({ r: 1, c: 0 });
  });

  it('moves within bounds and collapses the range', () => {
    const s = extend(single(0, 0), 2, 2, bounds);
    expect(isSingle(s)).toBe(false);
    const m = move(s, -5, 1, bounds);
    expect(m).toEqual(single(0, 1));
    expect(move(single(9, 4), 1, 1, bounds)).toEqual(single(9, 4));
  });

  it('extends from the anchor without moving the active cell', () => {
    let s = single(1, 1);
    s = extend(s, 2, 0, bounds);
    s = extend(s, 0, -1, bounds);
    expect(s.active).toEqual({ r: 1, c: 1 });
    expect(selRange(s)).toEqual({ r1: 1, c1: 0, r2: 3, c2: 1 });
  });

  it('jumps to data edges like Ctrl+Arrow', () => {
    const filled = new Set(['0,0', '1,0', '2,0', '5,0', '6,0']);
    const has = (r, c) => filled.has(`${r},${c}`);
    expect(jump(single(0, 0), 1, 0, bounds, has).active).toEqual({ r: 2, c: 0 }); // end of block
    expect(jump(single(2, 0), 1, 0, bounds, has).active).toEqual({ r: 5, c: 0 }); // next block
    expect(jump(single(6, 0), 1, 0, bounds, has).active).toEqual({ r: 9, c: 0 }); // sheet edge
    expect(jump(single(9, 0), -1, 0, bounds, has).active).toEqual({ r: 6, c: 0 });
    expect(jump(single(0, 1), 0, 1, bounds, has).active).toEqual({ r: 0, c: 4 });
    expect(jump(single(9, 4), 1, 0, bounds, has).active).toEqual({ r: 9, c: 4 });
  });

  it('walks Enter and Tab through a multi-cell selection', () => {
    let s = fromRange({ r1: 0, c1: 0, r2: 1, c2: 1 });
    s = advance(s, 'down', bounds);
    expect(s.active).toEqual({ r: 1, c: 0 });
    s = advance(s, 'down', bounds);
    expect(s.active).toEqual({ r: 0, c: 1 });
    s = advance(s, 'down', bounds);
    s = advance(s, 'down', bounds);
    expect(s.active).toEqual({ r: 0, c: 0 }); // wrapped
    s = advance(s, 'right', bounds);
    expect(s.active).toEqual({ r: 0, c: 1 });
    s = advance(s, 'right', bounds);
    expect(s.active).toEqual({ r: 1, c: 0 });
    s = retreat(s, 'right', bounds);
    expect(s.active).toEqual({ r: 0, c: 1 });
    expect(selRange(s)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 });
  });

  it('advances a single cell like an arrow key', () => {
    expect(advance(single(0, 0), 'down', bounds)).toEqual(single(1, 0));
    expect(advance(single(0, 0), 'right', bounds)).toEqual(single(0, 1));
    expect(retreat(single(0, 0), 'down', bounds)).toEqual(single(0, 0));
  });

  it('selects whole rows, columns, and everything', () => {
    expect(selRange(selectAll(bounds))).toEqual({ r1: 0, c1: 0, r2: 9, c2: 4 });
    expect(selRange(selectRows(2, 3, bounds))).toEqual({ r1: 2, c1: 0, r2: 3, c2: 4 });
    expect(selRange(selectCols(1, 1, bounds))).toEqual({ r1: 0, c1: 1, r2: 9, c2: 1 });
  });
});

it('retains explicit header intent while walking and extending along the selected axis', () => {
  const columns = selectCols(1, 2, bounds), rows = selectRows(2, 3, bounds);
  expect(selRange(columns, true).scope).toBe('columns');
  expect(selRange(fromRange(selRange(columns)), true).scope).toBeUndefined();
  expect(advance(columns, 'down', bounds).scope).toBe('columns');
  expect(retreat(rows, 'right', bounds).scope).toBe('rows');
  expect(extend(columns, 0, 1, bounds).scope).toBe('columns');
  expect(extend(columns, -1, 0, bounds).scope).toBeUndefined();
  expect(extend(selectAll(bounds), 0, -1, bounds).scope).toBe('columns');
});
