import { describe, it, expect, beforeEach } from 'vitest';
import { budgetStatus, laborCost } from '../src/core/payroll.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const WEEK = [
  '2026-08-17',
  '2026-08-18',
  '2026-08-19',
  '2026-08-20',
  '2026-08-21',
  '2026-08-22',
  '2026-08-23',
];

const employees = [
  { id: 'e1', name: 'Ava', hourlyRate: 20, active: true },
  { id: 'e2', name: 'Liam', hourlyRate: 10, active: true },
  { id: 'e3', name: 'Theo', hourlyRate: null, active: true },
];

const shift = (id, date, start, end, assigneeId, role = 'Floor', breakMinutes = 0) => ({
  id,
  date,
  start,
  end,
  role,
  assigneeId,
  breakMinutes,
});

describe('laborCost', () => {
  it('prices net hours at each rate and reports partial rate data', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00', 'e1'), // 8h at 20
      shift('s2', '2026-08-17', '09:00', '13:00', 'e2'), // 4h at 10
      shift('s3', '2026-08-17', '09:00', '17:00', 'e3'), // no rate
      shift('s4', '2026-08-17', '09:00', '17:00', null), // open shift
    ];
    const cost = laborCost(shifts, employees, WEEK);
    expect(cost.cost).toBe(200);
    expect(cost.ratedCount).toBe(2);
    expect(cost.employeeCount).toBe(3);
    // Hours count everyone; money only the people with a rate.
    expect(cost.minutes).toBe(8 * 60 + 4 * 60 + 8 * 60);
  });

  it('takes unpaid breaks off the bill', () => {
    const shifts = [shift('s1', '2026-08-17', '09:00', '17:00', 'e1', 'Floor', 30)];
    expect(laborCost(shifts, employees, WEEK).cost).toBe(150);
  });

  it('leaves the total alone when no overtime rule is set', () => {
    const shifts = Array.from({ length: 6 }, (_, i) =>
      shift(`s${i}`, WEEK[i], '09:00', '17:00', 'e1')
    );
    expect(laborCost(shifts, employees, WEEK).cost).toBe(48 * 20);
    expect(laborCost(shifts, employees, WEEK).overtimeMinutes).toBe(0);
  });

  it('prices the hours past a weekly threshold at the multiplier', () => {
    const shifts = Array.from({ length: 6 }, (_, i) =>
      shift(`s${i}`, WEEK[i], '09:00', '17:00', 'e1')
    );
    const cost = laborCost(shifts, employees, WEEK, { thresholdHours: 40, multiplier: 1.5 });
    // 48 hours: 40 at 20, 8 at 30.
    expect(cost.cost).toBe(40 * 20 + 8 * 30);
    expect(cost.baseCost).toBe(800);
    expect(cost.overtimeCost).toBe(240);
    expect(cost.overtimeMinutes).toBe(8 * 60);
  });

  it('charges the overtime to the shifts that cross the line, in worked order', () => {
    const shifts = Array.from({ length: 6 }, (_, i) =>
      shift(`s${i}`, WEEK[i], '09:00', '17:00', 'e1')
    );
    const cost = laborCost(shifts, employees, WEEK, { thresholdHours: 40, multiplier: 2 });
    const byDay = new Map(cost.byDay.map((d) => [d.key, d.cost]));
    // The first five days are 40 hours at the base rate.
    expect(byDay.get('2026-08-17')).toBe(160);
    expect(byDay.get('2026-08-21')).toBe(160);
    // The sixth day is entirely overtime.
    expect(byDay.get('2026-08-22')).toBe(320);
  });

  it('ignores a threshold with no multiplier, and a multiplier of one', () => {
    const shifts = Array.from({ length: 6 }, (_, i) =>
      shift(`s${i}`, WEEK[i], '09:00', '17:00', 'e1')
    );
    expect(laborCost(shifts, employees, WEEK, { thresholdHours: 40 }).cost).toBe(48 * 20);
    expect(
      laborCost(shifts, employees, WEEK, { thresholdHours: 40, multiplier: 1 }).cost
    ).toBe(48 * 20);
  });

  it('applies the weekly threshold per week over a longer range', () => {
    const range = [...WEEK, ...WEEK.map((d) => `2026-08-${Number(d.slice(8)) + 7}`)];
    const shifts = [
      ...Array.from({ length: 6 }, (_, i) => shift(`a${i}`, WEEK[i], '09:00', '17:00', 'e1')),
      ...Array.from({ length: 6 }, (_, i) =>
        shift(`b${i}`, `2026-08-${Number(WEEK[i].slice(8)) + 7}`, '09:00', '17:00', 'e1')
      ),
    ];
    const cost = laborCost(shifts, employees, range, { thresholdHours: 40, multiplier: 1.5 });
    // Each week gets its own 8 hours of overtime, not one big bucket.
    expect(cost.overtimeMinutes).toBe(2 * 8 * 60);
  });

  it('includes earlier hours in the week when pricing a partial reporting range', () => {
    const shifts = [
      ...Array.from({ length: 6 }, (_, i) =>
        shift(`s${i}`, WEEK[i], '09:00', '17:00', 'e1')
      ),
      shift('outside', WEEK[0], '09:00', '17:00', 'e2'),
      shift('next-week', '2026-08-24', '09:00', '17:00', 'e1'),
    ];
    const options = { thresholdHours: 40, multiplier: 1.5 };
    const cost = laborCost(shifts, employees, [WEEK[5], '2026-08-24'], options);
    expect(cost.cost).toBe(240 + 160);
    expect(cost.overtimeMinutes).toBe(8 * 60);
    expect(cost.minutes).toBe(16 * 60);
    expect(cost.ratedCount).toBe(1);
    expect(cost.employeeCount).toBe(1);
    expect(cost.byDay).toEqual([
      { key: WEEK[5], minutes: 480, cost: 240 },
      { key: '2026-08-24', minutes: 480, cost: 160 },
    ]);
    expect(cost.byRole).toEqual([{ key: 'Floor', minutes: 960, cost: 400 }]);
    expect(cost.byEmployee).toEqual([{ key: 'e1', minutes: 960, cost: 400 }]);
    expect(laborCost(shifts, employees, [WEEK[5]]).cost).toBe(160);
  });

  it('breaks the week down by day, role, and employee', () => {
    const shifts = [
      shift('s1', '2026-08-17', '09:00', '17:00', 'e1', 'Kitchen'),
      shift('s2', '2026-08-18', '09:00', '13:00', 'e2', 'Floor'),
      shift('s3', '2026-08-18', '13:00', '17:00', 'e1', 'Floor'),
    ];
    const cost = laborCost(shifts, employees, WEEK);
    expect(cost.byDay.map((d) => [d.key, d.cost])).toEqual([
      ['2026-08-17', 160],
      ['2026-08-18', 120],
    ]);
    expect(cost.byRole[0]).toMatchObject({ key: 'Kitchen', cost: 160 });
    expect(cost.byRole[1]).toMatchObject({ key: 'Floor', cost: 120 });
    expect(cost.byEmployee[0]).toMatchObject({ key: 'e1', cost: 240 });
  });

  it('labels a shift with no role rather than leaving the bucket blank', () => {
    const shifts = [shift('s1', '2026-08-17', '09:00', '17:00', 'e1', '  ')];
    expect(laborCost(shifts, employees, WEEK).byRole[0].key).toBe('No role');
  });
});

