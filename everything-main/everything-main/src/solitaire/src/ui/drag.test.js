import { describe, it, expect } from 'vitest';
import { pickDropTarget } from './drag.js';

const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });

const PILES = [
  { kind: 'foundation', index: 0, rect: rect(0, 0, 100, 140) },
  { kind: 'foundation', index: 1, rect: rect(120, 0, 100, 140) },
  { kind: 'tableau', index: 0, rect: rect(0, 200, 100, 400) },
  { kind: 'tableau', index: 1, rect: rect(120, 200, 100, 400) },
];

describe('pickDropTarget', () => {
  it('returns the pile directly under the pointer', () => {
    expect(pickDropTarget({ x: 50, y: 70 }, null, PILES))
      .toEqual({ kind: 'foundation', index: 0 });
    expect(pickDropTarget({ x: 150, y: 300 }, null, PILES))
      .toEqual({ kind: 'tableau', index: 1 });
  });

  it('returns null when the pointer is far from everything and there is no ghost', () => {
    expect(pickDropTarget({ x: 900, y: 900 }, null, PILES)).toBe(null);
  });

  it('falls back to the pile with the largest ghost overlap', () => {
    const ghost = rect(105, 190, 100, 140); // straddles both tableau columns
    const target = pickDropTarget({ x: 900, y: 900 }, ghost, PILES);
    expect(target).toEqual({ kind: 'tableau', index: 1 });
  });

  it('falls back to the nearest pile within the tolerance', () => {
    // In the 20px gutter between the two foundations: 5px from foundation 0,
    // 15px from foundation 1, inside neither. Keep it in the gutter — anything
    // past x=120 lands inside foundation 1 and becomes a direct hit instead.
    expect(pickDropTarget({ x: 105, y: 70 }, null, PILES))
      .toEqual({ kind: 'foundation', index: 0 });
  });

  it('ignores every pile beyond the tolerance', () => {
    // 300px below the tableau columns — far outside DROP_TOLERANCE of anything.
    expect(pickDropTarget({ x: 105, y: 900 }, null, PILES)).toBe(null);
  });

  it('returns null for an empty pile list', () => {
    expect(pickDropTarget({ x: 10, y: 10 }, null, [])).toBe(null);
  });

  it('prefers the smaller pile when two directly contain the pointer', () => {
    const overlapping = [
      { kind: 'tableau', index: 0, rect: rect(0, 0, 400, 400) },
      { kind: 'foundation', index: 0, rect: rect(0, 0, 100, 140) },
    ];
    expect(pickDropTarget({ x: 50, y: 50 }, null, overlapping))
      .toEqual({ kind: 'foundation', index: 0 });
  });
});
