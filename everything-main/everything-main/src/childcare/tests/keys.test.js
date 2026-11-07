import { describe, it, expect } from 'vitest';
import { metaSlot, nameFromSlot, isValidName, flattenMeta, bumpPlan, metaKeysFor, splitName } from '../src/core/keys.js';

describe('key layout', () => {
  it('maps every name to a safe meta slot and back', () => {
    for (const n of ['students', 'settings', 'activities:2026-10-12', 'attendance:2026-01-31', 'messages:abc123xyz']) {
      const { key, path } = metaSlot(n);
      expect(path).toMatch(/^[A-Za-z0-9]+$/);
      expect(nameFromSlot(key, path)).toBe(n);
    }
  });

  it('validates names', () => {
    expect(isValidName('students')).toBe(true);
    expect(isValidName('activities:2026-10-12')).toBe(true);
    expect(isValidName('activities:2026-1-2')).toBe(false);
    expect(isValidName('messages:abc-def')).toBe(false);
    expect(isValidName('notes:x')).toBe(false);
    expect(isValidName('studentz')).toBe(false);
  });

  it('groups bumps by meta item and flattens them back', () => {
    const plan = bumpPlan(['students', 'activities:2026-10-12', 'activities:2026-10-13', 'messages:k1']);
    expect(plan).toEqual({ 'cc1:meta': { students: 1 }, 'cc1:meta:d:2026-10': { activities12: 1, activities13: 1 }, 'cc1:meta:m': { tk1: 1 } });
    expect(flattenMeta(plan)).toEqual({ students: 1, 'activities:2026-10-12': 1, 'activities:2026-10-13': 1, 'messages:k1': 1 });
    expect(metaKeysFor(['attendance:2026-09-30'])).toEqual(['cc1:meta', 'cc1:meta:d:2026-09']);
    expect(splitName('messages:k1')).toEqual({ base: 'messages', key: 'k1' });
  });
});
