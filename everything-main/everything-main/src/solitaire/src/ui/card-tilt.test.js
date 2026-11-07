import { describe, it, expect } from 'vitest';
import { tiltFor } from './card-tilt.js';
import { newDeck } from '../game/deck.js';

describe('tiltFor', () => {
  it('is deterministic for the same id', () => {
    expect(tiltFor('♠K')).toBe(tiltFor('♠K'));
    expect(tiltFor('♦10')).toBe(tiltFor('♦10'));
  });

  it('stays within plus or minus 0.6 degrees', () => {
    for (const c of newDeck()) {
      expect(Math.abs(tiltFor(c.id))).toBeLessThanOrEqual(0.6);
    }
  });

  it('is never NaN', () => {
    for (const c of newDeck()) expect(Number.isNaN(tiltFor(c.id))).toBe(false);
  });

  it('normalizes a negative hash — the guard is not decorative', () => {
    // Real card ids are too short to overflow to a negative 32-bit hash, so this
    // synthetic id is the only thing standing between the double modulo and a
    // well-meaning "simplification".  Without ((h % 100) + 100) % 100 this
    // returns -1.182, well outside the documented range.
    expect(Math.abs(tiltFor('IAAAAA'))).toBeLessThanOrEqual(0.6);
  });

  it('gives different cards different tilts', () => {
    const values = new Set(newDeck().map(c => tiltFor(c.id)));
    expect(values.size).toBeGreaterThan(20);
  });

  it('returns 0 for an empty id', () => {
    expect(tiltFor('')).toBe(0);
  });
});
