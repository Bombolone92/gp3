import { describe, it, expect, vi } from 'vitest';
import { parseCalendar, calendarWhen } from '../src/lib/calendar.js';
import { splitMessage, parseHeaders, listCalendarInvites, extractText, previewText } from '../src/lib/mime.js';
import { calendarCard } from '../src/ui/calendar.js';

const ics = (lines = [], method = 'REQUEST') => [
  'BEGIN:VCALENDAR', 'VERSION:2.0', `METHOD:${method}`, 'BEGIN:VEVENT',
  'UID:design-review@example.com', 'SUMMARY:Design review',
  'DTSTART;TZID=America/Vancouver:20260921T100000',
  'DTEND;TZID=America/Vancouver:20260921T110000',
  ...lines, 'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n');
const message = (parts) => [
  'Content-Type: multipart/mixed; boundary=mail', '',
  ...parts.flatMap((part) => ['--mail', part]), '--mail--', '',
].join('\r\n');
const parse = (raw) => {
  const { head, body } = splitMessage(raw);
  const headers = parseHeaders(head);
  return { invites: listCalendarInvites(body, headers), text: extractText(body, headers), preview: previewText(body, headers) };
};

describe('calendar invitations', () => {
  it('reads folded, escaped text and quoted parameters, ignoring nested alarms', () => {
    const [event] = parseCalendar(ics([
      'LOCATION:Room 2\\, west wing',
      'DESCRIPTION:First line\\nSecond line with a long', '  continuation\\; and \\backslash',
      'ORGANIZER;CN="Doe; Jane: Design":mailto:jane@example.com',
      'ATTENDEE;CN=Alex:mailto:alex@example.com',
      'BEGIN:VALARM', 'SUMMARY:Wrong title', 'END:VALARM',
    ]));
    expect(event.title).toBe('Design review');
    expect(event.location).toBe('Room 2, west wing');
    expect(event.description).toContain('First line\nSecond line with a long continuation;');
    expect(event.organizer).toEqual({ name: 'Doe; Jane: Design', email: 'jane@example.com' });
    expect(event.attendees).toEqual([{ name: 'Alex', email: 'alex@example.com' }]);
    expect(calendarWhen(event)).toContain('10:00');
    expect(calendarWhen(event)).toContain('11:00');
    expect(calendarWhen(event)).toContain('America/Vancouver');
  });

  it('keeps all-day dates independent of local time and excludes the end date', () => {
    const [event] = parseCalendar(ics().replace(
      /DTSTART[^\r]+\r\nDTEND[^\r]+/,
      'DTSTART;VALUE=DATE:20260921\r\nDTEND;VALUE=DATE:20260923'));
    expect(calendarWhen(event)).toContain('September 21');
    expect(calendarWhen(event)).toContain('September 22');
    expect(calendarWhen(event)).not.toContain('September 23');
    expect(calendarWhen(event)).toContain('All day');
  });

  it('labels UTC, floating times, and custom time zones without guessing offsets', () => {
    for (const [date, zone] of [
      ['DTSTART:20260921T100000Z', 'UTC'],
      ['DTSTART:20260921T100000', 'Local time'],
      ['DTSTART;TZID="Custom Standard Time":20260921T100000', 'Custom Standard Time'],
    ]) {
      const [event] = parseCalendar(ics().replace(/DTSTART[^\r]+/, date).replace(/DTEND[^\r]+\r\n/, ''));
      expect(calendarWhen(event)).toContain(`(${zone})`);
    }
  });

  it('shows duration-based invitations, including multi-day events', () => {
    const timed = ics().replace(/DTEND[^\r]+/, 'DURATION:PT1H30M');
    expect(calendarWhen(parseCalendar(timed)[0])).toContain('1 hour, 30 minutes');
    const allDay = timed.replace(/DTSTART[^\r]+/, 'DTSTART;VALUE=DATE:20260921')
      .replace('PT1H30M', 'P2D');
    expect(calendarWhen(parseCalendar(allDay)[0])).toContain('September 22');
    expect(calendarWhen(parseCalendar(allDay)[0])).not.toContain('September 23');
  });

  it('rejects invalid dates, truncated calendars, and unrelated components', () => {
    expect(parseCalendar(ics().replace('20260921T100000', '20260230T100000'))).toEqual([]);
    expect(parseCalendar(ics().replace('END:VCALENDAR', ''))).toEqual([]);
    expect(parseCalendar(ics().replaceAll('VEVENT', 'VTODO'))).toEqual([]);
    expect(parseCalendar('BEGIN:VEVENT\r\nDTSTART:20260921T100000Z\r\nEND:VEVENT')).toEqual([]);
  });

  it('decodes nested MIME alternatives and deduplicates an attached copy', () => {
    const raw = message([
      'Content-Type: multipart/alternative; boundary=alt\r\n\r\n--alt\r\nContent-Type: text/plain\r\n\r\nSee you there.\r\n--alt\r\nContent-Type: text/calendar; method=REQUEST\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n' + ics().replaceAll('=', '=3D') + '\r\n--alt--',
      'Content-Type: application/octet-stream; name=invite.ics\r\nContent-Transfer-Encoding: base64\r\n\r\n' + btoa(ics()),
    ]);
    const { invites, text, preview } = parse(new TextEncoder().encode(raw));
    expect(invites).toHaveLength(1);
    expect(text).toBe('See you there.');
    expect(preview).toBe('See you there.');
    expect(new TextDecoder().decode(invites[0].file.bytes())).toBe(ics());
  });

  it('renders root calendar-only mail without exposing ICS as the body or snippet', () => {
    const result = parse('Content-Type: text/calendar\r\n\r\n' + ics());
    expect(result.invites).toHaveLength(1);
    expect(result.text).toBe('');
    expect(result.preview).toBe('');
  });

  it('does not surface invitations inside forwarded mail or attached multiparts', () => {
    expect(parse(message(['Content-Type: message/rfc822\r\n\r\nContent-Type: text/calendar\r\n\r\n' + ics()])).invites).toEqual([]);
    expect(parse('Content-Disposition: attachment; filename=message.mime\r\n' + message([
      'Content-Type: text/calendar\r\n\r\n' + ics(),
    ])).invites).toEqual([]);
  });

  it('keeps distinct events and recurrence instances', () => {
    const two = ics().replace('END:VCALENDAR', 'BEGIN:VEVENT\r\nUID:design-review@example.com\r\nRECURRENCE-ID:20260922T100000\r\nDTSTART:20260922T100000\r\nSUMMARY:Next review\r\nEND:VEVENT\r\nEND:VCALENDAR');
    expect(parse('Content-Type: text/calendar\r\n\r\n' + two).invites).toHaveLength(2);
  });

  it('renders sender data as text, rejects unsafe URLs, and downloads the actual invite', () => {
    const { invites: [event] } = parse('Content-Type: text/calendar\r\n\r\n' + ics([
      'LOCATION:<img src=x onerror=alert(1)>', 'URL:javascript:alert(1)',
      'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij',
      'ATTENDEE;CN=Alex:mailto:alex@example.com',
    ]));
    const download = vi.fn();
    const card = calendarCard(event, download);
    expect(card.querySelector('img')).toBeNull();
    expect(card.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(card.querySelectorAll('a')).toHaveLength(1);
    expect(card.querySelector('a').rel).toBe('noopener noreferrer');
    expect(card.querySelector('summary').textContent).toBe('1 guest');
    card.querySelector('button').click();
    expect(download).toHaveBeenCalledWith(event.file);
  });

  it('marks cancellations and responses without offering a join action', () => {
    const [event] = parseCalendar(ics(['URL:https://example.com'], 'CANCEL'));
    const card = calendarCard(event, vi.fn());
    expect(card.classList.contains('is-cancelled')).toBe(true);
    expect(card.textContent).toContain('Event cancelled');
    expect(card.querySelector('a')).toBeNull();
    expect(calendarCard(parseCalendar(ics([], 'REPLY'))[0], vi.fn()).textContent).toContain('Invitation response');
  });
});
