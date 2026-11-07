import { describe, it, expect } from 'vitest';
import { buildCalendar, buildICS, escapeICS, foldLine, icsFilename } from '../src/lib/ics.js';

describe('escapeICS', () => {
  it('escapes the RFC 5545 specials', () => {
    expect(escapeICS('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeICS('line1\nline2')).toBe('line1\\nline2');
    expect(escapeICS(null)).toBe('');
  });

  it('folds every line-break flavor, including a lone CR', () => {
    // A quoted CSV cell can carry a bare \r into a candidate name; raw
    // CR is as illegal in a content line as raw LF.
    expect(escapeICS('a\r\nb\rc\nd')).toBe('a\\nb\\nc\\nd');
  });
});

describe('buildICS', () => {
  const event = {
    title: 'Interview: Ada Lovelace (Engineer, Backend)',
    description: 'Panel: Lena, Sam\nBring questions',
    date: '2026-03-10',
    start: '14:30',
    end: '15:30',
    location: 'Room Ada',
    url: 'https://meet.example.com/x',
    uid: 'itv_1@hiring',
    now: new Date('2026-03-01T10:00:00Z'),
  };

  it('produces a valid VCALENDAR with CRLF line endings', () => {
    const ics = buildICS(event);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:itv_1@hiring');
    expect(ics).toContain('DTSTART:20260310T143000');
    expect(ics).toContain('DTEND:20260310T153000');
    expect(ics).toContain('DTSTAMP:20260301T100000Z');
  });

  it('pins the event to a real instant when it carries a zone', () => {
    const ics = buildICS({ ...event, timeZone: 'Europe/Berlin' });
    // 14:30 in Berlin on March 10 is 13:30 UTC, so every calendar app
    // shows it at the right moment whatever zone it is set to.
    expect(ics).toContain('DTSTART:20260310T133000Z');
    expect(ics).toContain('DTEND:20260310T143000Z');
  });

  it('pins summer-time slots by the offset actually in force', () => {
    const ics = buildICS({ ...event, date: '2026-07-10', timeZone: 'Europe/Berlin' });
    expect(ics).toContain('DTSTART:20260710T123000Z');
  });

  it('stays floating without a zone, and ignores one it cannot resolve', () => {
    expect(buildICS(event)).toContain('DTSTART:20260310T143000');
    expect(buildICS(event)).not.toContain('DTSTART:20260310T143000Z');
    expect(buildICS({ ...event, timeZone: 'Mars/Olympus' })).toContain('DTSTART:20260310T143000\r\n');
  });

  it('escapes commas in text fields but keeps structure intact', () => {
    const ics = buildICS(event);
    expect(ics).toContain('SUMMARY:Interview: Ada Lovelace (Engineer\\, Backend)');
    expect(ics).toContain('DESCRIPTION:Panel: Lena\\, Sam\\nBring questions');
  });

  it('keeps the URL a verbatim URI: no TEXT escapes for commas or semicolons', () => {
    // Teams/Meet links carry commas and semicolons in their queries;
    // calendar apps take the URL property verbatim, so a TEXT-escaped
    // backslash becomes part of the link and breaks it.
    const url = 'https://teams.example.com/l/meetup-join/0?context={%22Tid%22:%22a%22,%22Oid%22:%22b%22};x=1';
    const unfolded = buildICS({ ...event, url }).replace(/\r\n /g, '');
    const urlLine = unfolded.split('\r\n').find((l) => l.startsWith('URL:'));
    expect(urlLine).toBe(`URL:${url}`);
  });

  it('omits empty optional fields', () => {
    const ics = buildICS({ ...event, description: '', location: '', url: '' });
    expect(ics).not.toContain('DESCRIPTION');
    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('URL');
  });

  it('zero-pads unpadded times to the RFC 5545 HHMMSS shape', () => {
    const ics = buildICS({ ...event, start: '9:30', end: '9:45' });
    expect(ics).toContain('DTSTART:20260310T093000');
    expect(ics).toContain('DTEND:20260310T094500');
  });

  it('refuses to build an event without a full date', () => {
    // "DTSTART:T093000" (missing date) or a 6-digit date from a
    // hand-edited backup makes clients reject the entire file; failing
    // loudly beats downloading a corrupt invite under a success toast.
    expect(() => buildICS({ ...event, date: undefined })).toThrow(/date/i);
    expect(() => buildICS({ ...event, date: '' })).toThrow(/date/i);
    expect(() => buildICS({ ...event, date: '2026-3-4' })).toThrow(/date/i);
  });

  it('omits DTEND rather than emit a malformed one', () => {
    const ics = buildICS({ ...event, end: undefined });
    expect(ics).not.toContain('DTEND');
    expect(ics).not.toContain('undefined');
    expect(ics).toContain('DTSTART:20260310T143000');
  });
});

describe('foldLine', () => {
  it('leaves short lines untouched', () => {
    expect(foldLine('SUMMARY:Short')).toBe('SUMMARY:Short');
  });

  it('folds long lines to 75 octets with space-led continuations', () => {
    const folded = foldLine(`DESCRIPTION:${'a'.repeat(200)}`);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const line of physical) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    for (const continuation of physical.slice(1)) {
      expect(continuation.startsWith(' ')).toBe(true);
    }
    // Unfolding (strip CRLF + space) restores the original content line.
    expect(folded.replaceAll('\r\n ', '')).toBe(`DESCRIPTION:${'a'.repeat(200)}`);
  });

  it('counts octets, not characters, for multi-byte text', () => {
    const folded = foldLine(`SUMMARY:${'é'.repeat(100)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe('buildICS folding', () => {
  it('keeps every physical line within 75 octets', () => {
    const ics = buildICS({
      title: 'Interview with a very long panel of interviewers and notes attached',
      description: 'Panel: ' + Array.from({ length: 12 }, (_, i) => `Interviewer Number ${i}`).join(', '),
      date: '2026-03-10',
      start: '14:30',
      end: '15:30',
      uid: 'x@hiring',
      now: new Date('2026-03-01T10:00:00Z'),
    });
    for (const line of ics.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});

describe('icsFilename', () => {
  it('slugifies the title', () => {
    expect(icsFilename('Interview – Ada Lovelace!')).toBe('interview-ada-lovelace.ics');
    expect(icsFilename('')).toBe('event.ics');
  });
});

describe('buildCalendar', () => {
  const event = (over = {}) => ({
    title: 'Interview: Ada',
    date: '2026-03-10',
    start: '14:30',
    end: '15:30',
    uid: 'itv_1@hiring',
    ...over,
  });

  it('holds many events in one calendar, with a name clients can show', () => {
    const ics = buildCalendar([event(), event({ uid: 'itv_2@hiring', date: '2026-03-11' })], {
      name: 'Interviews · Acme',
      now: new Date('2026-03-01T10:00:00Z'),
    });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/END:VCALENDAR/g)).toHaveLength(1);
    expect(ics).toContain('NAME:Interviews · Acme');
    expect(ics).toContain('X-WR-CALNAME:Interviews · Acme');
    expect(ics).toContain('UID:itv_2@hiring');
    // One DTSTAMP per event, from the single `now` the caller passed.
    expect(ics.match(/DTSTAMP:20260301T100000Z/g)).toHaveLength(2);
  });

  it('tells subscribers how often to come back, when asked to', () => {
    const ics = buildCalendar([event()], { name: 'Interviews', refreshHours: 1 });
    // RFC 7986's property and the one Outlook/Apple have always read.
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(ics).toContain('X-PUBLISHED-TTL:PT1H');
    // A one-off download says nothing about refreshing.
    expect(buildCalendar([event()])).not.toContain('REFRESH-INTERVAL');
    expect(buildICS({ ...event(), now: new Date('2026-03-01T10:00:00Z') })).not.toContain('REFRESH-INTERVAL');
  });

  it('skips an unusable event rather than refusing the whole calendar', () => {
    const ics = buildCalendar([event({ date: 'soon' }), event({ uid: 'ok@hiring' })]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:ok@hiring');
  });

  it('stays a valid calendar with no events at all', () => {
    const ics = buildCalendar([]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
  });
});