describe('budgetStatus', () => {
  it('is empty with no budget set', () => {
    expect(budgetStatus(1200, null)).toEqual({ budget: null, ratio: null, over: false, difference: 0 });
    expect(budgetStatus(1200, 0)).toMatchObject({ budget: null });
  });

  it('reports the share used and how far over or under', () => {
    expect(budgetStatus(900, 1000)).toMatchObject({ budget: 1000, ratio: 0.9, over: false, difference: -100 });
    expect(budgetStatus(1200, 1000)).toMatchObject({ over: true, difference: 200, ratio: 1.2 });
  });
});

describe('store.updateCosting', () => {
  let store;
  let backend;

  beforeEach(async () => {
    backend = createMemoryBackend();
    store = createStore(backend, { now: () => '2026-08-20T09:00:00.000Z', today: () => '2026-08-20' });
    await store.init();
  });

  it('is absent by default, saves numbers, and takes blanks as off', async () => {
    expect(store.state.settings.laborBudget).toBeNull();
    await store.updateCosting({ laborBudget: '4000', overtimeThresholdHours: 40, overtimeMultiplier: '1.5' });
    expect(store.state.settings).toMatchObject({
      laborBudget: 4000,
      overtimeThresholdHours: 40,
      overtimeMultiplier: 1.5,
    });
    expect(backend.peek('settings').laborBudget).toBe(4000);

    await store.updateCosting({ laborBudget: '' });
    expect(store.state.settings.laborBudget).toBeNull();
    expect(store.state.settings.overtimeMultiplier).toBe(1.5);
  });

  it('rejects values that cannot mean anything', async () => {
    await expect(store.updateCosting({ overtimeMultiplier: 0.5 })).rejects.toThrow(/between 1 and 5/);
    await expect(store.updateCosting({ overtimeThresholdHours: 200 })).rejects.toThrow(/between 0 and 168/);
    await expect(store.updateCosting({ laborBudget: -5 })).rejects.toThrow(/between 0 and/);
    await expect(store.updateCosting({ mystery: 1 })).rejects.toThrow(/Unknown cost setting/);
  });
});
