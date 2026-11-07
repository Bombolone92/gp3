/**
 * Calendar geometry: date ranges for each view, the month grid, and the
 * side-by-side layout of overlapping timed events. Pure functions.
 */
import { addDays, addMonths, startOfWeek, startOfMonth, timeToMinutes, minutesToTime, formatDate, parseISODate } from './dates.js';

export const VIEWS = ['day', 'week', 'month', 'agenda'];
export const DAY_MINUTES = 24 * 60;

/** Start and end minute of a timed event. A missing or inverted end becomes 30 minutes. */
export function eventSpan(e) {
  const start = Math.max(0, Math.min(DAY_MINUTES - 15, timeToMinutes(e.start) ?? 9 * 60));
  let end = timeToMinutes(e.end);
  if (end === null || end <= start) end = start + 30;
  return { start, end: Math.min(DAY_MINUTES, end) };
}

export function snap(minutes, step = 15) {
  return Math.round(minutes / step) * step;
}

/**
 * Lay out one day's timed events. Overlapping events form a cluster; each
 * event gets a column inside its cluster (first free column, greedy), and
 * spans to the right while the neighbouring columns are free.
 * Returns [{ event, start, end, col, cols, span }], sorted by start.
 */
export function layoutDay(events) {
  const items = events.map((event) => ({ event, ...eventSpan(event) })).sort((a, b) => a.start - b.start || b.end - a.end || String(a.event.id).localeCompare(String(b.event.id)));
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const colEnds = []; // per column, end of the last event placed in it
    for (const it of cluster) {
      let c = colEnds.findIndex((end) => end <= it.start);
      if (c === -1) {
        c = colEnds.length;
        colEnds.push(it.end);
      } else colEnds[c] = it.end;
      it.col = c;
    }
    const cols = colEnds.length;
    for (const it of cluster) {
      // Grow into columns to the right that are free for the whole span.
      let span = 1;
      for (let c = it.col + 1; c < cols; c++) {
        const blocked = cluster.some((o) => o !== it && o.col === c && o.start < it.end && o.end > it.start);
        if (blocked) break;
        span++;
      }
      out.push({ ...it, cols, span });
    }
    cluster = [];
    clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.start >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  flush();
  return out;
}

/** First and last date shown by a view. */
export function viewRange(view, date, weekStart = 0) {
  if (view === 'day') return [date, date];
  if (view === 'week') {
    const s = startOfWeek(date, weekStart);
    return [s, addDays(s, 6)];
  }
  if (view === 'month') {
    const grid = monthGrid(date, weekStart);
    return [grid[0], grid[grid.length - 1]];
  }
  return [date, addDays(date, 29)];
}

/** Six weeks of dates covering the month of `date`. */
export function monthGrid(date, weekStart = 0) {
  const first = startOfWeek(startOfMonth(date), weekStart);
  const out = [];
  for (let i = 0; i < 42; i++) out.push(addDays(first, i));
  return out;
}

/** Where prev/next goes from `date` for a view. */
export function stepDate(view, date, dir) {
  if (view === 'day') return addDays(date, dir);
  if (view === 'week') return addDays(date, 7 * dir);
  if (view === 'month') return addMonths(startOfMonth(date), dir);
  return addDays(date, 30 * dir);
}

/** Toolbar title: "Oct 12, 2026", "Oct 11 to 17, 2026", "October 2026". */
export function viewTitle(view, date, weekStart = 0) {
  if (view === 'day') return formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'month') return formatDate(date, { month: 'long', year: 'numeric' });
  const [a, b] = viewRange(view, date, weekStart);
  const da = parseISODate(a);
  const db = parseISODate(b);
  const sameYear = da.getFullYear() === db.getFullYear();
  const sameMonth = sameYear && da.getMonth() === db.getMonth();
  if (sameMonth) return `${formatDate(a, { month: 'short', day: 'numeric' })} to ${db.getDate()}, ${db.getFullYear()}`;
  if (sameYear) return `${formatDate(a, { month: 'short', day: 'numeric' })} to ${formatDate(b, { month: 'short', day: 'numeric' })}, ${db.getFullYear()}`;
  return `${formatDate(a)} to ${formatDate(b)}`;
}

/** An event moved to a new day and start minute, keeping its length. */
export function moveEvent(e, date, startMin) {
  const { start, end } = eventSpan(e);
  const len = end - start;
  const s = Math.max(0, Math.min(DAY_MINUTES - len, startMin));
  return { date, start: minutesToTime(s), end: minutesToTime(Math.min(DAY_MINUTES - 1, s + len)) };
}

/** An event with a new end minute (at least 15 minutes long). */
export function resizeEvent(e, endMin) {
  const { start } = eventSpan(e);
  return { end: minutesToTime(Math.max(start + 15, Math.min(DAY_MINUTES - 1, endMin))) };
}
