/**
 * iCalendar (.ics) event generation, so interviews can be added to any
 * calendar app (Apple/Google/Outlook). Pure and deterministic: the caller
 * supplies `now` and `uid`.
 */

import { toMinutes } from './dates.js';
import { normalizeTimeZone, zonedInstant } from './zones.js';

/** Escape per RFC 5545: backslash, semicolon, comma, newline. */
export function escapeICS(text) {
  return String(text ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll('\r\n', '\\n')
    // A lone CR (a quoted CSV cell can carry one into a name) is as
    // illegal in a content line as a bare LF: parsers split on it and
    // the remainder becomes a property-less line that sinks the event.
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n');
}

/** 'HH:MM' (padded or not) -> 'HHMMSS', or null when malformed. */
function icsTime(time) {
  const minutes = toMinutes(time);
  if (minutes === null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;
}

/** '2026-03-04' + '14:30' -> '20260304T143000' (floating local time). */
function icsDateTime(date, time) {
  // RFC 5545 DATE-TIME is exactly HHMMSS: an unpadded '9:30' must become
  // 093000, not 93000 — clients reject the whole event otherwise. A
  // malformed time degrades to midnight rather than to garbage.
  return `${String(date ?? '').replaceAll('-', '')}T${icsTime(time) ?? '000000'}`;
}

const encoder = new TextEncoder();

/**
 * RFC 5545 3.1: content lines longer than 75 octets must be folded onto
 * continuation lines that start with one space. Counted in octets, not
 * characters, so multi-byte names cannot push a line over the limit.
 */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (octets + size > 75) {
      parts.push(current);
      current = ' ';
      octets = 1;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** A UTC DATE-TIME ('20260310T130000Z') for a wall time in a zone. */
function icsUTC(date, time, timeZone) {
  const instant = zonedInstant(date, time, timeZone);
  return instant ? `${instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}` : null;
}

const icsStamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * One VEVENT. With a `timeZone`, times are pinned as UTC instants, so the
 * event lands at the right moment in every calendar app whatever zone the
 * recipient's is set to. Without one they stay floating local time —
 * right for an onsite, and what every event written before zones existed
 * meant.
 */
function eventLines({ title, description = '', date, start, end, location = '', url = '', uid, timeZone = '' }, stamp) {
  // The time half degrades to midnight below, but there is no benign
  // fallback for the date: "DTSTART:T093000" (or a 6-digit date from a
  // hand-edited backup) makes clients reject the entire file, which is
  // worse than refusing loudly here.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
    throw new Error('A calendar event needs a full date (YYYY-MM-DD).');
  }
  const zone = normalizeTimeZone(timeZone);
  const startAt = zone ? icsUTC(date, start, zone) : null;
  const endAt = zone ? icsUTC(date, end, zone) : null;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeICS(uid ?? `${icsDateTime(date, start)}@hiring`)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${startAt ?? icsDateTime(date, start)}`,
  ];
  // A VEVENT without DTEND is valid (zero duration); one that reads
  // "Tundefined00" invalidates the file.
  if (endAt) lines.push(`DTEND:${endAt}`);
  else if (!zone && icsTime(end) !== null) lines.push(`DTEND:${icsDateTime(date, end)}`);
  lines.push(`SUMMARY:${escapeICS(title)}`);
  if (description) lines.push(`DESCRIPTION:${escapeICS(description)}`);
  if (location) lines.push(`LOCATION:${escapeICS(location)}`);
  // URL is a URI value (RFC 5545 §3.3.13), not TEXT: consumers take it
  // verbatim, so TEXT-escaping a comma or semicolon (Teams and Meet links
  // carry them in queries) would bake a literal backslash into the link.
  // Only line breaks must go — they would terminate the content line.
  if (url) lines.push(`URL:${String(url).replace(/[\r\n]+/g, '')}`);
  lines.push('END:VEVENT');
  return lines;
}

/** Builds a VCALENDAR string with one VEVENT. */
export function buildICS({ now = new Date(), ...event }) {
  return wrapCalendar(eventLines(event, icsStamp(now)));
}

/**
 * A whole calendar: many events in one subscribable file. `name` is what
 * calendar apps show as the calendar's title, and `refreshHours` is how
 * often a subscriber should come back for it. An event whose date is
 * unusable is skipped rather than taking the feed down with it — a feed
 * is written unattended, and one bad record must not stop the rest from
 * reaching the user's calendar.
 */
export function buildCalendar(events, { name = 'Interviews', now = new Date(), refreshHours = 0 } = {}) {
  const stamp = icsStamp(now);
  const lines = [];
  for (const event of events) {
    try {
      lines.push(...eventLines(event, stamp));
    } catch {
      continue;
    }
  }
  return wrapCalendar(lines, name, refreshHours);
}

function wrapCalendar(eventLineList, name = '', refreshHours = 0) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hiring//Applicant Tracking//EN'];
  if (name) {
    // Both spellings: X-WR-CALNAME is what Apple/Google read, NAME is the
    // RFC 7986 property newer clients prefer.
    lines.push(`NAME:${escapeICS(name)}`, `X-WR-CALNAME:${escapeICS(name)}`);
  }
  if (refreshHours > 0) {
    // How often a subscriber should re-fetch. Without it every client
    // falls back to its own default, which for a hosted .ics is hours to
    // a day — long enough that a rescheduled interview reaches the
    // subscriber's calendar after the interview. Both spellings again:
    // REFRESH-INTERVAL is RFC 7986 §5.7, X-PUBLISHED-TTL is what Outlook
    // and Apple have read for years.
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`, `X-PUBLISHED-TTL:PT${refreshHours}H`);
  }
  lines.push(...eventLineList, 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** 'Interview – Ada Lovelace' -> 'interview-ada-lovelace.ics' */
export function icsFilename(title) {
  const slug = String(title ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'event'}.ics`;
}
