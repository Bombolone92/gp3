import { describe, it, expect } from 'vitest';
import { buildSampleData } from '../src/core/sample.js';

describe('sample fleet meters', () => {
  for (const today of ['2026-10-12', '2026-03-31', '2027-01-01']) {
    it(`never goes backwards in the meter history (${today})`, () => {
      const { collections: c } = buildSampleData(today);
      const readings = new Map();
      for (const m of c.meters) readings.set(m.vehicleId, [...(readings.get(m.vehicleId) || []), m]);
      for (const s of c.inspections) if (s.meter != null) readings.get(s.vehicleId).push({ date: s.date, value: s.meter, source: { type: 'inspection' } });
      const backwards = [];
      for (const [vid, list] of readings) {
        list.sort((a, b) => a.date.localeCompare(b.date) || a.value - b.value);
        for (let i = 1; i < list.length; i++) if (list[i].value < list[i - 1].value) backwards.push(`${vid} ${list[i - 1].date} ${list[i - 1].value} > ${list[i].date} ${list[i].value} (${list[i].source?.type})`);
      }
      expect(backwards).toEqual([]);
    });
  }
});
