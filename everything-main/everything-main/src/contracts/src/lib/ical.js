/**
 * iCalendar output (RFC 5545), as pure string work.
 *
 * The app's whole promise is that you will not miss a renewal, and its only
 * delivery mechanism was a badge on a nav item that exists while the app is
 * open. A notice window is 30 or 60 days; nobody opens a contract manager
 * weekly. So the deadlines go where every other deadline in this user's life
 * already arrives: their calendar.
 *
 * The fiddly parts are all here and tested: folding at 75 octets, escaping
 * text, all-day dates with an exclusive DTEND, and UIDs stable enough that
 * re-importing updates an event instead of duplicating it.
 */

import {
  todayISO, isValidISO, addDays, addMonths, formatDate, daysBetween,
  renewalInfo, ENDING_DECISIONS,
} from './dates.js';
import { repeatMonths, occurrenceDue, withinSeries } from './store.js';

export const PRODID = '-//Puter//Contract Manager//EN';

/** Reminders before each deadline, in days. */
export const DEFAULT_ALARMS = [7, 1];

const encoder = new TextEncoder();

/** Escape a TEXT value: backslash, semicolon, comma and newlines. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets, continuing with a leading space.
 * Counted in UTF-8 bytes, not characters, and never split inside one.
 */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** '2026-03-12' → '20260312' for a DATE value. */
export function icsDate(iso) {
  return String(iso).replace(/-/g, '');
}

/** A UTC timestamp for DTSTAMP. */
export function icsStamp(ms = Date.now()) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * SEQUENCE has to rise every time a record is edited, and stay small enough
 * to be a valid integer: minutes since 2020 does both.
 */
export function sequenceFor(updatedAt) {
  const ms = Number(updatedAt) || 0;
  return Math.max(0, Math.floor((ms - Date.UTC(2020, 0, 1)) / 60000));
}

/**
 * One all-day VEVENT. `date` is the day it lands on; DTEND is the next day,
 * because DTEND is exclusive for DATE values and calendars that get this
 * wrong show a two-day event.
 */
