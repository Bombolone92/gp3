import { describe, it, expect } from 'vitest';
import { eventsOn, toICS } from '../src/core/calendar.js';

describe('calendar', () => {
  const events = [
    { id: 'a', title: 'Fire drill', date: '2026-10-12', allDay: false, start: '10:00', end: '10:15' },
    { id: 'b', title: 'Closed; staff, training', date: '2026-10-12', endDate: '2026-10-13', allDay: true, kind: 'closure' },
    { id: 'c', title: 'Later', date: '2026-10-20' },
  ];

  it('lists events on a day, spanning multi-day ones, all-day first', () => {
    expect(eventsOn(events, '2026-10-12').map((e) => e.id)).toEqual(['b', 'a']);
    expect(eventsOn(events, '2026-10-13').map((e) => e.id)).toEqual(['b']);
    expect(eventsOn(events, '2026-10-14')).toEqual([]);
  });

  it('exports valid iCalendar with escaping and exclusive all-day ends', () => {
    const ics = toICS(events, { name: 'Acorn', now: new Date('2026-10-01T00:00:00Z') });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261012T100000');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261014');
    expect(ics).toContain('SUMMARY:Closed\\; staff\\, training');
    expect(ics.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});
