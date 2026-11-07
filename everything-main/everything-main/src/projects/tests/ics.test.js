import { describe, it, expect } from 'vitest';
import {
  buildCalendar, projectEvents, calendarEvents, countEvents,
  escapeIcsText, foldIcsLine, icsDate, icsStamp, icsSequence, taskUid, milestoneUid,
} from '../src/lib/ics.js';

const NOW = new Date('2026-08-20T09:15:00Z');

const doc = () => ({
  id: 'p1',
  name: 'Launch',
  columns: [{ id: 'c1', name: 'To do' }, { id: 'c2', name: 'Done', done: true }],
  labels: [{ id: 'l1', name: 'Design' }],
  members: [{ id: 'm1', name: 'Maya' }],
  milestones: [{ id: 'ms1', name: 'Beta', date: '2026-09-01', description: 'First 50' }],
  tasks: [
    {
      id: 't1', title: 'Wireframes', columnId: 'c1',
      startDate: '2026-08-24', dueDate: '2026-08-26',
      description: 'Sketch it', labelIds: ['l1'], assigneeIds: ['m1'], milestoneId: 'ms1',
      updatedAt: Date.UTC(2026, 7, 20, 9, 0),
    },
    { id: 't2', title: 'One day', columnId: 'c1', dueDate: '2026-08-30', labelIds: [], assigneeIds: [] },
    { id: 't3', title: 'Finished', columnId: 'c2', dueDate: '2026-08-21', labelIds: [], assigneeIds: [] },
    { id: 't4', title: 'No dates', columnId: 'c1', labelIds: [], assigneeIds: [] },
  ],
});