function eventLines(event, stamp) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `DTSTART;VALUE=DATE:${icsDate(event.date)}`,
    `DTEND;VALUE=DATE:${icsDate(addDays(event.date, 1))}`,
    `SUMMARY:${escapeText(event.summary)}`,
    'TRANSP:TRANSPARENT',
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.url) lines.push(`URL:${escapeText(event.url)}`);
  if (event.categories?.length) lines.push(`CATEGORIES:${event.categories.map(escapeText).join(',')}`);
  for (const days of event.alarms || []) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-P${days}D`,
      `DESCRIPTION:${escapeText(event.summary)}`,
      'END:VALARM'
    );
  }
  lines.push('END:VEVENT');
  return lines;
}

/** A whole calendar: CRLF-joined, folded, ready to download or serve. */
export function buildCalendar(events, { name = 'Contract deadlines', stamp = icsStamp() } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    'X-PUBLISHED-TTL:PT12H',
  ];
  for (const event of events) lines.push(...eventLines(event, stamp));
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/* ------------------------------------------------------------------ */
/* Contract → events                                                   */
/* ------------------------------------------------------------------ */

const uidFor = (parts) => `${parts.filter(Boolean).join('-')}@contract-manager.puter`;

function money(contract) {
  if (contract.value === null || contract.value === undefined) return '';
  return `${contract.currency} ${Number(contract.value).toLocaleString('en-US')}`;
}

function contextLines(contract, contactName) {
  return [
    contactName ? `Counterparty: ${contactName}` : '',
    money(contract) ? `Value: ${money(contract)} ${contract.billing}` : '',
    contract.noticeDays ? `Notice period: ${contract.noticeDays} days` : '',
  ].filter(Boolean);
}

/**
 * Every dated deadline this contract creates, from `today` onward: the notice
 * deadline, this term's end and a bounded number of future renewals, and each
 * dated obligation (with a bounded run of a repeating one's occurrences).
 *
 * Overdue obligations are included — they still need doing — but nothing else
 * from the past is, because a calendar full of last year's renewals is noise.
 */
export function contractEvents(contract, {
  today = todayISO(),
  baseUrl = '',
  terms = 3,
  occurrences = 6,
  alarms = DEFAULT_ALARMS,
  contactName = '',
} = {}) {
  if (contract.status !== 'active' || contract.deletedAt) return [];
  const events = [];
  const link = baseUrl ? `${baseUrl}#/contracts/${contract.id}` : '';
  const sequence = sequenceFor(contract.updatedAt);
  const info = renewalInfo(contract, today);
  const context = contextLines(contract, contactName);

  /* Notice deadline: the date the decision has to be made by. */
  if (info.date && info.noticeDate && !info.handled && daysBetween(today, info.noticeDate) >= 0) {
    events.push({
      uid: uidFor(['cm', contract.id, 'notice', info.noticeDate]),
      date: info.noticeDate,
      sequence,
      summary: `Cancel or renegotiate ${contract.title} by ${formatDate(info.noticeDate)}`,
      description: [
        `The term ${contract.autoRenew ? 'renews' : 'ends'} ${formatDate(info.date)}, so notice is due ${contract.noticeDays} days earlier.`,
        ...context,
      ].join('\n'),
      url: link,
      categories: ['Contract notice'],
      alarms,
    });
  }

  /* This term's end, then a bounded number of future renewals. */
  const ending = ENDING_DECISIONS.includes(contract.decision?.kind)
    && contract.decision.forTermEnd === info.date;
  if (info.date && daysBetween(today, info.date) >= 0) {
    const termCount = contract.autoRenew && !ending ? Math.max(1, terms) : 1;
    const months = Math.max(1, Number(contract.termMonths) || 12);
    // Later renewals are counted from the original end date, as nextTermEnd
    // does, so a clamped month-end (Jan 31 → Feb 28) never drifts the rest
    // of the series (Mar 28 instead of Mar 31).
    const dates = [info.date];
    for (let j = 1; dates.length < termCount && j <= 1200; j++) {
      const next = addMonths(contract.endDate, months * j);
      if (next > info.date) dates.push(next);
    }
    for (const date of dates) {
      events.push({
        uid: uidFor(['cm', contract.id, 'term', date]),
        date,
        sequence,
        summary: ending
          ? `${contract.title} ends`
          : `${contract.title} ${contract.autoRenew ? 'renews' : 'ends'}`,
        description: [
          ending
            ? (contract.decision.kind === 'notice-given'
              ? 'Notice was given, so the term ends here.'
              : 'Renewal was declined, so the term ends here.')
            : contract.autoRenew
              ? `Auto-renews for another ${months} months unless cancelled.`
              : 'Fixed term, ends on this date.',
          ...context,
        ].join('\n'),
        url: link,
        categories: [contract.autoRenew && !ending ? 'Contract renewal' : 'Contract end'],
        alarms,
      });
    }
  }

  /* Dated obligations, including the next few of a repeating one. */
  for (const ob of contract.obligations || []) {
    if (ob.done || !isValidISO(ob.due)) continue;
    const dates = [ob.due];
    if (ob.repeat && repeatMonths(ob.repeat.every)) {
      const start = (ob.history || []).length;
      for (let i = 1; i < Math.max(1, occurrences); i++) {
        const index = start + i;
        if (!withinSeries(ob.repeat, index, contract)) break;
        dates.push(occurrenceDue(ob.repeat, index));
      }
    }
    for (const date of dates) {
      // Keep overdue work visible; skip nothing else from the past.
      if (daysBetween(today, date) < 0 && date !== ob.due) continue;
      events.push({
        uid: uidFor(['cm', contract.id, 'ob', ob.id, date]),
        date,
        sequence: sequenceFor(contract.updatedAt),
        summary: `${ob.text} (${contract.title})`,
        description: [
          `Owed by: ${ob.owner === 'them' ? 'the counterparty' : ob.owner === 'mutual' ? 'both parties' : 'us'}`,
          ob.repeat ? `Repeats ${ob.repeat.every}.` : '',
          ...context,
        ].filter(Boolean).join('\n'),
        url: link,
        categories: ['Contract obligation'],
        alarms,
      });
    }
  }

  return events;
}

/** Every contract's events, in date order. */
export function bookEvents(contracts, options = {}) {
  const contactName = options.contactName;
  const out = [];
  for (const contract of contracts) {
    out.push(...contractEvents(contract, {
      ...options,
      contactName: typeof contactName === 'function' ? contactName(contract) : contactName,
    }));
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.uid.localeCompare(b.uid)));
}

/** Whether this contract has anything dated worth putting in a calendar. */
export function hasCalendarEvents(contract, options = {}) {
  return contractEvents(contract, options).length > 0;
}
