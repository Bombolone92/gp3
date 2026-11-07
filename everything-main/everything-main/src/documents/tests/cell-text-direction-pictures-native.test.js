import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const folder = new URL('./fixtures/cell-text-direction/', import.meta.url);
const evidence = JSON.parse(readFileSync(new URL('pictures-reference.json', folder)));
it('retains authored picture orientation and dimensions under both native cell rotations', () => {
  for (const control of evidence.cases) {
    for (const [file, hash] of Object.entries(control.hashes)) expect(createHash('sha256').update(readFileSync(new URL(file, folder))).digest('hex')).toBe(hash);
    expect(control.pictures).toHaveLength(3);
    const [width, height] = control.name === 'links-tall' ? [18, 36] : [36, 18];
    for (const picture of control.pictures) {
      expect(picture.width).toBeCloseTo(width, 3);
      expect(picture.height).toBeCloseTo(height, 3);
    }
    expect(control.links.filter(link => link.target.endsWith('-image'))).toHaveLength(3);
  }
});
it('moves rotated pictures across the cell for vertical alignment while keeping their physical top position', () => {
  const cases = Object.fromEntries(evidence.cases.map(control => [control.name, control.pictures]));
  for (const index of [1, 2]) {
    const top = cases.links[index], center = cases['links-center'][index], bottom = cases['links-bottom'][index];
    expect(center.y).toBe(top.y); expect(bottom.y).toBe(top.y);
    expect(center.x - top.x).toBeCloseTo((bottom.x - top.x) / 2, 3);
    expect(Math.abs(bottom.x - top.x)).toBeGreaterThan(40);
  }
});
it('advances inline pictures physically down for a text prefix in both rotations', () => {
  const plain = evidence.cases.find(c => c.name === 'links').pictures;
  const prefixed = evidence.cases.find(c => c.name === 'links-inline').pictures;
  for (const index of [1, 2]) {
    expect(prefixed[index].x).toBe(plain[index].x);
    expect(prefixed[index].y - plain[index].y).toBeCloseTo(9.45, 2);
  }
});
