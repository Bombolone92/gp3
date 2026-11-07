import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder = 'tests/fixtures/cell-text-direction/origin-phase/';
const reference = JSON.parse(readFileSync(folder + 'reference.json'));
const origins = (page, direction) => page.runs.filter(run => run.direction === direction).map(run => run.x);

it('binds the native coordinate investigation to its original source and PDF', () => {
  for (const [name, hash] of Object.entries(reference.hashes)) expect(createHash('sha256').update(readFileSync(folder + name)).digest('hex')).toBe(hash);
  expect(reference.cases.map(({twips}) => twips)).toEqual([0, 1, 2, 3, 4, 5, 10, 20]);
  for (const page of reference.cases) {
    expect(page.runs).toHaveLength(12);
    for (const direction of ['btLr', 'tbRl']) expect(origins(page, direction)).toHaveLength(6);
  }
});

it('records nonmonotonic native top-to-bottom origins rather than assuming a constant offset', () => {
  const [first, second] = reference.cases;
  expect(origins(first, 'tbRl')[2]).toBe(237.05);
  expect(origins(second, 'tbRl')[2]).toBe(236.93);
  expect(origins(second, 'tbRl')[0]).toBeGreaterThan(origins(first, 'tbRl')[0]);
  for (let page = 1; page < reference.cases.length; page++) {
    const before = origins(reference.cases[page - 1], 'btLr');
    origins(reference.cases[page], 'btLr').forEach((x, line) => expect(x).toBeGreaterThanOrEqual(before[line]));
  }
});
