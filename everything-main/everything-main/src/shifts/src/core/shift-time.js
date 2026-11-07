/**
 * Shift time primitives: how long a shift is, what of it is paid, and
 * where it sits on an absolute timeline.
 *
 * These sit below the scheduling rules that use them (conflicts,
 * availability, working-time limits) so that both scheduling.js and
 * rules.js can share them without importing each other. scheduling.js
 * re-exports them, which is where the rest of the app reads them from.
 */
import { durationMinutes, toMinutes } from '../lib/time.js';

/** Calendar day count since the epoch, treating every day as 1440 minutes. */
export function dayNumber(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/**
 * A shift as an absolute [start, end) minute interval on a wall-clock
 * timeline, so overnight shifts compare correctly across dates.
 */
export function absoluteRange(shift) {
  const s = toMinutes(shift.start);
  const duration = durationMinutes(shift.start, shift.end);
  if (s === null || duration === null || !shift.date) return null;
  const base = dayNumber(shift.date) * 1440 + s;
  return [base, base + duration];
}

export function shiftDurationMinutes(shift) {
  return durationMinutes(shift.start, shift.end) ?? 0;
}

/** Unpaid break on a shift, in minutes; missing or invalid data counts as 0. */
export function shiftBreakMinutes(shift) {
  const brk = Number(shift?.breakMinutes ?? 0);
  return Number.isFinite(brk) && brk > 0 ? brk : 0;
}

/**
 * Paid (net) minutes of a shift: wall-clock duration minus the unpaid
 * break. This is what hours totals, overtime checks, and payroll use.
 */
export function shiftNetMinutes(shift) {
  return Math.max(0, shiftDurationMinutes(shift) - shiftBreakMinutes(shift));
}

/** True when two shifts overlap in real time, including across midnight. */
export function shiftsOverlap(a, b) {
  const ra = absoluteRange(a);
  const rb = absoluteRange(b);
  if (!ra || !rb) return false;
  return ra[0] < rb[1] && rb[0] < ra[1];
}
