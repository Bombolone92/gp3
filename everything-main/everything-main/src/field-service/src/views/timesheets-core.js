/** Time entry math shared by timesheets, job costing and reports. */

/** Parse a local "YYYY-MM-DDTHH:MM" timestamp. */
export function parseLocal(s) {
  if (!s) return null;
  const [d, t = '00:00'] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [hh, mm] = t.split(':').map(Number);
  return new Date(y, m - 1, day, hh, mm || 0);
}

export function toLocalStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Minutes worked for an entry; running entries count up to `now`. */
export function entryMinutes(entry, now = new Date()) {
  if (!entry) return 0;
  if (Number.isFinite(entry.minutes) && !entry.start) return entry.minutes;
  const start = parseLocal(entry.start);
  const end = entry.end ? parseLocal(entry.end) : now;
  if (!start || !end) return 0;
  const breakMin = Number(entry.breakMinutes) || 0;
  return Math.max(0, Math.round((end - start) / 60000) - breakMin);
}

export function isRunning(entry) {
  return !!entry?.start && !entry.end;
}

/** Sum minutes per member per date for a set of entries. */
export function totalsByMemberDay(entries, now = new Date()) {
  const out = new Map();
  for (const e of entries) {
    const key = `${e.memberId}|${e.date}`;
    out.set(key, (out.get(key) || 0) + entryMinutes(e, now));
  }
  return out;
}
