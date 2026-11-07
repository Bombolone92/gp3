import { describe, it, expect, beforeEach } from 'vitest';
import {
  shiftBreakMinutes,
  shiftNetMinutes,
  validateShift,
  weeklyMinutes,
} from '../src/core/scheduling.js';
import { timesheetRows, timesheetCSV } from '../src/core/timesheet.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const base = { date: '2026-08-05', start: '09:00', end: '17:00', role: 'Floor' };

describe('break math', () => {
  it('treats missing or invalid breaks as zero', () => {
    expect(shiftBreakMinutes({ ...base })).toBe(0);
    expect(shiftBreakMinutes({ ...base, breakMinutes: 'x' })).toBe(0);
    expect(shiftBreakMinutes({ ...base, breakMinutes: -10 })).toBe(0);
    expect(shiftBreakMinutes({ ...base, breakMinutes: 30 })).toBe(30);
  });

  it('computes net minutes as duration minus break', () => {
    expect(shiftNetMinutes({ ...base })).toBe(480);
    expect(shiftNetMinutes({ ...base, breakMinutes: 30 })).toBe(450);
    // Overnight shifts subtract the break too.
    expect(shiftNetMinutes({ ...base, start: '22:00', end: '06:00', breakMinutes: 60 })).toBe(420);
  });

  it('excludes breaks from weekly totals', () => {
    const shifts = [
      { id: 's1', ...base, assigneeId: 'e1', breakMinutes: 30 },
      { id: 's2', ...base, date: '2026-08-06', assigneeId: 'e1' },
    ];
    expect(weeklyMinutes(shifts, 'e1', '2026-08-03')).toBe(450 + 480);
  });
});

describe('validateShift with breaks', () => {
  it('rejects negative breaks and breaks as long as the shift', () => {
    expect(validateShift({ ...base, breakMinutes: -5 })).not.toEqual([]);
    expect(validateShift({ ...base, breakMinutes: 480 })).not.toEqual([]);
    expect(validateShift({ ...base, breakMinutes: 479 })).toEqual([]);
    expect(validateShift({ ...base, breakMinutes: '' })).toEqual([]);
    expect(validateShift({ ...base })).toEqual([]);
  });
});

describe('store break handling', () => {
  let store;
  let backend;

  beforeEach(async () => {
    backend = createMemoryBackend();
    store = createStore(backend, {
      now: () => '2026-08-04T09:00:00.000Z',
      today: () => '2026-08-04',
    });
    await store.init();
  });

  it('normalizes break input and validates it', async () => {
    const none = await store.addShift({ ...base });
    expect(none.breakMinutes).toBe(0);
    const withBreak = await store.addShift({ ...base, breakMinutes: '30' });
    expect(withBreak.breakMinutes).toBe(30);

    await expect(store.addShift({ ...base, breakMinutes: -1 })).rejects.toThrow(/break/i);
    await expect(store.addShift({ ...base, breakMinutes: 600 })).rejects.toThrow(/shorter/i);

    await store.updateShift(withBreak.id, { breakMinutes: '' });
    expect(store.state.shifts.find((s) => s.id === withBreak.id).breakMinutes).toBe(0);
  });

  it('carries breaks along when copying a week', async () => {
    await store.addShift({ ...base, breakMinutes: 45 });
    await store.copyWeek('2026-08-03', '2026-08-10');
    const copy = store.state.shifts.find((s) => s.date === '2026-08-12');
    expect(copy.breakMinutes).toBe(45);
  });
});

describe('timesheet with breaks', () => {
  const state = {
    employees: [{ id: 'e1', name: 'Ava' }],
    shifts: [
      { id: 's1', ...base, assigneeId: 'e1', breakMinutes: 30 },
      { id: 's2', ...base, date: '2026-08-06', assigneeId: 'e1' },
    ],
    attendance: {
      s1: { status: 'present', clockIn: '09:00', clockOut: '17:00' },
    },
  };

  it('nets scheduled and worked hours and exposes the break column', () => {
    const [withBreak, plain] = timesheetRows(state, '2026-08-03', '2026-08-09');
    expect(withBreak).toMatchObject({ breakMinutes: 30, scheduledHours: 7.5, workedHours: 7.5 });
    expect(plain).toMatchObject({ breakMinutes: 0, scheduledHours: 8, workedHours: '' });
  });

  it('includes a break column in the CSV', () => {
    const csv = timesheetCSV(state, '2026-08-03', '2026-08-09');
    const header = csv.split('\r\n')[0];
    expect(header).toContain('Break minutes');
    expect(csv).toContain(',30,7.5,');
  });
});
