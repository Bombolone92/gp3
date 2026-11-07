/**
 * Attendance logic. One record per shift, keyed by shift id:
 *   { status: 'present' | 'late' | 'absent', clockIn?, clockOut?, note? }
 */
import { addDays, toMinutes } from '../lib/time.js';

export const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  LATE: 'late',
  ABSENT: 'absent',
};

export const ATTENDANCE_STATUSES = Object.values(ATTENDANCE_STATUS);

export function isValidAttendanceStatus(status) {
  return ATTENDANCE_STATUSES.includes(status);
}

/**
 * Minutes late given a shift start and clock-in time; 0 when on time or
 * unknown. For overnight shifts a clock-in after midnight (at or before
 * the shift's end time) counts as the next day.
 */
export function lateMinutes(shift, clockIn) {
  const start = toMinutes(shift?.start);
  const end = toMinutes(shift?.end);
  const inAt = toMinutes(clockIn);
  if (start === null || inAt === null) return 0;
  if (inAt >= start) return inAt - start;
  const overnight = end !== null && end < start;
  if (overnight && inAt <= end) return inAt + 1440 - start;
  return 0;
}

/**
 * Worked minutes between clock-in and clock-out; null when incomplete or
 * zero-length. A clock-out earlier than the clock-in is treated as
 * crossing midnight (an overnight shift).
 */
export function workedMinutes(clockIn, clockOut) {
  const inAt = toMinutes(clockIn);
  const outAt = toMinutes(clockOut);
  if (inAt === null || outAt === null || outAt === inAt) return null;
  return outAt > inAt ? outAt - inAt : outAt + 1440 - inAt;
}

/**
 * How long somebody has been on shift: minutes from their clock-in to
 * the given wall-clock time. A time earlier than the clock-in is read as
 * the next morning, which is right for a night shift; null when either
 * time is missing.
 */
export function elapsedMinutes(clockIn, nowHHMM) {
  const inAt = toMinutes(clockIn);
  const now = toMinutes(nowHHMM);
  if (inAt === null || now === null) return null;
  return now >= inAt ? now - inAt : now + 1440 - inAt;
}

/** Clocked in and not yet out: the shift is running right now. */
export function isInProgress(record) {
  return Boolean(record && record.status !== ATTENDANCE_STATUS.ABSENT && record.clockIn && !record.clockOut);
}

/**
 * Is the shift actually running at `todayISO`? A record stays clocked in
 * for ever once somebody forgets to clock out, so isInProgress on its own
 * counts last month's forgotten clock-out among the people on the floor
 * right now. A shift is under 24 hours and starts on its own date, so
 * only today's and yesterday's can still be running: yesterday's covers
 * the night shift that clocked in before midnight.
 */
export function isRunningNow(shift, record, todayISO) {
  if (!isInProgress(record)) return false;
  return shift?.date === todayISO || shift?.date === addDays(todayISO, -1);
}

/**
 * The record a clock-in produces. Status comes from how late the stamp
 * is against the scheduled start, with an optional grace period: within
 * it (or early) is present, past it is late. A record that already
 * carries a clock-in keeps whatever status it was given, so a manual
 * choice is never overwritten by a correction to the times.
 */
export function clockInRecord(shift, record, atHHMM, graceMinutes = 0) {
  const grace = Number.isFinite(Number(graceMinutes)) ? Math.max(0, Number(graceMinutes)) : 0;
  const late = lateMinutes(shift, atHHMM) > grace;
  const keptStatus = record?.clockIn ? record.status : null;
  return {
    note: record?.note ?? '',
    ...record,
    status: keptStatus ?? (late ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT),
    clockIn: atHHMM,
    clockOut: record?.clockOut ?? '',
  };
}

/** The record a clock-out produces; overnight totals are workedMinutes' job. */
export function clockOutRecord(record, atHHMM) {
  return {
    status: ATTENDANCE_STATUS.PRESENT,
    clockIn: '',
    note: '',
    ...record,
    clockOut: atHHMM,
  };
}

/**
 * Summary counts over a list of records. `rate` is the share of recorded
 * shifts where the employee showed up (present or late), null when empty.
 */
export function summarizeAttendance(records) {
  const total = records.length;
  const counts = { present: 0, late: 0, absent: 0 };
  for (const r of records) {
    if (counts[r.status] !== undefined) counts[r.status] += 1;
  }
  const rate = total === 0 ? null : (counts.present + counts.late) / total;
  return { total, ...counts, rate };
}

/**
 * Joins shifts in [fromISO, toISO] with their attendance records.
 * Returns { shift, record } pairs for assigned shifts only; `record` may be
 * undefined when attendance has not been taken yet.
 */
export function attendanceForRange(shifts, attendance, fromISO, toISO) {
  return shifts
    .filter((s) => s.assigneeId && s.date >= fromISO && s.date <= toISO)
    .map((shift) => ({ shift, record: attendance[shift.id] }));
}
