import { describe, it, expect } from 'vitest';
import { buildScheduleICS } from '../src/core/ics.js';

const state = {
  employees: [
    { id: 'e1', name: 'Ava Chen' },
    { id: 'e2', name: 'Liam Torres' },
  ],
  shifts: [
    { id: 's1', date: '2026-08-03', start: '09:00', end: '17:00', role: 'Floor', assigneeId: 'e1', note: 'Bring keys; door code 1234, ask Sam' },
    { id: 's2', date: '2026-08-03', start: '22:00', end: '06:00', role: 'Night', assigneeId: 'e2' },
    { id: 's3', date: '2026-08-04', start: '09:00', end: '13:00', role: 'Open', assigneeId: null },
    { id: 's4', date: '2026-08-20', start: '09:00', end: '13:00', role: 'Floor', assigneeId: 'e1' },
    { id: 's5', date: '2026-08-05', start: '08:00', end: '16:00', role: 'Floor', assigneeId: 'gone', breakMinutes: 30 },
  ],
};

const options = { from: '2026-08-03', to: '2026-08-09', generatedAt: '2026-08-01T10:00:00.000Z' };

describe('buildScheduleICS', () => {
  const { ics, count } = buildScheduleICS(state, options);

  it('emits one VEVENT per assigned shift in range', () => {
    expect(count).toBe(3);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).not.toContain('s3@'); // open shift skipped
    expect(ics).not.toContain('s4@'); // out of range
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('derives stable UIDs from shift ids and stamps the export time', () => {
    expect(ics).toContain('UID:s1@shifts.app');
    expect(ics).toContain('DTSTAMP:20260801T100000Z');
  });

  it('writes role and employee name into SUMMARY, keeping former employees readable', () => {
    expect(ics).toContain('SUMMARY:Floor (Ava Chen)');
    expect(ics).toContain('SUMMARY:Floor (Former employee)');
  });

  it('falls back to the name alone when the role was cleared', () => {
    const cleared = {
      employees: [{ id: 'e1', name: 'Ava Chen' }],
      shifts: [{ id: 'x1', date: '2026-08-03', start: '09:00', end: '17:00', role: '', assigneeId: 'e1' }],
    };
    expect(buildScheduleICS(cleared, options).ics).toContain('SUMMARY:Ava Chen');
  });

  it('ends overnight shifts on the next day', () => {
    expect(ics).toContain('DTSTART:20260803T220000');
    expect(ics).toContain('DTEND:20260804T060000');
  });

  it('escapes text and carries notes and breaks in DESCRIPTION', () => {
    expect(ics).toContain('door code 1234\\, ask Sam');
    expect(ics).toContain('Bring keys\\;');
    expect(ics).toContain('DESCRIPTION:30 min unpaid break');
  });

  it('escapes every kind of line break so text cannot start a new event', () => {
    const injected = {
      employees: [{ id: 'e1', name: 'Ava' }],
      shifts: [
        {
          id: 's1',
          date: '2026-08-03',
          start: '09:00',
          end: '17:00',
          role: 'Floor',
          assigneeId: 'e1',
          note: 'one\rEND:VEVENT\rBEGIN:VEVENT\r\ntwo\nthree',
        },
      ],
    };
    const out = buildScheduleICS(injected, options).ics;
    // The text survives verbatim, but only ever inside its own content
    // line: nothing in it starts a line, and no bare CR or LF is left.
    expect(out.split('\r\n').filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(out.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
    expect(out).toContain('DESCRIPTION:one\\nEND:VEVENT\\nBEGIN:VEVENT\\ntwo\\nthree');
  });

  it('folds long content lines at 74 octets with a continuation space', () => {
    const noisy = {
      employees: [{ id: 'e1', name: 'A'.repeat(40) }],
      shifts: [
        {
          id: 's1',
          date: '2026-08-03',
          start: '09:00',
          end: '17:00',
          role: 'R'.repeat(80),
          assigneeId: 'e1',
        },
      ],
    };
    const out = buildScheduleICS(noisy, options).ics;
    for (const line of out.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    expect(out).toContain('\r\n '); // folded continuation
  });

  it('folds multi-byte content by octets without splitting characters', () => {
    const emoji = {
      employees: [{ id: 'e1', name: 'Ava' }],
      shifts: [
        {
          id: 's1',
          date: '2026-08-03',
          start: '09:00',
          end: '17:00',
          role: 'Floor',
          assigneeId: 'e1',
          note: `a${'🎉'.repeat(60)}`,
        },
      ],
    };
    const out = buildScheduleICS(emoji, options).ics;
    expect(out.isWellFormed()).toBe(true); // no lone surrogates from folding
    const encoder = new TextEncoder();
    for (const line of out.split('\r\n')) {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    }
    // Unfolding restores the original text intact.
    expect(out.replaceAll('\r\n ', '')).toContain('🎉'.repeat(60));
  });

  it('filters to a single employee when asked', () => {
    const { ics: filtered, count: filteredCount } = buildScheduleICS(state, {
      ...options,
      employeeId: 'e1',
    });
    expect(filteredCount).toBe(1);
    expect(filtered).toContain('UID:s1@shifts.app');
    expect(filtered).not.toContain('UID:s2@shifts.app');
  });
});
