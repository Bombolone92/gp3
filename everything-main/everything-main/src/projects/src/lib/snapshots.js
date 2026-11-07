/**
 * Restore points: what to keep, and what to let go.
 *
 * Snapshots ride along with normal use — the first change to a project on
 * any given day copies the version that was on disk before it — so the only
 * question this module answers is which of them survive. Pure, so the
 * retention policy can be tested without touching a filesystem.
 *
 * File names are `<YYYY-MM-DD>.json`, with `-1`, `-2`… appended when a
 * second snapshot is taken the same day (a restore takes one first, so that
 * the restore itself is reversible).
 */

import { addDays, parseISO, isValidISO } from './dates.js';

export const SNAPSHOT_VERSION = 1;

/** Roughly a week of days, then roughly a month of weeks. */
export const KEEP_DAILY = 7;
export const KEEP_WEEKLY = 4;

const NAME_RE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/;

export function snapshotName(dateISO, n = 0) {
  return n > 0 ? `${dateISO}-${n}.json` : `${dateISO}.json`;
}

/** `2026-08-06-1.json` → { date, seq }, or null when it is not one of ours. */
export function parseSnapshotName(name) {
  const m = NAME_RE.exec(String(name ?? ''));
  if (!m || !isValidISO(m[1])) return null;
  return { date: m[1], seq: m[2] ? Number(m[2]) : 0 };
}

/** The Monday of a date's week — a stable key for "same week". */
export function weekStart(iso) {
  const day = (parseISO(iso).getDay() + 6) % 7; // Monday = 0
  return addDays(iso, -day);
}

/**
 * planSnapshotRetention(names) → { keep, drop }
 *
 * Every file from the most recent KEEP_DAILY days is kept, then the newest
 * remaining day in each of the next KEEP_WEEKLY weeks. Everything else
 * goes, so storage stays flat however long the project runs.
 */
export function planSnapshotRetention(names) {
  const parsed = [];
  for (const name of names) {
    const info = parseSnapshotName(name);
    if (info) parsed.push({ name, ...info });
  }
  // Newest first, and within a day the highest sequence first.
  parsed.sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq);

  const days = [...new Set(parsed.map((p) => p.date))];
  const keptDays = new Set(days.slice(0, KEEP_DAILY));

  const byWeek = new Map();
  for (const date of days.slice(KEEP_DAILY)) {
    const key = weekStart(date);
    if (!byWeek.has(key)) byWeek.set(key, date); // days are already newest-first
  }
  for (const date of [...byWeek.values()].slice(0, KEEP_WEEKLY)) keptDays.add(date);

  return {
    keep: parsed.filter((p) => keptDays.has(p.date)).map((p) => p.name),
    drop: parsed.filter((p) => !keptDays.has(p.date)).map((p) => p.name),
  };
}

/** The next free name for a snapshot taken today. */
export function nextSnapshotName(existing, dateISO) {
  const taken = new Set(existing);
  for (let n = 0; n < 100; n++) {
    const name = snapshotName(dateISO, n);
    if (!taken.has(name)) return name;
  }
  return snapshotName(dateISO, Date.now() % 1000);
}
