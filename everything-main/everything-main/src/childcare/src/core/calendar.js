/** Calendar helpers: which events fall on a day, and iCalendar export. */
import { addDays } from './dates.js';

/** Events on a day (including multi-day events that span it), all-day first, then by time. */
export function eventsOn(events, day) {
  return events
    .filter((e) => e.date && e.date <= day && (e.endDate && e.endDate > e.date ? e.endDate : e.date) >= day)
    .sort((a, b) => (a.allDay === false ? 1 : 0) - (b.allDay === false ? 1 : 0) || String(a.start || '').localeCompare(String(b.start || '')) || String(a.title).localeCompare(String(b.title)));
}

function esc(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Lines longer than 75 octets are folded, as RFC 5545 requires. */
function fold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 75;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 75) cut--;
    // Never split a surrogate pair: half an emoji becomes U+FFFD in the file.
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

const compact = (d) => d.replace(/-/g, '');
const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function toICS(events, { name = 'School calendar', now = new Date() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Everything//Childcare//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) {
    if (!e.date) continue;
    const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
    lines.push('BEGIN:VEVENT', `UID:${e.id}@childcare`, `DTSTAMP:${stamp(now)}`);
    if (e.allDay === false && e.start) {
      lines.push(`DTSTART:${compact(e.date)}T${e.start.replace(':', '')}00`);
      // DTEND must be after DTSTART; without a later end the event ends when it starts.
      const end = e.end || e.start;
      if (last > e.date || end > e.start) lines.push(`DTEND:${compact(last)}T${end.replace(':', '')}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDays(last, 1))}`);
    }
    lines.push(`SUMMARY:${esc(e.kind === 'closure' && !/closed/i.test(e.title) ? `Closed: ${e.title}` : e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
