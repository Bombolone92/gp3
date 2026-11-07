import { describe, it, expect } from 'vitest';
import { foldRows } from '../src/charts/ownership.js';

const row = (name, shares, pct) => ({ name, shares, pct });

describe('foldRows', () => {
  it('keeps every row, in order, while they fit the slots', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`H${i}`, 100 - i, 0.125));
    const out = foldRows(rows);
    expect(out.map((r) => r.name)).toEqual(rows.map((r) => r.name));
    expect(out.some((r) => r.folded)).toBe(false);
    expect(new Set(out.map((r) => r.color)).size).toBe(8);
  });

  it('folds the smallest rows into Other, not the last ones', () => {
    // Holder rows come sorted by size with the pool appended last.
    const rows = [
      row('Ada', 3_800_000, 0.35), row('Grace', 3_400_000, 0.31), row('Nova', 1_470_588, 0.14),
      row('Beacon', 588_235, 0.05), row('Sam', 120_000, 0.011), row('Priya', 90_000, 0.008),
      row('Harbor', 60_000, 0.0055), row('Lin', 50_000, 0.0046),
      row('Option pool (unallocated)', 1_240_000, 0.115),
    ];
    const out = foldRows(rows);
    expect(out.map((r) => r.name)).toEqual([
      'Ada', 'Grace', 'Nova', 'Beacon', 'Sam', 'Priya', 'Option pool (unallocated)', 'Other (2)',
    ]);
    const other = out[out.length - 1];
    expect(other.folded).toBe(true);
    expect(other.shares).toBe(110_000);
    expect(other.pct).toBeCloseTo(0.0101, 6);
    expect(other.color).toBe('var(--series-mute)');
  });

  it('breaks a tie on size by position', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`H${i}`, 10, 0.1));
    const out = foldRows(rows);
    expect(out.map((r) => r.name)).toEqual(['H0', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'Other (3)']);
  });
});
