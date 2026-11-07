import { describe, it, expect } from 'vitest';
import {
  attendanceForRange,
  lateMinutes,
  summarizeAttendance,
  workedMinutes,
} from '../src/core/attendance.js';

describe('lateMinutes', () => {
  const shift = { start: '09:00', end: '17:00' };

  it('measures lateness from shift start', () => {
    expect(lateMinutes(shift, '09:25')).toBe(25);
  });

  it('is zero for early or on-time arrivals', () => {
    expect(lateMinutes(shift, '08:45')).toBe(0);
    expect(lateMinutes(shift, '09:00')).toBe(0);
  });

  it('is zero when the clock-in is missing or malformed', () => {
    expect(lateMinutes(shift, '')).toBe(0);
    expect(lateMinutes(shift, 'later')).toBe(0);
  });

  it('handles overnight shifts with clock-ins after midnight', () => {
    const night = { start: '22:00', end: '06:00' };
    expect(lateMinutes(night, '22:30')).toBe(30);
    expect(lateMinutes(night, '00:15')).toBe(135);
    expect(lateMinutes(night, '21:00')).toBe(0);
  });
});

describe('workedMinutes', () => {
  it('measures clocked time', () => {
    expect(workedMinutes('09:00', '17:30')).toBe(510);
  });

  it('treats an earlier clock-out as crossing midnight', () => {
    expect(workedMinutes('22:00', '06:00')).toBe(480);
  });

  it('is null when incomplete or zero-length', () => {
    expect(workedMinutes('09:00', '')).toBeNull();
    expect(workedMinutes('', '17:00')).toBeNull();
    expect(workedMinutes('09:00', '09:00')).toBeNull();
  });
});

describe('summarizeAttendance', () => {
  it('counts statuses and computes the show-up rate', () => {
    const records = [
      { status: 'present' },
      { status: 'present' },
      { status: 'late' },
      { status: 'absent' },
    ];
    const summary = summarizeAttendance(records);
    expect(summary).toMatchObject({ total: 4, present: 2, late: 1, absent: 1 });
    expect(summary.rate).toBeCloseTo(0.75);
  });

  it('has a null rate when there is nothing recorded', () => {
    expect(summarizeAttendance([]).rate).toBeNull();
  });
});

describe('attendanceForRange', () => {
  const shifts = [
    { id: 'a', date: '2026-08-01', assigneeId: 'e1' },
    { id: 'b', date: '2026-08-03', assigneeId: 'e1' },
    { id: 'c', date: '2026-08-03', assigneeId: null }, // open shift: excluded
    { id: 'd', date: '2026-08-09', assigneeId: 'e2' }, // out of range
  ];
  const attendance = { a: { status: 'present' } };

  it('joins shifts in range with their records', () => {
    const rows = attendanceForRange(shifts, attendance, '2026-08-01', '2026-08-07');
    expect(rows.map((r) => r.shift.id)).toEqual(['a', 'b']);
    expect(rows[0].record.status).toBe('present');
    expect(rows[1].record).toBeUndefined();
  });
});
