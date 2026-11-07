import { describe, it, expect, beforeEach } from 'vitest';
import {
  ATTENDANCE_STATUS,
  clockInRecord,
  clockOutRecord,
  elapsedMinutes,
  isInProgress,
  isRunningNow,
  workedMinutes,
} from '../src/core/attendance.js';
import { formatElapsed, nowTime } from '../src/lib/time.js';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const shift = { id: 's1', date: '2026-08-20', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1' };
const night = { id: 's2', date: '2026-08-20', start: '22:00', end: '06:00', role: 'Night', assigneeId: 'e1' };

describe('clocking in', () => {
  it('stamps the time and counts an on-time arrival as present', () => {
    const record = clockInRecord(shift, undefined, '08:55');
    expect(record).toMatchObject({ status: ATTENDANCE_STATUS.PRESENT, clockIn: '08:55', clockOut: '' });
  });

  it('marks a late arrival late, with the grace period deciding where the line is', () => {
    expect(clockInRecord(shift, undefined, '09:01').status).toBe(ATTENDANCE_STATUS.LATE);
    expect(clockInRecord(shift, undefined, '09:05', 5).status).toBe(ATTENDANCE_STATUS.PRESENT);
    expect(clockInRecord(shift, undefined, '09:06', 5).status).toBe(ATTENDANCE_STATUS.LATE);
    // A missing or nonsense grace period is simply no grace.
    expect(clockInRecord(shift, undefined, '09:01', null).status).toBe(ATTENDANCE_STATUS.LATE);
  });

  it('replaces a status chosen before anyone arrived, and keeps one chosen after', () => {
    // Marked absent, then they turn up: the stamp is the newer evidence.
    const wasAbsent = { status: ATTENDANCE_STATUS.ABSENT, clockIn: '', clockOut: '' };
    expect(clockInRecord(shift, wasAbsent, '09:20').status).toBe(ATTENDANCE_STATUS.LATE);
    // Already clocked in and marked present by hand: correcting the time
    // must not flip them back to late.
    const manual = { status: ATTENDANCE_STATUS.PRESENT, clockIn: '09:30', clockOut: '' };
    expect(clockInRecord(shift, manual, '09:40').status).toBe(ATTENDANCE_STATUS.PRESENT);
  });

  it('keeps a note and a clock-out that are already on the record', () => {
    const existing = { status: ATTENDANCE_STATUS.PRESENT, clockIn: '', clockOut: '17:10', note: 'Covered the bar' };
    expect(clockInRecord(shift, existing, '09:00')).toMatchObject({
      clockIn: '09:00',
      clockOut: '17:10',
      note: 'Covered the bar',
    });
  });

  it('reads an after-midnight arrival on a night shift as late, not early', () => {
    expect(clockInRecord(night, undefined, '23:00').status).toBe(ATTENDANCE_STATUS.LATE);
    expect(clockInRecord(night, undefined, '00:30').status).toBe(ATTENDANCE_STATUS.LATE);
    expect(clockInRecord(night, undefined, '21:50').status).toBe(ATTENDANCE_STATUS.PRESENT);
  });
});

describe('clocking out', () => {
  it('stamps the time and leaves the status and clock-in alone', () => {
    const record = { status: ATTENDANCE_STATUS.LATE, clockIn: '09:20', clockOut: '', note: 'x' };
    expect(clockOutRecord(record, '17:05')).toEqual({
      status: ATTENDANCE_STATUS.LATE,
      clockIn: '09:20',
      clockOut: '17:05',
      note: 'x',
    });
  });

  it('handles the overnight case through workedMinutes', () => {
    const out = clockOutRecord({ status: ATTENDANCE_STATUS.PRESENT, clockIn: '22:00' }, '06:10');
    expect(workedMinutes(out.clockIn, out.clockOut)).toBe(490);
  });
});

describe('a shift in progress', () => {
  it('is one that is clocked in and not out', () => {
    expect(isInProgress(undefined)).toBe(false);
    expect(isInProgress({ status: 'present', clockIn: '', clockOut: '' })).toBe(false);
    expect(isInProgress({ status: 'present', clockIn: '09:00', clockOut: '' })).toBe(true);
    expect(isInProgress({ status: 'present', clockIn: '09:00', clockOut: '17:00' })).toBe(false);
    expect(isInProgress({ status: 'absent', clockIn: '09:00', clockOut: '' })).toBe(false);
  });

  it('only counts today and last night as still running', () => {
    const running = { status: 'present', clockIn: '09:00', clockOut: '' };
    const closed = { status: 'present', clockIn: '09:00', clockOut: '17:00' };
    // The shift being worked right now.
    expect(isRunningNow(shift, running, '2026-08-20')).toBe(true);
    // Last night's, clocked in before midnight and still going.
    expect(isRunningNow(night, running, '2026-08-21')).toBe(true);
    // A clock-in from last week that nobody ever closed is not somebody
    // on the floor; a shift is under 24 hours and cannot still be running.
    expect(isRunningNow(shift, running, '2026-08-27')).toBe(false);
    // Nor is a shift that has not started yet, or one already closed.
    expect(isRunningNow(shift, running, '2026-08-19')).toBe(false);
    expect(isRunningNow(shift, closed, '2026-08-20')).toBe(false);
    expect(isRunningNow(shift, undefined, '2026-08-20')).toBe(false);
  });

  it('reports elapsed time, across midnight too', () => {
    expect(elapsedMinutes('09:00', '11:30')).toBe(150);
    expect(elapsedMinutes('09:00', '09:00')).toBe(0);
    expect(elapsedMinutes('22:00', '01:15')).toBe(195);
    expect(elapsedMinutes('', '01:15')).toBeNull();
  });

  it('reads elapsed time the way a clock does', () => {
    expect(formatElapsed(0)).toBe('just now');
    expect(formatElapsed(45)).toBe('45m');
    expect(formatElapsed(80)).toBe('1h 20m');
    expect(formatElapsed(120)).toBe('2h');
  });

  it('formats the current time as a plain HH:MM stamp', () => {
    expect(nowTime(new Date(2026, 7, 20, 9, 5))).toBe('09:05');
    expect(nowTime(new Date(2026, 7, 20, 23, 59))).toBe('23:59');
  });
});

describe('store.setGraceMinutes', () => {
  let store;
  let backend;

  beforeEach(async () => {
    backend = createMemoryBackend();
    store = createStore(backend, { now: () => '2026-08-20T09:00:00.000Z', today: () => '2026-08-20' });
    await store.init();
  });

  it('is off to begin with, saves a number, and takes a blank as off', async () => {
    expect(store.state.settings.graceMinutes).toBeNull();
    await store.setGraceMinutes('7');
    expect(store.state.settings.graceMinutes).toBe(7);
    expect(backend.peek('settings').graceMinutes).toBe(7);
    await store.setGraceMinutes('');
    expect(store.state.settings.graceMinutes).toBeNull();
  });

  it('rejects anything that is not a sane number of minutes', async () => {
    await expect(store.setGraceMinutes('-1')).rejects.toThrow(/0 to 120/);
    await expect(store.setGraceMinutes('999')).rejects.toThrow(/0 to 120/);
    await expect(store.setGraceMinutes('7.5')).rejects.toThrow(/whole number/);
  });

  it('records a stamped clock-in through the existing attendance write', async () => {
    const ava = await store.addEmployee({ name: 'Ava' });
    const created = await store.addShift({
      date: '2026-08-20',
      start: '09:00',
      end: '17:00',
      role: 'Floor',
      assigneeId: ava.id,
    });
    await store.setGraceMinutes(5);
    await store.recordAttendance(
      created.id,
      clockInRecord(created, undefined, '09:03', store.state.settings.graceMinutes)
    );
    expect(store.state.attendance[created.id]).toMatchObject({
      status: ATTENDANCE_STATUS.PRESENT,
      clockIn: '09:03',
    });
    await store.recordAttendance(
      created.id,
      clockOutRecord(store.state.attendance[created.id], '17:20')
    );
    expect(store.state.attendance[created.id].clockOut).toBe('17:20');
    expect(backend.peek('attendance')[created.id].clockOut).toBe('17:20');
  });
});
