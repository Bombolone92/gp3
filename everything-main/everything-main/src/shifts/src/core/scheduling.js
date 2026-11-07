/**
 * Pure scheduling logic: shift validation, conflict detection,
 * availability checks, and weekly-hours aggregation.
 */
import {
  addDays,
  dayOfWeek,
  durationMinutes,
  formatHours,
  isOvernight,
  isValidDate,
  isValidTime,
  rangesOverlap,
  startOfWeek,
  toMinutes,
  weekDates,
} from '../lib/time.js';
import { absoluteRange, dayNumber, shiftNetMinutes } from './shift-time.js';
import { ruleViolations } from './rules.js';

// Where the rest of the app reads the shift time primitives from.
export {
  absoluteRange,
  shiftBreakMinutes,
  shiftDurationMinutes,
  shiftNetMinutes,
  shiftsOverlap,
} from './shift-time.js';

export const AVAILABILITY = {
  AVAILABLE: 'available',
  PARTIAL: 'partial',
  UNAVAILABLE: 'unavailable',
};

/** Default weekly availability: available 9–5 every day. Index 0 = Sunday. */
export function defaultAvailability() {
  return {
    days: Array.from({ length: 7 }, () => ({ off: false, start: '09:00', end: '17:00' })),
    exceptions: [],
  };
}

/**
 * The time-off entry covering the given date, or null. Entries are
 * inclusive date ranges: { id, from, to, note }.
 */
export function timeOffOn(availability, iso) {
  return availability?.exceptions?.find((x) => x.from <= iso && iso <= x.to) ?? null;
}

/** Returns a list of human-readable problems; empty means the shift is valid. */
export function validateShift(shift) {
  const errors = [];
  if (!isValidDate(shift.date ?? '')) errors.push('A valid date is required.');
  if (!isValidTime(shift.start ?? '')) errors.push('A valid start time is required.');
  if (!isValidTime(shift.end ?? '')) errors.push('A valid end time is required.');
  if (errors.length === 0 && durationMinutes(shift.start, shift.end) === null) {
    errors.push('End time must differ from start time.');
  }
  if (!shift.role || !String(shift.role).trim()) errors.push('A role or label is required.');
  if (shift.breakMinutes !== undefined && shift.breakMinutes !== null && shift.breakMinutes !== '') {
    const brk = Number(shift.breakMinutes);
    if (!Number.isFinite(brk) || brk < 0) {
      errors.push('The unpaid break must be zero or more minutes.');
    } else if (errors.length === 0 && brk >= durationMinutes(shift.start, shift.end)) {
      errors.push('The unpaid break must be shorter than the shift itself.');
    }
  }
  return errors;
}

/**
 * Shifts (other than `shift` itself) assigned to the same employee that
 * overlap it. Unassigned shifts never conflict.
 *
 * A shift is always shorter than 24 hours and starts on its own date, so
 * its span stays inside the two days beginning there. Nothing dated more
 * than one day away can reach it, and ruling those out by date is three
 * string comparisons instead of parsing every candidate's date and times.
 * The schedule grid runs this once per visible shift against the whole
 * dataset, where that is the difference between a scan of the week and a
 * scan of every shift ever recorded.
 */
export function findConflicts(shift, allShifts, assigneeId = shift.assigneeId) {
  if (!assigneeId) return [];
  const range = absoluteRange(shift);
  if (range === null) return [];
  const before = addDays(shift.date, -1);
  const after = addDays(shift.date, 1);
  return allShifts.filter((s) => {
    if (s.id === shift.id || s.assigneeId !== assigneeId) return false;
    if (s.date !== shift.date && s.date !== before && s.date !== after) return false;
    const other = absoluteRange(s);
    return other !== null && other[0] < range[1] && range[0] < other[1];
  });
}

/** How much of one same-day segment a daily window covers. */
function segmentCoverage(day, segStart, segEnd) {
  if (segEnd <= segStart) return 'full'; // empty segment
  if (!day) return 'full';
  if (day.off) return 'none';
  const winS = toMinutes(day.start);
  let winE = toMinutes(day.end);
  if (winS === null || winE === null) return 'full';
  if (winE === 1439) winE = 1440; // 23:59 counts as end of day
  if (segStart >= winS && segEnd <= winE) return 'full';
  if (!rangesOverlap(segStart, segEnd, winS, winE)) return 'none';
  return 'partial';
}

