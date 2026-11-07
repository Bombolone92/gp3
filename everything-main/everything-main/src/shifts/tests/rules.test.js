import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_RULES,
  hasRules,
  normalizeRules,
  ruleViolations,
  scheduleRuleViolations,
} from '../src/core/rules.js';
import { suggestAssignees } from '../src/core/scheduling.js';
import { evaluateSwap } from '../src/core/swaps.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const shift = (id, date, start, end, assigneeId = 'e1', breakMinutes = 0) => ({
  id,
  date,
  start,
  end,
  role: 'Floor',
  assigneeId,
  breakMinutes,
});

describe('rule settings', () => {
  it('treats blank, zero, and out-of-range numbers as off', () => {
    expect(normalizeRules(undefined)).toEqual(EMPTY_RULES);
    expect(normalizeRules({ minRestHours: '', maxDailyHours: 0, maxConsecutiveDays: -3 })).toEqual(
      EMPTY_RULES
    );
    expect(normalizeRules({ minRestHours: 25, maxDailyHours: 30, maxConsecutiveDays: 100 })).toEqual(
      EMPTY_RULES
    );
    expect(normalizeRules({ minRestHours: '11' })).toMatchObject({ minRestHours: 11 });
    expect(hasRules(EMPTY_RULES)).toBe(false);
    expect(hasRules({ maxDailyHours: 10 })).toBe(true);
  });

  it('finds nothing when no limit is set', () => {
    const night = shift('s1', '2026-08-17', '22:00', '06:00');
    const morning = shift('s2', '2026-08-18', '10:00', '18:00');
    expect(ruleViolations(morning, 'e1', [night], EMPTY_RULES)).toEqual([]);
  });
});

describe('minimum rest between shifts', () => {
  it('checks overnight shifts whose start dates are two days apart', () => {
    const night = shift('s1', '2026-08-17', '22:00', '10:00');
    const early = shift('s2', '2026-08-19', '06:00', '14:00');
    // The night ends on the 18th: only 20 hours until the next start.
    for (const [candidate, existing] of [[night, early], [early, night]]) {
      const found = ruleViolations(candidate, 'e1', [existing], { minRestHours: 24 });
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('20h rest');
      expect(ruleViolations(candidate, 'e1', [existing], { minRestHours: 20 })).toEqual([]);
    }
  });

  it('catches a 22:00 to 06:00 night followed by a 10:00 start', () => {
    const night = shift('s1', '2026-08-17', '22:00', '06:00');
    const morning = shift('s2', '2026-08-18', '10:00', '18:00');
    const found = ruleViolations(morning, 'e1', [night], { minRestHours: 11 }, { name: 'Ava' });
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('rest');
    expect(found[0].message).toContain('4h rest');
    expect(found[0].message).toContain('11h minimum');
  });

  it('measures the gap in both directions and passes a long enough one', () => {
    const evening = shift('s1', '2026-08-17', '14:00', '22:00');
    const nextMorning = shift('s2', '2026-08-18', '09:00', '17:00');
    // 11 hours exactly: the minimum is met, so nothing to say.
    expect(ruleViolations(nextMorning, 'e1', [evening], { minRestHours: 11 })).toEqual([]);
    expect(ruleViolations(evening, 'e1', [nextMorning], { minRestHours: 11 })).toEqual([]);
    expect(ruleViolations(nextMorning, 'e1', [evening], { minRestHours: 12 })).toHaveLength(1);
  });

  it('says "back to back" when one shift ends as the next begins', () => {
    const early = shift('s1', '2026-08-17', '06:00', '14:00');
    const late = shift('s2', '2026-08-17', '14:00', '22:00');
    const found = ruleViolations(late, 'e1', [early], { minRestHours: 10 }, { name: 'Ava' });
    expect(found[0].message).toMatch(/back to back/);
  });

  it('leaves overlaps to the conflict check instead of reporting them twice', () => {
    const a = shift('s1', '2026-08-17', '09:00', '17:00');
    const b = shift('s2', '2026-08-17', '12:00', '20:00');
    expect(ruleViolations(b, 'e1', [a], { minRestHours: 11 }).some((v) => v.rule === 'rest')).toBe(
      false
    );
  });

  it('ignores other people’s shifts and the shift itself', () => {
    const mine = shift('s1', '2026-08-17', '22:00', '06:00');
    const theirs = shift('s2', '2026-08-18', '08:00', '16:00', 'e2');
    expect(ruleViolations(shift('s3', '2026-08-18', '10:00', '18:00'), 'e1', [theirs], { minRestHours: 11 })).toEqual(
      []
    );
    // Re-checking a saved shift excludes its own record by id.
    expect(ruleViolations(mine, 'e1', [mine], { minRestHours: 11 })).toEqual([]);
  });
});

describe('maximum hours in a day', () => {
  it('adds up a day split across two shifts, net of breaks', () => {
    const first = shift('s1', '2026-08-17', '06:00', '13:00');
    const second = shift('s2', '2026-08-17', '14:00', '21:00', 'e1', 30);
    const found = ruleViolations(second, 'e1', [first], { maxDailyHours: 12 }, { name: 'Ava' });
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('13.5h');
    expect(found[0].message).toContain('12h daily limit');
    // The same pair inside a 14-hour limit is fine.
    expect(ruleViolations(second, 'e1', [first], { maxDailyHours: 14 })).toEqual([]);
  });
});

