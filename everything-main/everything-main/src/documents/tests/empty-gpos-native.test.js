import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'tests/fixtures/empty-gpos-kerning/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
it('binds the empty-positioning native controls to their actual source and PDF bytes', () => {
  for (const [name, hash] of Object.entries(reference.sha256)) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex'), name).toBe(hash);
  expect(reference.documents.map(d => d.pages)).toEqual([1, 1]);
  expect(reference.documents.map(d => d.rows.length)).toEqual([16, 16]);
});
it('records suppression of legacy pairs with enabled OpenType and ligatures in all four faces', () => {
  const [disabled, enabled] = reference.documents.map(d => d.rows);
  for (const offset of [0, 4, 8, 12]) {
    expect(disabled[offset + 2].x - disabled[offset].x).toBeGreaterThan(5);
    expect(disabled[offset + 3].x).toBeCloseTo(disabled[offset + 2].x, 3);
    expect(enabled[offset + 2].x).toBeCloseTo(disabled[offset + 2].x, 3);
    // Compare with ligatures retained on both sides; bold italic also changes
    // ligature width and must not be compared to the no-ligature control.
    expect(enabled[offset + 3].x).toBeCloseTo(enabled[offset + 1].x, 3);
  }
});
