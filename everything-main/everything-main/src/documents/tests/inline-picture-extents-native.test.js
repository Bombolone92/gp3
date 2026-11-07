import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'tests/fixtures/inline-picture-extents/';
const reference = JSON.parse(readFileSync(folder + 'reference.json', 'utf8'));
const cases = JSON.parse(readFileSync(folder + 'cases.json', 'utf8'));
const hash = name => createHash('sha256').update(readFileSync(folder + name)).digest('hex');

it('binds the 24 independent native observations to their source, cases and PDF', () => {
  expect(hash('control.docx')).toBe(reference.sourceSha256);
  expect(hash('native.pdf')).toBe(reference.pdfSha256);
  expect(hash('cases.json')).toBe(reference.casesSha256);
  expect(cases).toHaveLength(24);
  expect(reference.observations.map(o => o.case)).toEqual(Array.from({length:24}, (_, i) => i + 1));
  expect(new Set(reference.observations.map(o => o.page)).size).toBe(7);
});

it('records discrete inline frame changes rather than a continuous rotated bounding box', () => {
  const base = reference.observations[0];
  // Native observations at and immediately beside all four boundaries, plus
  // negative/multiple turns, flips, crop and absent/asymmetric saved effects.
  const swapped = new Set([2,3,4,5,6,7,10,11,15,16,17,20,21,22,23,24]);
  for (const o of reference.observations) {
    const edges = cases[o.case - 1].edges || [0,0,0,0];
    const widthChange = (swapped.has(o.case) ? 30 : 0) + edges[0] + edges[2];
    const heightChange = (swapped.has(o.case) ? -30 : 0) + edges[1] + edges[3];
    expect(Math.abs(o.right.x - base.right.x - widthChange)).toBeLessThan(.15);
    expect(Math.abs((o.left.y - o.label.y) - (base.left.y - base.label.y) - heightChange)).toBeLessThan(.15);
    expect(Math.abs(o.after.y - o.left.y - 13.8)).toBeLessThan(.15);
  }
  // At 45 degrees the painted 40-by-70 rectangle is about 77.78pt high,
  // while the native reserved frame is 40pt high. The matrix alone does not
  // establish visible ink: the native reference clips it vertically to the complete line box.
  const matrix = reference.observations[3].imageMatrix;
  expect(Math.abs(matrix[1]) + Math.abs(matrix[3])).toBeGreaterThan(77);
});
