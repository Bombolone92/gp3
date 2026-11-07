import { describe, it, expect } from 'vitest';
import { matches, round2, clamp, uid } from '../src/lib/util.js';

describe('matches', () => {
  it('is case-insensitive', () => {
    expect(matches('Latte', 'lat')).toBe(true);
    expect(matches('latte', 'LAT')).toBe(true);
  });

  it('is accent-insensitive in both directions', () => {
    expect(matches('Café latte', 'cafe')).toBe(true);
    expect(matches('Cafe latte', 'café')).toBe(true);
    expect(matches('Crème brûlée', 'creme brulee')).toBe(true);
  });

  it('matches everything on an empty or blank query', () => {
    expect(matches('anything', '')).toBe(true);
    expect(matches('anything', '   ')).toBe(true);
    expect(matches('anything', null)).toBe(true);
  });

  it('handles missing haystacks and non-matches', () => {
    expect(matches(undefined, 'x')).toBe(false);
    expect(matches('Espresso', 'latte')).toBe(false);
  });
});

describe('round2', () => {
  it('rounds to cents, half away from zero', () => {
    expect(round2(10.126)).toBe(10.13);
    expect(round2(-10.126)).toBe(-10.13);
    expect(round2(3)).toBe(3);
    expect(round2(0)).toBe(0);
  });
});

describe('clamp', () => {
  it('bounds a value on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
});

describe('uid', () => {
  it('produces unique ids in a tight loop', () => {
    const seen = new Set(Array.from({ length: 1000 }, uid));
    expect(seen.size).toBe(1000);
  });
});