describe('maximum consecutive days', () => {
  const run = (count, from = '2026-08-10') =>
    Array.from({ length: count }, (_, i) => {
      const day = new Date(2026, 7, Number(from.slice(8)) + i);
      const iso = `2026-08-${String(day.getDate()).padStart(2, '0')}`;
      return shift(`r${i}`, iso, '09:00', '17:00');
    });

  it('counts the run the new shift joins, in both directions', () => {
    const existing = run(6); // Aug 10 to Aug 15
    const seventh = shift('new', '2026-08-16', '09:00', '17:00');
    const found = ruleViolations(seventh, 'e1', existing, { maxConsecutiveDays: 6 }, { name: 'Ava' });
    expect(found).toHaveLength(1);
    expect(found[0].short).toBe('7 days in a row');

    // A shift that bridges two runs counts both sides.
    const split = [...run(3), ...run(3, '2026-08-14')]; // 10-12 and 14-16
    const bridge = shift('new', '2026-08-13', '09:00', '17:00');
    expect(
      ruleViolations(bridge, 'e1', split, { maxConsecutiveDays: 6 })[0].short
    ).toBe('7 days in a row');
  });

  it('says nothing while the run is within the limit', () => {
    expect(ruleViolations(shift('new', '2026-08-16', '09:00', '17:00'), 'e1', run(6), {
      maxConsecutiveDays: 7,
    })).toEqual([]);
  });
});

describe('scheduleRuleViolations', () => {
  it('reports one entry per broken rule across the visible days', () => {
    const shifts = [
      shift('s1', '2026-08-17', '22:00', '06:00'),
      shift('s2', '2026-08-18', '10:00', '18:00'),
      shift('s3', '2026-08-19', '10:00', '18:00'),
    ];
    const dates = ['2026-08-17', '2026-08-18', '2026-08-19'];
    const found = scheduleRuleViolations('e1', shifts, dates, { minRestHours: 11, maxDailyHours: 20 });
    expect(found.map((v) => v.rule)).toEqual(['rest']);
    expect(scheduleRuleViolations('e1', shifts, dates, EMPTY_RULES)).toEqual([]);
  });
});

describe('suggestAssignees with limits set', () => {
  const employees = [
    { id: 'e1', name: 'Ava', role: 'Floor', active: true },
    { id: 'e2', name: 'Liam', role: 'Floor', active: true },
  ];
  const availability = {
    e1: { days: Array.from({ length: 7 }, () => ({ off: false, start: '00:00', end: '23:59' })), exceptions: [] },
    e2: { days: Array.from({ length: 7 }, () => ({ off: false, start: '00:00', end: '23:59' })), exceptions: [] },
  };

  it('demotes whoever would break a limit instead of excluding them', () => {
    // Ava worked until 06:00 this morning; the open shift starts at 10:00.
    const shifts = [shift('s1', '2026-08-17', '22:00', '06:00', 'e1')];
    const open = { id: 'open', date: '2026-08-18', start: '10:00', end: '18:00', role: 'Floor', assigneeId: null };
    const ranked = suggestAssignees(
      open,
      { employees, shifts, availability, rules: { minRestHours: 11 } },
      5
    );
    expect(ranked.map((c) => c.employee.id)).toEqual(['e2', 'e1']);
    expect(ranked[1].ruleWarnings).toHaveLength(1);
    expect(ranked[1].reasons).toContain('Short rest');
    // Without the rule the two are ranked by the usual keys, by name.
    const plain = suggestAssignees(open, { employees, shifts, availability }, 5);
    expect(plain.map((c) => c.employee.id)).toEqual(['e1', 'e2']);
  });
});

describe('evaluateSwap with limits set', () => {
  it('warns without refusing when the receiving employee breaks one', () => {
    const shifts = [
      shift('s1', '2026-08-17', '22:00', '06:00', 'e2'),
      shift('s2', '2026-08-18', '10:00', '18:00', 'e1'),
    ];
    const { ok, warnings } = evaluateSwap({
      shift: shifts[1],
      toEmployeeId: 'e2',
      shifts,
      availability: {},
      employees: [{ id: 'e2', name: 'Liam', active: true }],
      rules: { minRestHours: 11 },
    });
    expect(ok).toBe(false);
    expect(warnings.some((w) => /rest/.test(w))).toBe(true);
  });
});

describe('store.updateRules', () => {
  let store;
  let backend;

  beforeEach(async () => {
    backend = createMemoryBackend();
    store = createStore(backend, { now: () => '2026-08-04T09:00:00.000Z', today: () => '2026-08-04' });
    await store.init();
  });

  it('starts off, saves numbers, and turns a limit back off with a blank', async () => {
    expect(store.state.settings.rules).toEqual(EMPTY_RULES);

    await store.updateRules({ minRestHours: '11', maxConsecutiveDays: 6 });
    expect(store.state.settings.rules).toEqual({
      minRestHours: 11,
      maxDailyHours: null,
      maxConsecutiveDays: 6,
    });
    expect(backend.peek('settings').rules.minRestHours).toBe(11);

    await store.updateRules({ minRestHours: '' });
    expect(store.state.settings.rules.minRestHours).toBeNull();
    expect(store.state.settings.rules.maxConsecutiveDays).toBe(6);
  });

  it('rejects a number no limit could mean, leaving the rest alone', async () => {
    await store.updateRules({ maxDailyHours: 12 });
    await expect(store.updateRules({ maxDailyHours: 40 })).rejects.toThrow(/between 1 and 24/);
    await expect(store.updateRules({ minRestHours: 0 })).rejects.toThrow(/between 1 and 24/);
    await expect(store.updateRules({ nonsense: 3 })).rejects.toThrow(/Unknown rule/);
    expect(store.state.settings.rules.maxDailyHours).toBe(12);
  });

  it('survives a reload', async () => {
    await store.updateRules({ maxConsecutiveDays: 5 });
    const rehydrated = createStore(backend);
    await rehydrated.init();
    expect(rehydrated.state.settings.rules).toEqual({
      minRestHours: null,
      maxDailyHours: null,
      maxConsecutiveDays: 5,
    });
  });
});
