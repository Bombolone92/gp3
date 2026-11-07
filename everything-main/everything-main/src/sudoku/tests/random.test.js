import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, randomInt, shuffled } from '../src/engine/random.js';

describe('hashSeed', () => {
  it('is stable for the same string', () => {
    expect(hashSeed('2026-08-21')).toBe(hashSeed('2026-08-21'));
  });

  it('separates neighbouring dates, so consecutive dailies differ', () => {
    const a = hashSeed('sudoku-daily-2026-08-21-medium');
    const b = hashSeed('sudoku-daily-2026-08-22-medium');
    expect(a).not.toBe(b);
    // Not merely different: far apart, so the generators diverge immediately.
    expect(Math.abs(a - b)).toBeGreaterThan(1000);
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const text of ['', 'a', 'sudoku', '2026-08-21']) {
      const hash = hashSeed(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });
});

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });

  it('accepts a number as readily as a string', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    expect(a()).toBe(b());
  });

  it('diverges for different seeds', () => {
    const a = createRng('one');
    const b = createRng('two');
    expect(a()).not.toBe(b());
  });

  it('stays inside [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 2000; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('spreads roughly evenly across ten buckets', () => {
    const rng = createRng('spread');
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 10000; i++) buckets[Math.floor(rng() * 10)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(800);
      expect(count).toBeLessThan(1200);
    }
  });

  it('survives a zero seed rather than getting stuck', () => {
    const rng = createRng(0);
    const first = rng();
    expect(first).not.toBe(rng());
  });
});

describe('shuffled', () => {
  it('keeps every element exactly once', () => {
    const items = [...Array(20).keys()];
    const result = shuffled(items, createRng('shuffle'));
    expect(result).toHaveLength(items.length);
    expect([...result].sort((a, b) => a - b)).toEqual(items);
  });

  it('does not mutate its input', () => {
    const items = [1, 2, 3, 4, 5];
    shuffled(items, createRng('nomutate'));
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it('actually reorders', () => {
    const items = [...Array(30).keys()];
    expect(shuffled(items, createRng('reorder'))).not.toEqual(items);
  });

  it('is reproducible for a seed', () => {
    const items = [...Array(20).keys()];
    expect(shuffled(items, createRng('same'))).toEqual(shuffled(items, createRng('same')));
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffled([], createRng('x'))).toEqual([]);
    expect(shuffled([7], createRng('x'))).toEqual([7]);
  });
});

describe('randomInt', () => {
  it('stays within bounds', () => {
    const rng = createRng('int');
    for (let i = 0; i < 500; i++) {
      const value = randomInt(rng, 9);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(9);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
