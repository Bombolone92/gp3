/**
 * Visit generation for jobs. A schedule describes the first visit and how
 * it repeats; generateVisitDates returns the calendar dates of every visit.
 *
 * schedule: {
 *   start: 'YYYY-MM-DD',
 *   repeat: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly',
 *   interval: 1,               // every N units
 *   weekdays: [1, 3],          // weekly only, 0 = Sunday; defaults to start's weekday
 *   monthlyBy: 'day' | 'weekday', // 12th of the month, or 2nd Tuesday
 *   end: { type: 'count', count: 10 } | { type: 'until', date: 'YYYY-MM-DD' }
 * }
 */
import { addDays, addMonths, parseISODate, toISODate, weekday } from './dates.js';

export const MAX_VISITS = 400;

export function generateVisitDates(schedule) {
  if (!schedule?.start) return [];
  const repeat = schedule.repeat || 'none';
  if (repeat === 'none') return [schedule.start];

  const interval = Math.max(1, Math.floor(Number(schedule.interval) || 1));
  const end = schedule.end || { type: 'count', count: 12 };
  const limit = end.type === 'count' ? Math.min(MAX_VISITS, Math.max(1, Number(end.count) || 1)) : MAX_VISITS;
  const until = end.type === 'until' ? end.date : null;
  const out = [];
  const push = (d) => {
    if (until && d > until) return false;
    if (d < schedule.start) return true;
    out.push(d);
    return out.length < limit;
  };

  if (repeat === 'daily') {
    for (let d = schedule.start; push(d); d = addDays(d, interval));
    return out;
  }

  if (repeat === 'weekly') {
    const days = (schedule.weekdays?.length ? [...schedule.weekdays] : [weekday(schedule.start)]).sort((a, b) => a - b);
    let weekStart = addDays(schedule.start, -weekday(schedule.start));
    for (let guard = 0; guard < 5000; guard++) {
      for (const wd of days) {
        if (!push(addDays(weekStart, wd))) return out;
      }
      weekStart = addDays(weekStart, 7 * interval);
    }
    return out;
  }

  if (repeat === 'monthly') {
    const byWeekday = schedule.monthlyBy === 'weekday';
    const startDate = parseISODate(schedule.start);
    const nth = Math.floor((startDate.getDate() - 1) / 7); // 0-based occurrence
    const wd = startDate.getDay();
    for (let i = 0; i < 5000; i++) {
      let d;
      if (byWeekday) {
        const first = parseISODate(addMonths(schedule.start.slice(0, 8) + '01', i * interval));
        const offset = (wd - first.getDay() + 7) % 7;
        const day = 1 + offset + nth * 7;
        const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        // "5th Friday" falls back to the last one in short months.
        const finalDay = day > last ? day - 7 : day;
        d = toISODate(new Date(first.getFullYear(), first.getMonth(), finalDay));
      } else {
        d = addMonths(schedule.start, i * interval);
      }
      if (!push(d)) return out;
    }
    return out;
  }

  if (repeat === 'yearly') {
    for (let i = 0; i < MAX_VISITS; i++) {
      if (!push(addMonths(schedule.start, 12 * i * interval))) return out;
    }
    return out;
  }
  return [schedule.start];
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human description: "Every 2 weeks on Monday, Thursday, 12 visits" (without the count when `end` is false). */
export function describeSchedule(schedule, { end: withEnd = true } = {}) {
  if (!schedule || !schedule.repeat || schedule.repeat === 'none') return 'One-off';
  const n = Math.max(1, Number(schedule.interval) || 1);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[schedule.repeat];
  let text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (schedule.repeat === 'weekly') {
    const days = schedule.weekdays?.length ? schedule.weekdays : [weekday(schedule.start)];
    text += ` on ${[...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ')}`;
  } else if (schedule.repeat === 'monthly' && schedule.start) {
    const d = parseISODate(schedule.start);
    text += schedule.monthlyBy === 'weekday'
      ? ` on the ${ORDINAL[Math.floor((d.getDate() - 1) / 7)]} ${DAY_NAMES[d.getDay()]}`
      : ` on day ${d.getDate()}`;
  }
  const end = schedule.end;
  if (withEnd && end?.type === 'count') text += `, ${end.count} visit${end.count === 1 ? '' : 's'}`;
  return text;
}
