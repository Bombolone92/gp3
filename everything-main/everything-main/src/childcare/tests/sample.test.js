import { describe, it, expect } from 'vitest';
import { buildSampleData } from '../src/core/sample.js';
import { isValidName } from '../src/core/keys.js';
import { roomRatios } from '../src/core/attendance.js';

describe('sample school', () => {
  const data = buildSampleData('2026-10-12', { now: new Date(2026, 9, 12, 14, 0) });

  it('only uses valid collection and partition names', () => {
    for (const name of Object.keys(data.collections)) expect(isValidName(name), name).toBe(true);
  });

  it('is deterministic for a day', () => {
    const again = buildSampleData('2026-10-12', { now: new Date(2026, 9, 12, 14, 0) });
    expect(again.collections.students.map((s) => s.firstName)).toEqual(data.collections.students.map((s) => s.firstName));
  });

  it('never logs anything after the current time today', () => {
    for (const a of data.collections['activities:2026-10-12'] || []) expect(a.at <= '14:00', a.at).toBe(true);
  });

  it('links every family member to existing children and keeps rooms in ratio', () => {
    const ids = new Set(data.collections.students.map((s) => s.id));
    for (const g of data.collections.guardians) for (const id of g.studentIds) expect(ids.has(id)).toBe(true);
    const { rows } = roomRatios(data.collections.rooms, data.collections['attendance:2026-10-12']);
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(data.demoFamily.studentIds.length).toBeGreaterThan(0);
  });
});