/**
 * How a shift relates to an employee's weekly availability and time off.
 * Returns AVAILABLE, PARTIAL (some overlap with the available window),
 * or UNAVAILABLE. Overnight shifts are checked in two segments: the
 * evening against the start day's window and the remainder against the
 * next day's. A time-off entry blanks out the whole day regardless of
 * the weekly pattern. Missing availability data counts as AVAILABLE.
 */
export function availabilityStatus(shift, availability) {
  if (!availability?.days && !availability?.exceptions?.length) return AVAILABILITY.AVAILABLE;
  const dow = dayOfWeek(shift.date);
  const s = toMinutes(shift.start);
  const e = toMinutes(shift.end);
  if (s === null || e === null) return AVAILABILITY.AVAILABLE;

  const segments =
    e > s
      ? [[shift.date, dow, s, e]]
      : [
          [shift.date, dow, s, 1440],
          [addDays(shift.date, 1), (dow + 1) % 7, 0, e],
        ];
  const results = segments
    .filter(([, , segS, segE]) => segE > segS)
    .map(([date, day, segS, segE]) =>
      timeOffOn(availability, date)
        ? 'none'
        : segmentCoverage(availability.days?.[day], segS, segE)
    );

  if (results.every((r) => r === 'full')) return AVAILABILITY.AVAILABLE;
  if (results.every((r) => r === 'none')) return AVAILABILITY.UNAVAILABLE;
  return AVAILABILITY.PARTIAL;
}

/**
 * Total paid minutes for an employee across the 7 days starting
 * `weekStartISO`. Unpaid breaks are excluded.
 */
export function weeklyMinutes(shifts, employeeId, weekStartISO) {
  const days = new Set(weekDates(weekStartISO));
  return shifts
    .filter((s) => s.assigneeId === employeeId && days.has(s.date))
    .reduce((sum, s) => sum + shiftNetMinutes(s), 0);
}

/**
 * Weekly-hours status against an employee's optional limits:
 * 'over' when past their max, 'under' when below their target,
 * 'ok' otherwise (including when no limits are set).
 */
export function hoursStatus(minutes, employee) {
  if (employee?.maxHours != null && minutes > employee.maxHours * 60) return 'over';
  if (employee?.targetHours != null && minutes < employee.targetHours * 60) return 'under';
  return 'ok';
}

export function openShifts(shifts) {
  return shifts.filter((s) => !s.assigneeId);
}

/**
 * Checks moving (or copying) a shift onto another day and/or another
 * assignee, which is what a drag across the week grid asks for.
 *
 * An overlap with the target person's own shifts is the one hard
 * blocker, the same thing the grid already flags as a conflict; a shift
 * cannot be in two places at once, so there is nothing to warn about.
 * Everything softer comes back as a warning the caller can show and
 * still go ahead with, exactly as the shift editor does: time off,
 * availability, weekly hour limits, and attendance already taken for
 * the shift being moved.
 *
 * Returns { changed, blocked, warnings }: `changed` is false when the
 * target is where the shift already sits (a copy always changes
 * something), `blocked` is a message or null.
 */
