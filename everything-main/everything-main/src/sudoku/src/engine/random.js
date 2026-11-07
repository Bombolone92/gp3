/**
 * Seeded pseudo-randomness.
 *
 * Generation must be reproducible for two reasons: the daily puzzle has to be
 * the same board for everyone who opens it on that date, and the generator
 * tests would be untestable if every run produced a different grid. So nothing
 * in the engine touches Math.random: a seed comes in, a generator goes out.
 */

/**
 * Hash a string to a 32-bit seed. FNV-1a: short, no dependencies, and spreads
 * near-identical inputs ("2026-08-21" vs "2026-08-22") far apart.
 * @param {string} text
 * @returns {number} An unsigned 32-bit integer.
 */
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A mulberry32 generator: 32 bits of state, good enough distribution for
 * shuffling a Sudoku grid, and identical across engines.
 * @param {number|string} seed
 * @returns {() => number} Successive values in [0, 1).
 */
export function createRng(seed) {
  let state = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An integer in [0, max). */
export const randomInt = (rng, max) => Math.floor(rng() * max);

/** A new array holding `items` in a shuffled order (Fisher-Yates). */
export function shuffled(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
