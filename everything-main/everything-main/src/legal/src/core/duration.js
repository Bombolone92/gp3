/**
 * Time entry durations. Stored as whole minutes; shown as decimal hours
 * (the way legal time is billed) or as "1h 12m".
 */
import { mulCents } from './money.js';

const MAX_MINUTES = 24 * 31 * 60; // a month of round-the-clock work; anything longer is a typo

/**
 * Parse what a person typed into a duration field. Returns minutes, or null.
 *   "1.5" or "1,5"     -> 90   (decimal hours)
 *   "1:12"             -> 72   (hours:minutes)
 *   "1h 12m", "1h12"   -> 72
 *   "45m", "45 min"    -> 45
 *   "2h", "2 hrs"      -> 120
 *   ".3", ".3h"        -> 18
 */
export function parseDuration(input) {
  const minutes = parse(input);
  return minutes !== null && minutes > MAX_MINUTES ? null : minutes;
}

function parse(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.round(input * 60) : null;
  const s = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.');
  if (!s) return null;
  let m = /^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) {
    const min = Number(m[2]);
    if (min > 59) return null;
    return Number(m[1]) * 60 + min + (Number(m[3] || 0) >= 30 ? 1 : 0);
  }
  m = /^(?:(\d*\.?\d+)\s*h(?:ours?|rs?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?|s)?)?)?$/.exec(s);
  if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 60) + Number(m[2] || 0);
  m = /^(\d+)\s*h\s*(\d+)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d*\.?\d+)$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 60);
  return null;
}

/**
 * Round minutes up to the firm's billing increment (6 minutes = 0.1 hour by
 * default). Zero stays zero.
 */
export function roundUpMinutes(minutes, increment = 6) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const inc = Math.max(1, Math.round(Number(increment) || 1));
  return m === 0 ? 0 : Math.ceil(m / inc) * inc;
}

/** 72 -> "1.20" (hours, two decimals). */
export function formatHoursDecimal(minutes, digits = 2) {
  return ((Number(minutes) || 0) / 60).toFixed(digits);
}

/** 72 -> "1h 12m" */
export function formatHM(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Milliseconds -> "01:02:03" for running timers. */
export function formatClock(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)}`;
}

/** Value of a time entry in cents: hours times hourly rate. */
export function timeValue(minutes, rateCents) {
  return mulCents(Number(rateCents) || 0, Number(minutes) || 0, 60);
}