export function evaluateMove(
  shift,
  { date, assigneeId = null },
  { shifts = [], employees = [], availability = {}, attendance = {} } = {},
  { copy = false } = {}
) {
  const to = assigneeId || null;
  const from = shift.assigneeId || null;
  const changed = copy || date !== shift.date || to !== from;
  const warnings = [];
  // A copy is a new record, so the shift it came from is one of the
  // shifts it can collide with; a move takes its own slot with it.
  const target = { ...shift, date, assigneeId: to, id: copy ? '' : shift.id };
  const employee = to ? (employees.find((e) => e.id === to) ?? null) : null;

  if (!isValidDate(date ?? '')) {
    return { changed, blocked: 'That is not a valid date.', warnings };
  }
  // Where the shift already sits is not a proposal, so there is nothing
  // to refuse yet. Checked before the assignee below: a shift still held
  // by somebody archived or deleted opens the Move dialog at its own
  // spot, and reporting that person as the reason the move is blocked
  // before any move was asked for reads as an error in the record. The
  // same block still lands the moment the day is changed on them.
  if (!changed) return { changed, blocked: null, warnings };
  if (to && !employee) {
    return { changed, blocked: 'That person is no longer on the team.', warnings };
  }
  if (employee && !employee.active) {
    return { changed, blocked: `${employee.name} is archived.`, warnings };
  }
  if (employee && findConflicts(target, shifts, to).length > 0) {
    return { changed, blocked: `${employee.name} already has an overlapping shift then.`, warnings };
  }

  if (employee) {
    const record = availability[to];
    const timeOff =
      timeOffOn(record, date) ??
      (isOvernight(shift.start, shift.end) ? timeOffOn(record, addDays(date, 1)) : null);
    if (timeOff) {
      warnings.push(`${employee.name} has time off then${timeOff.note ? ` (${timeOff.note})` : ''}.`);
    } else {
      const status = availabilityStatus(target, record);
      if (status === AVAILABILITY.UNAVAILABLE) {
        warnings.push(`${employee.name} is marked unavailable at this time.`);
      } else if (status === AVAILABILITY.PARTIAL) {
        warnings.push(`This only partially fits ${employee.name}’s availability.`);
      }
    }
    if (employee.maxHours != null) {
      const others = copy ? shifts : shifts.filter((s) => s.id !== shift.id);
      const projected =
        weeklyMinutes(others, to, startOfWeek(date)) + shiftNetMinutes(target);
      if (projected > employee.maxHours * 60) {
        warnings.push(
          `This puts ${employee.name} at ${formatHours(projected)} that week, over their ${employee.maxHours}h max.`
        );
      }
    }
  }
  // Attendance is keyed by shift, so it travels with a moved shift: onto
  // a day nobody worked, and onto whoever the shift lands on, whose
  // timesheet then pays out somebody else's clock times and carries
  // their lateness. A copy leaves the record behind on the original,
  // which is right.
  if (!copy && attendance[shift.id]) {
    warnings.push(
      to === from
        ? 'Attendance was already recorded for this shift.'
        : employee
          ? `The attendance already recorded for this shift becomes ${employee.name}’s.`
          : 'Unassigning takes the attendance already recorded for this shift off the timesheet.'
    );
  }
  return { changed, blocked: null, warnings };
}

/**
 * Ranked candidates for staffing a shift. Hard blockers are excluded
 * outright: inactive employees, time off on any day the shift touches,
 * overlapping shifts, being marked unavailable, and anyone the shift
 * would push past their weekly max. The rest are ordered by whether
 * they break one of the optional working-time limits (see
 * core/rules.js), then availability (full before partial), then by how
 * far below their weekly hour target they are, then by role match.
 * Breaking a soft limit demotes rather than excludes, so the ranking
 * stays honest without going empty. Each entry carries human-readable
 * `reasons` so the UI can show why someone is suggested. Returns at
 * most `limit` of { employee, status, deficitMinutes, roleMatch,
 * projectedMinutes, ruleWarnings, reasons }.
 */
