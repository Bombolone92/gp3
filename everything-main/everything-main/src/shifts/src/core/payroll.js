/**
 * Labor cost math. Rates are plain numbers on employees (hourlyRate);
 * cost is always computed from net minutes, so unpaid breaks are free.
 */
import { startOfWeek } from '../lib/time.js';
import { shiftNetMinutes } from './shift-time.js';

/** Currencies offered in the picker; formatting accepts any ISO code. */
export const CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK',
  'DKK', 'PLN', 'CZK', 'INR', 'BRL', 'MXN', 'ZAR', 'AED', 'SGD', 'HKD',
  'KRW', 'TRY',
];

/** 1234.5 -> "$1,234.50" (or the closest the runtime can manage). */
export function formatMoney(amount, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Projected cost of the assigned shifts on `dates`: net hours times the
 * assignee's hourly rate, so unpaid breaks are free.
 *
 * With `thresholdHours` and `multiplier` set, paid minutes past the
 * threshold in a week cost the multiplier times the base rate, and the
 * split is applied to shifts in the order they are worked, so the fifth
 * long shift of a week is the one that costs more. The threshold is
 * weekly, so shifts are grouped by the Monday of their own week: a range
 * covering a month prices each week on its own.
 *
 * Hours are counted for everybody who holds a shift, including someone
 * who has since been deleted (their worked shifts keep the assignment so
 * timesheets survive); money is only counted for people who have a rate.
 * ratedCount/employeeCount let callers flag partial data ("3 of 5 people
 * have rates").
 *
 * Returns { cost, baseCost, overtimeCost, minutes, overtimeMinutes,
 * ratedCount, employeeCount, byDay, byRole, byEmployee }, where each
 * breakdown is a sorted array of { key, minutes, cost }.
 */
export function laborCost(shifts, employees, dates, { thresholdHours = null, multiplier = null } = {}) {
  const days = new Set(dates);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const thresholdMinutes = thresholdHours == null ? null : Number(thresholdHours) * 60;
  const rate = multiplier == null ? null : Number(multiplier);
  const overtimeOn =
    thresholdMinutes !== null &&
    rate !== null &&
    Number.isFinite(thresholdMinutes) &&
    Number.isFinite(rate) &&
    rate > 1;

  const involved = new Set();
  const rated = new Set();
  const buckets = { byDay: new Map(), byRole: new Map(), byEmployee: new Map() };
  const weekMinutes = new Map();
  let cost = 0;
  let baseCost = 0;
  let overtimeCost = 0;
  let minutes = 0;
  let overtimeMinutes = 0;

  const add = (bucket, key, net, money) => {
    const entry = buckets[bucket].get(key) ?? { key, minutes: 0, cost: 0 };
    entry.minutes += net;
    entry.cost += money;
    buckets[bucket].set(key, entry);
  };

  // Include the whole week when finding the overtime threshold, even
  // when a report starts midweek or selects only some dates. Only the
  // requested dates contribute to the returned totals and breakdowns.
  const weeks = new Set([...days].map(startOfWeek));
  const ordered = shifts
    .filter((s) => s.assigneeId && (days.has(s.date) || (overtimeOn && weeks.has(startOfWeek(s.date)))))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        String(a.start).localeCompare(String(b.start)) ||
        a.id.localeCompare(b.id)
    );

  for (const shift of ordered) {
    const employee = byId.get(shift.assigneeId) ?? null;
    const net = shiftNetMinutes(shift);
    const key = `${shift.assigneeId}|${startOfWeek(shift.date)}`;
    const before = weekMinutes.get(key) ?? 0;
    weekMinutes.set(key, before + net);
    if (!days.has(shift.date)) continue;

    involved.add(shift.assigneeId);
    minutes += net;

    let money = 0;
    if (employee?.hourlyRate != null) {
      rated.add(employee.id);
      let overtime = 0;
      if (overtimeOn) {
        overtime =
          Math.max(0, before + net - thresholdMinutes) - Math.max(0, before - thresholdMinutes);
      }
      const base = net - overtime;
      const baseMoney = (base / 60) * employee.hourlyRate;
      const overtimeMoney = (overtime / 60) * employee.hourlyRate * (overtimeOn ? rate : 1);
      money = baseMoney + overtimeMoney;
      baseCost += baseMoney;
      overtimeCost += overtimeMoney;
      overtimeMinutes += overtime;
      cost += money;
    }

    add('byDay', shift.date, net, money);
    add('byRole', String(shift.role ?? '').trim() || 'No role', net, money);
    add('byEmployee', shift.assigneeId, net, money);
  }

  const sorted = (bucket, compare) => [...buckets[bucket].values()].sort(compare);
  return {
    cost,
    baseCost,
    overtimeCost,
    minutes,
    overtimeMinutes,
    ratedCount: rated.size,
    employeeCount: involved.size,
    byDay: sorted('byDay', (a, b) => a.key.localeCompare(b.key)),
    byRole: sorted('byRole', (a, b) => b.cost - a.cost || b.minutes - a.minutes || a.key.localeCompare(b.key)),
    byEmployee: sorted('byEmployee', (a, b) => b.cost - a.cost || b.minutes - a.minutes),
  };
}

/**
 * A projected cost against an optional weekly budget. `ratio` is the
 * share of the budget used (it can exceed 1), `difference` is how much
 * over or under. Everything is null or zero when no budget is set,
 * which is the default: a team that does not track cost sees nothing.
 */
export function budgetStatus(cost, budget) {
  const target = budget == null || Number(budget) <= 0 ? null : Number(budget);
  if (target === null || !Number.isFinite(target)) {
    return { budget: null, ratio: null, over: false, difference: 0 };
  }
  return { budget: target, ratio: cost / target, over: cost > target, difference: cost - target };
}
