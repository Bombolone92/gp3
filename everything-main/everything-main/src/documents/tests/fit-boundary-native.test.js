import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'tests/fixtures/native-fit-boundary/';
const reference = JSON.parse(readFileSync(root + 'reference.json', 'utf8'));
const cases = JSON.parse(readFileSync(root + 'cases.json', 'utf8'));
it('binds the word-fit observations to the independent source and native PDF', () => {
  for (const [name, hash] of Object.entries(reference.sha256)) {
    expect(createHash('sha256').update(readFileSync(root + name)).digest('hex'), name).toBe(hash);
  }
  expect(reference.pages).toBe(3);
  expect(reference.rows).toHaveLength(cases.length);
  expect(cases).toHaveLength(20);
  for (const [index, row] of reference.rows.entries()) {
    expect(row.case).toBe(index + 1);
    expect(row.lines).toEqual(index < 3 ? ['OPERATIONA', 'L PLAN'] : ['OPERATIONAL', 'PLAN']);
    expect(row.widthTwips).toBeCloseTo(cases[index].mode === 'autofit' ? Math.max(2875, cases[index].width) : cases[index].width, 2);
  }
});