export function suggestAssignees(shift, { employees, shifts, availability, rules = null }, limit = 3) {
  const weekStart = startOfWeek(shift.date);
  const others = shifts.filter((s) => s.id !== shift.id);
  const net = shiftNetMinutes(shift);
  const role = String(shift.role ?? '').trim().toLowerCase();

  const candidates = [];
  for (const employee of employees) {
    if (!employee.active || employee.id === shift.assigneeId) continue;
    const record = availability?.[employee.id];
    if (timeOffOn(record, shift.date)) continue;
    if (isOvernight(shift.start, shift.end) && timeOffOn(record, addDays(shift.date, 1))) continue;
    const status = availabilityStatus(shift, record);
    if (status === AVAILABILITY.UNAVAILABLE) continue;
    if (findConflicts(shift, others, employee.id).length > 0) continue;

    const current = weeklyMinutes(others, employee.id, weekStart);
    const projected = current + net;
    if (employee.maxHours != null && projected > employee.maxHours * 60) continue;

    const deficitMinutes =
      employee.targetHours != null ? Math.max(0, employee.targetHours * 60 - current) : 0;
    const roleMatch = Boolean(role) && String(employee.role ?? '').trim().toLowerCase() === role;

    const ruleWarnings = rules
      ? ruleViolations(shift, employee.id, others, rules, { name: employee.name })
      : [];

    const reasons = [status === AVAILABILITY.AVAILABLE ? 'Available' : 'Partially available'];
    if (deficitMinutes > 0) reasons.push(`${formatHours(deficitMinutes)} below target`);
    if (roleMatch) reasons.push('Role matches');
    for (const violation of ruleWarnings) reasons.push(violation.short);

    candidates.push({
      employee,
      status,
      deficitMinutes,
      roleMatch,
      projectedMinutes: projected,
      ruleWarnings,
      reasons,
    });
  }

  candidates.sort(
    (a, b) =>
      Number(a.ruleWarnings.length > 0) - Number(b.ruleWarnings.length > 0) ||
      (a.status === b.status ? 0 : a.status === AVAILABILITY.AVAILABLE ? -1 : 1) ||
      b.deficitMinutes - a.deficitMinutes ||
      Number(b.roleMatch) - Number(a.roleMatch) ||
      a.employee.name.localeCompare(b.employee.name)
  );
  return candidates.slice(0, limit);
}

/**
 * Staffing gaps for the given ISO dates against coverage requirements
 * ({ id, role, days, count, start?, end? }). A requirement applies on its
 * weekdays; a shift counts toward it when its role matches
 * (case-insensitive) and its time overlaps the requirement's window (the
 * whole day when no window is set), including overnight spill from the
 * previous day. Open shifts count too: coverage measures what is
 * planned, while the open-shifts row tracks what is unfilled.
 * Returns [{ date, requirement, scheduled, missing }].
 */
export function coverageGaps(shifts, requirements, dates) {
  const gaps = [];
  if (!requirements?.length || !dates?.length) return gaps;

  // Each requirement's window and each shift's span are the same numbers
  // on every day being checked, but deriving them means parsing a date
  // and two times. Doing that inside the date x requirement x shift loop
  // re-parses the whole dataset once per cell: the month overview asks
  // for 42 days at a time and redraws after every edit. Derive both once
  // up front and the loop below is left comparing integers.
  const normalize = (value) => String(value ?? '').trim().toLowerCase();
  const prepared = requirements.map((req) => {
    let winS = req.start ? (toMinutes(req.start) ?? 0) : 0;
    let winE = req.end ? (toMinutes(req.end) ?? 1440) : 1440;
    if (winE === 1439) winE = 1440;
    if (winE <= winS) {
      winS = 0;
      winE = 1440;
    }
    return { req, winS, winE, role: normalize(req.role) };
  });

  const wanted = new Set(prepared.map((p) => p.role));
  const rangesByRole = new Map();
  for (const shift of shifts) {
    const role = normalize(shift.role);
    if (!wanted.has(role)) continue;
    const range = absoluteRange(shift);
    if (range === null) continue;
    const held = rangesByRole.get(role);
    if (held) held.push(range);
    else rangesByRole.set(role, [range]);
  }

  for (const date of dates) {
    const dow = dayOfWeek(date);
    const base = dayNumber(date) * 1440;
    for (const { req, winS, winE, role } of prepared) {
      if (!req.days?.includes(dow)) continue;
      const lo = base + winS;
      const hi = base + winE;
      let scheduled = 0;
      for (const r of rangesByRole.get(role) ?? []) {
        if (r[0] < hi && lo < r[1]) scheduled += 1;
      }
      if (scheduled < req.count) {
        gaps.push({ date, requirement: req, scheduled, missing: req.count - scheduled });
      }
    }
  }
  return gaps;
}

export function shiftsOn(shifts, iso) {
  return shifts
    .filter((s) => s.date === iso)
    .sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0) || a.id.localeCompare(b.id));
}
