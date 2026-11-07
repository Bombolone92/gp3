import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = new URL('./fixtures/cell-text-direction/', import.meta.url);
function reference(name) {
  const result = JSON.parse(readFileSync(new URL(`${name}-reference.json`, folder)));
  for (const [file, hash] of Object.entries(result.hashes)) {
    expect(createHash('sha256').update(readFileSync(new URL(file, folder))).digest('hex')).toBe(hash);
  }
  return result.pages;
}
function rowHeight(page) {
  // Each independent page contains one table with two cells. Border paths,
  // unlike text bounds, retain the allocated row when its text is clipped.
  const edges = [...new Set(page.pathBounds
    .filter(([left, bottom, right, top]) => right - left > 10 && top - bottom < 2)
    .map(([, bottom, , top]) => (bottom + top) / 2))].sort((a, b) => b - a);
  expect(edges).toHaveLength(2);
  return edges[0] - edges[1];
}

describe('independent native reference evidence for automatic rotated-only rows', () => {
  it('does not grow with text length or narrower columns', () => {
    const pages = reference('automatic');
    expect(pages).toHaveLength(4);
    const heights = pages.map(rowHeight);
    for (const height of heights) expect(height).toBeCloseTo(37.08, 2);
    expect(pages[3].runs.filter(run => Math.abs(run.tm[1]) > .9).length)
      .toBeGreaterThan(pages[0].runs.filter(run => Math.abs(run.tm[1]) > .9).length);
  });

  it('uses the final paragraph mark, line rule and after-spacing rather than accumulated content', () => {
    const pages = reference('height');
    expect(pages).toHaveLength(20);
    const heights = pages.map(rowHeight);
    // Text size, empty/nonempty content, glyph width, font and a preceding
    // paragraph do not change the height of an exact-12pt terminal mark.
    for (const index of [1, 2, 3, 7, 8, 9, 10, 15, 17, 18]) {
      expect(heights[index]).toBeCloseTo(heights[0], 4);
    }
    for (const index of [4, 11, 16, 19]) {
      expect(heights[index] - heights[0]).toBeCloseTo(12, 4);
    }
    // With automatic line spacing, run size still has no effect, but the
    // mark's font/size does. These values are native facts, not an engine pass.
    expect(heights[12]).toBeCloseTo(heights[5], 4);
    expect(heights[13]).toBeCloseTo(heights[6], 4);
    expect(heights[13] - heights[5]).toBeCloseTo(11.76, 2);
    expect(heights[14]).toBeLessThan(heights[5]);
  });

  it('isolates additional automatic leading to rotated cells', () => {
    const rotated = reference('height').map(rowHeight);
    const horizontal = reference('height-horizontal').map(rowHeight);
    expect(horizontal).toHaveLength(20);
    const automatic = new Set([5, 6, 12, 13, 14]);
    for (let index = 0; index < rotated.length; index++) {
      if (automatic.has(index)) {
        expect(rotated[index] - horizontal[index]).toBeGreaterThan(.3);
        expect(rotated[index] - horizontal[index]).toBeLessThan(.7);
      } else expect(rotated[index]).toBeCloseTo(horizontal[index], 4);
    }
  });
});
