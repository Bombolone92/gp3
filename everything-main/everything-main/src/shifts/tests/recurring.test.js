import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, REPEAT_MAX_WEEKS } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

let backend;
let store;

// 2026-08-03 is a Monday.
const template = {
  date: '2026-08-03',
  start: '09:00',
  end: '17:00',
  role: 'Opening',
  note: 'Standing shift',
  breakMinutes: 30,
};

beforeEach(async () => {
  backend = createMemoryBackend();
  store = createStore(backend, {
    now: () => '2026-08-01T09:00:00.000Z',
    today: () => '2026-08-01',
  });
  await store.init();
});

describe('addRepeatingShifts', () => {
  it('materializes one shift per matching date, inclusive of both ends', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const { created, skipped } = await store.addRepeatingShifts(
      { ...template, assigneeId: ava.id },
      { weekdays: [1, 3, 5], until: '2026-08-17' } // Mon/Wed/Fri for two weeks + final Monday
    );

    expect(created).toBe(7);
    expect(skipped).toBe(0);
    const dates = store.state.shifts.map((s) => s.date).sort();
    expect(dates).toEqual([
      '2026-08-03', '2026-08-05', '2026-08-07',
      '2026-08-10', '2026-08-12', '2026-08-14',
      '2026-08-17',
    ]);
    // Every record is a plain shift carrying the template fields.
    for (const shift of store.state.shifts) {
      expect(shift).toMatchObject({
        start: '09:00',
        end: '17:00',
        role: 'Opening',
        assigneeId: ava.id,
        note: 'Standing shift',
        breakMinutes: 30,
      });
    }
    expect(backend.peek('shifts')).toHaveLength(7);
  });

  it('skips exact duplicates like copyWeek does', async () => {
    await store.addShift({ ...template, date: '2026-08-10' });
    const { created, skipped } = await store.addRepeatingShifts(template, {
      weekdays: [1],
      until: '2026-08-17',
    });
    expect(created).toBe(2); // Aug 3 and 17; Aug 10 already exists
    expect(skipped).toBe(1);
    expect(store.state.shifts).toHaveLength(3);
  });

  it('starts at the template date even when its weekday is unchecked', async () => {
    const { created } = await store.addRepeatingShifts(template, {
      weekdays: [5], // Fridays only, starting from a Monday
      until: '2026-08-14',
    });
    expect(created).toBe(2);
    expect(store.state.shifts.map((s) => s.date).sort()).toEqual(['2026-08-07', '2026-08-14']);
  });

  it('validates weekdays, the end date, and the horizon cap', async () => {
    await expect(
      store.addRepeatingShifts(template, { weekdays: [], until: '2026-08-17' })
    ).rejects.toThrow(/weekday/i);
    await expect(
      store.addRepeatingShifts(template, { weekdays: [1], until: '2026-08-02' })
    ).rejects.toThrow(/on or after/i);
    await expect(
      store.addRepeatingShifts(template, { weekdays: [1], until: 'nope' })
    ).rejects.toThrow(/valid repeat end/i);
    await expect(
      store.addRepeatingShifts(template, {
        weekdays: [1],
        until: `2026-11-30`, // more than REPEAT_MAX_WEEKS past the start
      })
    ).rejects.toThrow(new RegExp(`${REPEAT_MAX_WEEKS} weeks`));
    expect(store.state.shifts).toHaveLength(0);
  });

  it('rejects an invalid template before creating anything', async () => {
    await expect(
      store.addRepeatingShifts(
        { ...template, role: '' },
        { weekdays: [1], until: '2026-08-17' }
      )
    ).rejects.toThrow(/role/i);
    expect(store.state.shifts).toHaveLength(0);
  });
});
