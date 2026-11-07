/**
 * Optional working-time limits: minimum rest between shifts, maximum
 * hours in a day, and maximum consecutive days worked.
 *
 * All three are off by default and none of them ever blocks anything.
 * They are the mistakes a rota actually makes, and the ones staff
 * notice: a 22:00 to 06:00 finish followed by a 10:00 start passes every
 * other check in this app, as do twelve days straight and a fourteen
 * hour day split across two shifts. So they are warnings, presented the
 * way the overtime warnings already are, and they are three numbers the
 * manager sets rather than a compliance engine.
 *
 * Hours are counted the way the rest of the app counts them: net of
 * unpaid breaks. Rest is measured on the absolute timeline, so an
 * overnight shift's gap to the next morning comes out right.
 */
import { addDays, formatDate, formatHours } from '../lib/time.js';
import { absoluteRange, shiftNetMinutes } from './shift-time.js';

export const EMPTY_RULES = {
  minRestHours: null,
  maxDailyHours: null,
  maxConsecutiveDays: null,
};

/** Longest run of consecutive days worth walking; a guard, not a limit. */
const MAX_RUN_SCAN = 400;

const positiveOrNull = (value, max) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > max) return null;
  return n;
};

export function normalizeRules(rules) {
  return {
    minRestHours: positiveOrNull(rules?.minRestHours, 24),
    maxDailyHours: positiveOrNull(rules?.maxDailyHours, 24),
    maxConsecutiveDays: positiveOrNull(rules?.maxConsecutiveDays, 60),
  };
}

export function hasRules(rules) {
  const r = normalizeRules(rules);
  return r.minRestHours !== null || r.maxDailyHours !== null || r.maxConsecutiveDays !== null;
}

/**
 * Which of the three limits putting `shift` on `employeeId` would break.
 * `shifts` is anything that person already holds (their own list is
 * enough, and cheapest); the shift being checked is excluded by id, so
 * an existing shift can be re-checked in place. Returns
 * [{ rule, short, message }], empty when nothing is set or nothing is
 * broken. Never a blocker: overlaps are the only hard rule, and
 * findConflicts owns those.
 */
export function ruleViolations(shift, employeeId, shifts, rules, { name = 'This employee' } = {}) {
  const { minRestHours, maxDailyHours, maxConsecutiveDays } = normalizeRules(rules);
  if (!employeeId || (minRestHours === null && maxDailyHours === null && maxConsecutiveDays === null)) {
    return [];
  }
  const range = absoluteRange(shift);
  if (range === null) return [];
  const others = shifts.filter((s) => s.assigneeId === employeeId && s.id !== shift.id);
  const violations = [];

  if (minRestHours !== null) {
    // An overnight shift can finish the day after it starts, so a rest
    // gap under 24 hours can connect start dates two days apart.
    const earliest = addDays(shift.date, -2);
    const latest = addDays(shift.date, 2);
    let worst = null;
    for (const other of others) {
      if (other.date < earliest || other.date > latest) continue;
      const otherRange = absoluteRange(other);
      if (otherRange === null) continue;
      // An overlap is a conflict, not a rest problem; that is reported
      // separately and would double up here.
      if (otherRange[0] < range[1] && range[0] < otherRange[1]) continue;
      const gap = otherRange[0] >= range[1] ? otherRange[0] - range[1] : range[0] - otherRange[1];
      if (gap < minRestHours * 60 && (worst === null || gap < worst.gap)) {
        worst = { gap, other };
      }
    }
    if (worst) {
      violations.push({
        rule: 'rest',
        short: 'Short rest',
        message:
          worst.gap === 0
            ? `${name} would work this back to back with their ${formatDate(worst.other.date)} shift, with ${minRestHours}h rest set.`
            : `${name} would get ${formatHours(worst.gap)} rest around their ${formatDate(worst.other.date)} shift, under the ${minRestHours}h minimum.`,
      });
    }
  }

  if (maxDailyHours !== null) {
    const sameDay = others.filter((s) => s.date === shift.date);
    const total = sameDay.reduce((sum, s) => sum + shiftNetMinutes(s), 0) + shiftNetMinutes(shift);
    if (total > maxDailyHours * 60) {
      violations.push({
        rule: 'daily',
        short: 'Long day',
        message: `${name} would work ${formatHours(total)} on ${formatDate(shift.date)}, over the ${maxDailyHours}h daily limit.`,
      });
    }
  }

  if (maxConsecutiveDays !== null) {
    const worked = new Set(others.map((s) => s.date));
    worked.add(shift.date);
    let run = 1;
    for (let day = addDays(shift.date, -1), i = 0; worked.has(day) && i < MAX_RUN_SCAN; day = addDays(day, -1), i += 1) {
      run += 1;
    }
    for (let day = addDays(shift.date, 1), i = 0; worked.has(day) && i < MAX_RUN_SCAN; day = addDays(day, 1), i += 1) {
      run += 1;
    }
    if (run > maxConsecutiveDays) {
      violations.push({
        rule: 'consecutive',
        short: `${run} days in a row`,
        message: `${name} would be working ${run} days in a row, over the ${maxConsecutiveDays}-day limit.`,
      });
    }
  }

  return violations;
}

/**
 * Limits already broken by what an employee holds across `dates`: what
 * the week grid flags on their row, without opening anything. One entry
 * per rule, since a row has space for a warning and not for a list.
 */
export function scheduleRuleViolations(employeeId, shifts, dates, rules, options = {}) {
  if (!hasRules(rules)) return [];
  const days = new Set(dates);
  const mine = shifts.filter((s) => s.assigneeId === employeeId);
  const byRule = new Map();
  for (const shift of mine) {
    if (!days.has(shift.date)) continue;
    for (const violation of ruleViolations(shift, employeeId, mine, rules, options)) {
      if (!byRule.has(violation.rule)) byRule.set(violation.rule, violation);
    }
  }
  return [...byRule.values()];
}
