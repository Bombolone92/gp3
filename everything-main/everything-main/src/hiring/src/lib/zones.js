/**
 * Time zones: the browser's own, validation, and the wall-clock ↔ instant
 * maths interviews need. No zone database ships with the app — every
 * answer comes from `Intl`, which carries a current one.
 *
 * A stored zone is an IANA id ('Europe/Berlin'); '' means "the reader's
 * own clock", which is what every interview meant before zones existed.
 * Every function here tolerates a zone `Intl` rejects (a hand-edited
 * backup): a bad zone must never throw mid-render.
 */

import { toMinutes } from './dates.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/* Formatters are cached per zone: constructing an Intl.DateTimeFormat is
   an order of magnitude slower than formatting with one, and the reminder
   tick and the schedule both format per interview. */
const partsFormatters = new Map();
const nameFormatters = new Map();
const timeFormatters = new Map();

function cached(store, timeZone, build) {
  if (store.has(timeZone)) return store.get(timeZone);
  let formatter = null;
  try {
    formatter = build(timeZone);
  } catch {
    formatter = null; // Not a zone this browser knows.
  }
  store.set(timeZone, formatter);
  return formatter;
}

const partsFormatter = (timeZone) =>
  cached(partsFormatters, timeZone, (tz) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  );

/** The zone this browser is set to, or '' if it will not say. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

export function isValidTimeZone(timeZone) {
  const id = String(timeZone ?? '').trim();
  return id !== '' && partsFormatter(id) !== null;
}

/** A storable zone id, or '' for "the reader's own clock". */
export function normalizeTimeZone(timeZone) {
  const id = String(timeZone ?? '').trim();
  return isValidTimeZone(id) ? id : '';
}

/** Every zone this browser knows, for a picker. Falls back to the basics. */
export function knownTimeZones() {
  try {
    const list = Intl.supportedValuesOf?.('timeZone');
    if (Array.isArray(list) && list.length > 0) return list;
  } catch {
    // Older engine: fall through to the short list.
  }
  return [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Berlin',
    'Europe/Athens',
    'Africa/Lagos',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
  ];
}

/** Minutes `timeZone` is ahead of UTC at that instant (DST included). */
export function zoneOffsetAt(timeZone, instant = new Date()) {
  const formatter = partsFormatter(String(timeZone ?? '').trim());
  if (!formatter) return -instant.getTimezoneOffset();
  const parts = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((asUTC - instant.getTime()) / 60000);
}

/**
 * The absolute instant of a wall-clock date and time in a zone, or null
 * when either is malformed. No zone means the reader's own clock.
 */
export function zonedInstant(isoDate, time, timeZone) {
  if (!ISO_DATE.test(String(isoDate ?? ''))) return null;
  const minutes = toMinutes(time);
  if (minutes === null) return null;
  const [y, m, d] = String(isoDate).split('-').map(Number);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const zone = normalizeTimeZone(timeZone);
  if (!zone) return new Date(y, m - 1, d, hours, mins);
  // Two passes: the offset depends on the instant, and the instant on the
  // offset. The first guess lands within an hour, which is enough for the
  // second to read the offset actually in force (DST boundaries included).
  const naive = Date.UTC(y, m - 1, d, hours, mins);
  const first = naive - zoneOffsetAt(zone, new Date(naive)) * 60000;
  return new Date(naive - zoneOffsetAt(zone, new Date(first)) * 60000);
}

/** 'GMT+2', 'PDT', 'IST' — how the zone names itself right then. */
export function zoneAbbreviation(timeZone, instant = new Date()) {
  const zone = normalizeTimeZone(timeZone);
  if (!zone) return '';
  const formatter = cached(nameFormatters, zone, (tz) =>
    new Intl.DateTimeFormat(undefined, { timeZone: tz, timeZoneName: 'short' })
  );
  if (!formatter) return '';
  return formatter.formatToParts(instant).find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** The clock time an instant shows in a zone: '2:30 PM' in the viewer's locale. */
export function formatTimeInZone(instant, timeZone) {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) return '';
  const zone = normalizeTimeZone(timeZone);
  const formatter = cached(timeFormatters, zone, (tz) =>
    new Intl.DateTimeFormat(undefined, { ...(tz ? { timeZone: tz } : {}), hour: 'numeric', minute: '2-digit' })
  );
  return formatter ? formatter.format(instant) : '';
}

/** 'Europe/Berlin' -> 'Berlin · Europe', for a picker's option text. */
export function zoneLabel(timeZone) {
  const id = String(timeZone ?? '').trim();
  if (!id) return '';
  const parts = id.split('/');
  const city = parts.at(-1).replaceAll('_', ' ');
  return parts.length > 1 ? `${city} · ${parts[0].replaceAll('_', ' ')}` : city;
}
