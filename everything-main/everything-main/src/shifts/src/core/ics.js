/**
 * iCalendar (.ics) export of the schedule: one VEVENT per assigned
 * shift, generated entirely client side. Times are written as floating
 * local times (no time zone), matching how the app treats shifts as
 * wall-clock ranges. UIDs derive from shift ids so re-importing an
 * updated export replaces events instead of duplicating them.
 */
import { addDays, isOvernight } from '../lib/time.js';

/**
 * RFC 5545 text escaping: backslash, semicolon, comma, line break.
 *
 * Every kind of break has to go, not just LF. A lone CR survives a round
 * trip through an imported backup, and calendar apps are lenient enough
 * to treat one as the end of a content line: left raw it would let a
 * note or role split the event it sits in and start another.
 */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|[\r\n]/g, '\\n');
}

const encoder = new TextEncoder();

/**
 * Folds a content line at 74 octets, continuing with CRLF + space.
 * RFC 5545 measures lines in octets and forbids splitting inside a
 * multi-octet character, so the fold counts UTF-8 bytes per code point
 * (splitting mid-character would corrupt emoji and other non-ASCII
 * text into replacement characters when the file is saved).
 */
function fold(line) {
  const parts = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (octets + size > 74 && current) {
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

/** '2026-08-05' + '09:30' -> '20260805T093000' (floating local time). */
function dtLocal(dateISO, hhmm) {
  return `${dateISO.replaceAll('-', '')}T${hhmm.replace(':', '')}00`;
}

/** ISO timestamp -> '20260805T093000Z' for DTSTAMP. */
function dtStamp(iso) {
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/**
 * Builds the .ics text for assigned shifts in [fromISO, toISO],
 * optionally limited to one employee. Returns { ics, count }.
 */
export function buildScheduleICS(
  state,
  { from, to, employeeId = null, generatedAt = new Date().toISOString() } = {}
) {
  const byId = new Map(state.employees.map((e) => [e.id, e]));
  const shifts = state.shifts
    .filter(
      (s) =>
        s.assigneeId &&
        s.date >= from &&
        s.date <= to &&
        (!employeeId || s.assigneeId === employeeId)
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  const stamp = dtStamp(generatedAt);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Shifts//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Shifts schedule',
  ];

  for (const shift of shifts) {
    const employee = byId.get(shift.assigneeId);
    const name = employee?.name ?? 'Former employee';
    const endDate = isOvernight(shift.start, shift.end) ? addDays(shift.date, 1) : shift.date;
    const description = [
      shift.breakMinutes > 0 ? `${shift.breakMinutes} min unpaid break` : null,
      shift.note || null,
    ]
      .filter(Boolean)
      .join('\n');

    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(shift.id)}@shifts.app`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dtLocal(shift.date, shift.start)}`,
      `DTEND:${dtLocal(endDate, shift.end)}`,
      // A shift can carry no role (a managed role deleted with "clear
      // everywhere"); the name alone beats a leading empty label.
      `SUMMARY:${escapeText(shift.role ? `${shift.role} (${name})` : name)}`,
      ...(description ? [`DESCRIPTION:${escapeText(description)}`] : []),
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');
  return { ics: `${lines.map(fold).join('\r\n')}\r\n`, count: shifts.length };
}
