import { describe, it, expect } from 'vitest';
import { buildSampleData } from '../src/core/sample.js';
import { addDays, localDate } from '../src/core/dates.js';

describe('demo data', () => {
  it('has no payments or records dated after today', () => {
    for (let k = 0; k < 14; k++) {
      const today = addDays('2026-10-12', k);
      const { collections } = buildSampleData(today);
      for (const p of collections.payments) expect(p.date <= today).toBe(true);
      for (const list of Object.values(collections)) for (const r of list) if (r.createdAt) expect(localDate(r.createdAt) <= today).toBe(true);
    }
  });
});
