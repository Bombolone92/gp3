import { describe, it, expect } from 'vitest';
import {
  AVAILABILITY,
  availabilityStatus,
  coverageGaps,
  defaultAvailability,
  findConflicts,
  hoursStatus,
  openShifts,
  shiftsOverlap,
  timeOffOn,
  validateShift,
  weeklyMinutes,
} from '../src/core/scheduling.js';

const shift = (overrides = {}) => ({
  id: 's1',
  date: '2026-08-04', // a Tuesday
  start: '09:00',
  end: '17:00',
  role: 'Floor',
  assigneeId: 'emp1',
  ...overrides,
});

describe('validateShift', () => {
  it('accepts a well-formed shift', () => {
    expect(validateShift(shift())).toEqual([]);
  });

  it('accepts overnight shifts but rejects zero-length ones', () => {
    expect(validateShift(shift({ start: '22:00', end: '06:00' }))).toEqual([]);
    expect(validateShift(shift({ start: '09:00', end: '09:00' }))).toContain(
      'End time must differ from start time.'
    );
  });

  it('rejects missing date, times, and role', () => {
    const errors = validateShift({ date: 'nope', start: '', end: '25:00', role: '  ' });
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe('conflict detection', () => {
  it('flags overlapping shifts for the same employee on the same day', () => {
    const a = shift();
    const b = shift({ id: 's2', start: '16:00', end: '20:00' });
    expect(shiftsOverlap(a, b)).toBe(true);
    expect(findConflicts(a, [a, b])).toEqual([b]);
  });

  it('ignores back-to-back shifts', () => {
    const a = shift();
    const b = shift({ id: 's2', start: '17:00', end: '21:00' });
    expect(findConflicts(a, [a, b])).toEqual([]);
  });

  it('ignores other employees and other days', () => {
    const a = shift();
    const otherPerson = shift({ id: 's2', assigneeId: 'emp2' });
    const otherDay = shift({ id: 's3', date: '2026-08-05' });
    expect(findConflicts(a, [a, otherPerson, otherDay])).toEqual([]);
  });

  it('never reports conflicts for unassigned shifts', () => {
    const open = shift({ assigneeId: null });
    expect(findConflicts(open, [open, shift({ id: 's2' })])).toEqual([]);
  });

  it('checks conflicts for a hypothetical assignee (swap evaluation)', () => {
    const a = shift();
    const busy = shift({ id: 's2', assigneeId: 'emp2', start: '10:00', end: '12:00' });
    expect(findConflicts(a, [a, busy], 'emp2')).toEqual([busy]);
  });

  it('detects overnight shifts colliding with the next morning', () => {
    const night = shift({ start: '22:00', end: '06:00' }); // Tue 22:00 -> Wed 06:00
    const earlyNextDay = shift({ id: 's2', date: '2026-08-05', start: '05:00', end: '09:00' });
    const afterItEnds = shift({ id: 's3', date: '2026-08-05', start: '06:00', end: '10:00' });
    expect(shiftsOverlap(night, earlyNextDay)).toBe(true);
    expect(findConflicts(night, [night, earlyNextDay, afterItEnds])).toEqual([earlyNextDay]);
  });

  it('detects an overnight shift from the day before spilling into a morning', () => {
    const morning = shift({ id: 's2', date: '2026-08-05', start: '05:00', end: '09:00' });
    const night = shift({ start: '22:00', end: '06:00' }); // Tue 22:00 -> Wed 06:00
    const twoNightsBack = shift({ id: 's3', date: '2026-08-03', start: '22:00', end: '06:00' });
    expect(findConflicts(morning, [morning, night, twoNightsBack])).toEqual([night]);
  });
});

describe('availabilityStatus', () => {
  const availability = {
    days: defaultAvailability().days.map((d, i) =>
      i === 0 ? { off: true, start: '09:00', end: '17:00' } : d // Sundays off
    ),
  };

  it('is available when the shift fits the daily window', () => {
    expect(availabilityStatus(shift(), availability)).toBe(AVAILABILITY.AVAILABLE);
  });

  it('is partial when the shift spills outside the window', () => {
    expect(availabilityStatus(shift({ start: '15:00', end: '20:00' }), availability)).toBe(
      AVAILABILITY.PARTIAL
    );
  });

  it('is unavailable on days marked off', () => {
    const sunday = shift({ date: '2026-08-09' });
    expect(availabilityStatus(sunday, availability)).toBe(AVAILABILITY.UNAVAILABLE);
  });

  it('is unavailable when the shift is entirely outside the window', () => {
    expect(availabilityStatus(shift({ start: '18:00', end: '22:00' }), availability)).toBe(
      AVAILABILITY.UNAVAILABLE
    );
  });

  it('treats missing availability data as available', () => {
    expect(availabilityStatus(shift(), undefined)).toBe(AVAILABILITY.AVAILABLE);
  });

  it('checks overnight shifts against both days, treating 23:59 as midnight', () => {
    // Tue 22:00-23:59 window plus Wed 00:00-06:00 window covers a 22:00-06:00 shift.
    const days = defaultAvailability().days.map(() => ({ off: true, start: '09:00', end: '17:00' }));
    days[2] = { off: false, start: '20:00', end: '23:59' }; // Tuesday evening
    days[3] = { off: false, start: '00:00', end: '06:00' }; // Wednesday morning
    const night = shift({ start: '22:00', end: '06:00' });
    expect(availabilityStatus(night, { days })).toBe(AVAILABILITY.AVAILABLE);

    // Take away the Wednesday morning window: only partially available.
    days[3] = { off: true, start: '09:00', end: '17:00' };
    expect(availabilityStatus(night, { days })).toBe(AVAILABILITY.PARTIAL);
  });
});

describe('time off', () => {
  const vacation = { id: 'x1', from: '2026-08-03', to: '2026-08-05', note: 'Vacation' };
  const withTimeOff = { ...defaultAvailability(), exceptions: [vacation] };

  it('finds the entry covering a date, inclusive of both ends', () => {
    expect(timeOffOn(withTimeOff, '2026-08-03')).toEqual(vacation);
    expect(timeOffOn(withTimeOff, '2026-08-05')).toEqual(vacation);
    expect(timeOffOn(withTimeOff, '2026-08-06')).toBeNull();
    expect(timeOffOn(undefined, '2026-08-04')).toBeNull();
  });

  it('overrides the weekly pattern for shifts on those days', () => {
    // Tuesday 2026-08-04 falls inside the vacation despite the 9-5 window.
    expect(availabilityStatus(shift(), withTimeOff)).toBe(AVAILABILITY.UNAVAILABLE);
    // The day after the vacation ends is governed by the weekly pattern again.
    expect(availabilityStatus(shift({ date: '2026-08-06' }), withTimeOff)).toBe(
      AVAILABILITY.AVAILABLE
    );
  });

  it('marks an overnight shift partial when only its second day is time off', () => {
    const laterVacation = { ...defaultAvailability(), exceptions: [{ id: 'x2', from: '2026-08-05', to: '2026-08-05' }] };
    laterVacation.days = laterVacation.days.map(() => ({ off: false, start: '00:00', end: '23:59' }));
    const night = shift({ start: '22:00', end: '06:00' }); // Tue 22:00 -> Wed 06:00
    expect(availabilityStatus(night, laterVacation)).toBe(AVAILABILITY.PARTIAL);
  });
});

describe('aggregation', () => {
  it('sums weekly minutes for one employee within the week only', () => {
    const shifts = [
      shift({ id: 'a', date: '2026-08-03', start: '09:00', end: '17:00' }), // Mon, 8h
      shift({ id: 'b', date: '2026-08-09', start: '10:00', end: '14:00' }), // Sun, 4h
      shift({ id: 'c', date: '2026-08-10', start: '09:00', end: '17:00' }), // next Mon
      shift({ id: 'd', date: '2026-08-04', assigneeId: 'emp2' }),
    ];
    expect(weeklyMinutes(shifts, 'emp1', '2026-08-03')).toBe(720);
  });

  it('lists open shifts', () => {
    const shifts = [shift(), shift({ id: 's2', assigneeId: null })];
    expect(openShifts(shifts).map((s) => s.id)).toEqual(['s2']);
  });
});

describe('coverageGaps', () => {
  // 2026-08-04 is a Tuesday (day 2), 2026-08-05 a Wednesday (day 3).
  const barista2 = { id: 'c1', role: 'Barista', days: [2, 3], count: 2, start: null, end: null };
  const closer = { id: 'c2', role: 'Close', days: [2], count: 1, start: '17:00', end: '19:00' };

  it('reports missing headcount per date and requirement', () => {
    const shifts = [shift({ role: 'Barista' })];
    const gaps = coverageGaps(shifts, [barista2, closer], ['2026-08-04', '2026-08-05']);
    expect(gaps).toEqual([
      { date: '2026-08-04', requirement: barista2, scheduled: 1, missing: 1 },
      { date: '2026-08-04', requirement: closer, scheduled: 0, missing: 1 },
      { date: '2026-08-05', requirement: barista2, scheduled: 0, missing: 2 },
    ]);
  });

  it('matches roles case-insensitively and counts open shifts', () => {
    const shifts = [
      shift({ role: 'barista', assigneeId: null }),
      shift({ id: 's2', role: ' BARISTA ' }),
    ];
    expect(coverageGaps(shifts, [barista2], ['2026-08-04'])).toEqual([]);
  });

  it('only counts shifts overlapping the requirement window', () => {
    const morning = shift({ role: 'Close', start: '08:00', end: '12:00' });
    const evening = shift({ id: 's2', role: 'Close', start: '12:00', end: '20:00' });
    expect(coverageGaps([morning], [closer], ['2026-08-04'])).toHaveLength(1);
    expect(coverageGaps([morning, evening], [closer], ['2026-08-04'])).toEqual([]);
  });

  it('counts overnight spill from the previous day', () => {
    const night = shift({ date: '2026-08-03', role: 'Guard', start: '22:00', end: '06:00' });
    const earlyGuard = { id: 'c3', role: 'Guard', days: [2], count: 1, start: '04:00', end: '06:00' };
    expect(coverageGaps([night], [earlyGuard], ['2026-08-04'])).toEqual([]);
  });

  it('matches a requirement label written with other casing or padding', () => {
    const padded = { id: 'c4', role: ' bArIsTa ', days: [2], count: 2, start: null, end: null };
    const shifts = [shift({ role: 'Barista' }), shift({ id: 's2', role: 'Barista' })];
    expect(coverageGaps(shifts, [padded], ['2026-08-04'])).toEqual([]);
  });

  it('counts each requirement on a shared role independently', () => {
    const allDay = { id: 'c5', role: 'Close', days: [2], count: 1, start: null, end: null };
    const shifts = [shift({ role: 'Close', start: '08:00', end: '12:00' })];
    // The morning shift covers the all-day requirement but not the 5-7 PM one.
    expect(coverageGaps(shifts, [allDay, closer], ['2026-08-04'])).toEqual([
      { date: '2026-08-04', requirement: closer, scheduled: 0, missing: 1 },
    ]);
  });

  it('is empty with no requirements', () => {
    expect(coverageGaps([shift()], [], ['2026-08-04'])).toEqual([]);
    expect(coverageGaps([shift()], undefined, ['2026-08-04'])).toEqual([]);
  });
});

describe('hoursStatus', () => {
  it('flags totals above the max and below the target', () => {
    const emp = { targetHours: 32, maxHours: 40 };
    expect(hoursStatus(42 * 60, emp)).toBe('over');
    expect(hoursStatus(30 * 60, emp)).toBe('under');
    expect(hoursStatus(36 * 60, emp)).toBe('ok');
    expect(hoursStatus(40 * 60, emp)).toBe('ok'); // at the max is allowed
  });

  it('is ok when no limits are set', () => {
    expect(hoursStatus(80 * 60, { targetHours: null, maxHours: null })).toBe('ok');
    expect(hoursStatus(80 * 60, undefined)).toBe('ok');
  });
});