describe('value encoding', () => {
  it('escapes exactly what RFC 5545 gives meaning to', () => {
    expect(escapeIcsText('a,b;c\\d')).toBe('a\\,b\\;c\\\\d');
    expect(escapeIcsText('two\nlines')).toBe('two\\nlines');
    expect(escapeIcsText(null)).toBe('');
  });

  it('folds long lines at 75 octets, continuing with a space', () => {
    const folded = foldIcsLine(`SUMMARY:${'x'.repeat(200)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0]).toHaveLength(75);
    for (const line of lines.slice(1)) expect(line.startsWith(' ')).toBe(true);
  });

  it('folds by bytes without splitting a character', () => {
    const folded = foldIcsLine(`SUMMARY:${'é'.repeat(80)}`);
    for (const line of folded.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
      expect(line.includes('�')).toBe(false);
    }
  });

  it('leaves a short line exactly as it was', () => {
    expect(foldIcsLine('VERSION:2.0')).toBe('VERSION:2.0');
  });

  it('writes dates and stamps in the basic forms', () => {
    expect(icsDate('2026-08-25')).toBe('20260825');
    expect(icsStamp(NOW)).toBe('20260820T091500Z');
  });

  it('keeps SEQUENCE a small integer that only moves forward', () => {
    expect(icsSequence(undefined)).toBe(0);
    expect(icsSequence(Date.UTC(2019, 0, 1))).toBe(0);
    const early = icsSequence(Date.UTC(2026, 0, 1));
    const later = icsSequence(Date.UTC(2026, 0, 2));
    expect(later).toBeGreaterThan(early);
    expect(later).toBeLessThan(2 ** 31 - 1);
  });
});

describe('projectEvents', () => {
  const events = (opts = {}) => projectEvents(doc(), { baseUrl: 'https://app/', ...opts });

  it('takes dated, unfinished tasks and every milestone', () => {
    expect(events().map((e) => e.summary)).toEqual([
      'Launch: Wireframes',
      'Launch: One day',
      'Launch: Beta (milestone)',
    ]);
  });

  it('spans start to due, with an exclusive end', () => {
    const [wire, oneDay] = events();
    expect(wire.start).toBe('2026-08-24');
    expect(wire.end).toBe('2026-08-27');
    expect(oneDay.start).toBe('2026-08-30');
    expect(oneDay.end).toBe('2026-08-31');
  });

  it('gives every event a stable identity of its own', () => {
    const first = events();
    const second = events();
    expect(first.map((e) => e.uid)).toEqual(second.map((e) => e.uid));
    expect(first[0].uid).toBe(taskUid('p1', 't1'));
    expect(first[2].uid).toBe(milestoneUid('p1', 'ms1'));
  });

  it('puts the description, the people, and a link back in the event', () => {
    const [wire] = events();
    expect(wire.description).toContain('Sketch it');
    expect(wire.description).toContain('Assigned to Maya');
    expect(wire.description).toContain('Milestone: Beta');
    expect(wire.description).toContain('https://app/#/p/p1/t/t1');
    expect(wire.url).toBe('https://app/#/p/p1/t/t1');
    expect(wire.categories).toEqual(['Design']);
  });

  it('can leave out either half', () => {
    expect(events({ includeMilestones: false }).every((e) => !e.uid.startsWith('milestone-')))
      .toBe(true);
    expect(events({ includeTasks: false }).map((e) => e.summary))
      .toEqual(['Launch: Beta (milestone)']);
  });

  it('prefers the index entry name, and works without a base URL', () => {
    const [first] = projectEvents(doc(), { entry: { id: 'p1', name: 'Renamed' } });
    expect(first.summary).toBe('Renamed: Wireframes');
    expect(first.url).toBe(null);
    expect(first.description).toBe('Sketch it\n\nAssigned to Maya\n\nMilestone: Beta');
  });

  it('skips a milestone with no date', () => {
    const d = doc();
    d.milestones.push({ id: 'ms2', name: 'Someday' });
    expect(projectEvents(d).filter((e) => e.uid.startsWith('milestone-'))).toHaveLength(1);
  });
});

describe('buildCalendar', () => {
  const ics = () => buildCalendar(
    calendarEvents([{ entry: { id: 'p1', name: 'Launch' }, doc: doc() }], { baseUrl: 'https://app/' }),
    { name: 'Launch', now: NOW },
  );

  it('wraps the events in a calendar a reader will accept', () => {
    const text = ics();
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(text).toContain('VERSION:2.0');
    expect(text).toContain('PRODID:-//Puter//Project Management//EN');
    expect(text).toContain('X-WR-CALNAME:Launch');
    expect(text.endsWith('\r\n')).toBe(true);
    // CRLF everywhere, never a bare newline.
    expect(/[^\r]\n/.test(text)).toBe(false);
  });

  it('writes all-day events, out of the way of anyone reading busy time', () => {
    const text = ics();
    expect(text).toContain('DTSTART;VALUE=DATE:20260824');
    expect(text).toContain('DTEND;VALUE=DATE:20260827');
    expect(text).toContain('TRANSP:TRANSPARENT');
    expect(text).not.toContain('DTSTART:2026');
  });

  it('carries a UID and a SEQUENCE for every event', () => {
    const text = ics();
    const uids = text.match(/^UID:.*$/gm) ?? [];
    const seqs = text.match(/^SEQUENCE:\d+$/gm) ?? [];
    expect(uids).toHaveLength(3);
    expect(seqs).toHaveLength(3);
  });

  it('escapes a summary that contains the syntax', () => {
    const text = buildCalendar([{
      uid: 'x@test', summary: 'Ship v1, then; celebrate', start: '2026-08-25', end: '2026-08-26',
    }], { now: NOW });
    expect(text).toContain('SUMMARY:Ship v1\\, then\\; celebrate');
  });

  it('writes a valid empty calendar when there is nothing dated', () => {
    const text = buildCalendar([], { now: NOW });
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).not.toContain('BEGIN:VEVENT');
  });
});

describe('countEvents', () => {
  it('separates tasks from milestones, for the dialog to say', () => {
    const events = calendarEvents([{ entry: { id: 'p1', name: 'L' }, doc: doc() }]);
    expect(countEvents(events)).toEqual({ total: 3, tasks: 2, milestones: 1 });
  });
});

describe('calendarEvents', () => {
  it('spans projects and ignores one that is not loaded', () => {
    const events = calendarEvents([
      { entry: { id: 'p1', name: 'One' }, doc: doc() },
      { entry: { id: 'p2', name: 'Two' }, doc: null },
    ]);
    expect(events.every((e) => e.summary.startsWith('One:'))).toBe(true);
    expect(calendarEvents(undefined)).toEqual([]);
  });
});
