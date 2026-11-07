import { describe, it, expect } from 'vitest';
import { buildInterviewFeed, feedInterviews, FEED_PAST_DAYS, isFeedFile, newFeedFile } from '../src/core/feed.js';

const NOW = new Date('2026-09-10T12:00:00Z');

function state(overrides = {}) {
  return {
    settings: { companyName: 'Acme' },
    jobs: [{ id: 'j1', title: 'Senior Engineer' }],
    candidates: [
      { id: 'c1', name: 'Ada Lovelace', jobId: 'j1', status: 'active' },
      { id: 'c2', name: 'Grace Hopper', jobId: 'j1', status: 'rejected' },
    ],
    interviews: [],
    ...overrides,
  };
}

const itv = (over = {}) => ({
  id: 'i1',
  candidateId: 'c1',
  jobId: 'j1',
  date: '2026-09-11',
  start: '14:00',
  end: '15:00',
  type: 'video',
  timeZone: 'Europe/Berlin',
  ...over,
});

describe('feed file names', () => {
  it('mints an unguessable name and recognizes only its own', () => {
    const name = newFeedFile();
    expect(isFeedFile(name)).toBe(true);
    expect(name).not.toBe(newFeedFile());
    expect(isFeedFile('interviews.ics')).toBe(false);
    expect(isFeedFile('../../etc/passwd')).toBe(false);
    expect(isFeedFile('interviews-../x.ics')).toBe(false);
    expect(isFeedFile(undefined)).toBe(false);
  });
});

describe('feedInterviews', () => {
  it('keeps upcoming and recent interviews for candidates still in play', () => {
    const s = state({
      interviews: [
        itv({ id: 'soon' }),
        itv({ id: 'recent', date: '2026-09-01' }),
        itv({ id: 'ancient', date: '2026-06-01' }),
        itv({ id: 'archived', candidateId: 'c2' }),
        itv({ id: 'proposal', status: 'proposed', slots: [{ date: '2026-09-12', start: '10:00', end: '11:00' }] }),
      ],
    });
    expect(feedInterviews(s, { now: NOW }).map((i) => i.id)).toEqual(['recent', 'soon']);
  });

  it('honours the trailing window', () => {
    const s = state({ interviews: [itv({ id: 'edge', date: '2026-08-25' })] });
    expect(feedInterviews(s, { now: NOW, pastDays: 30 }).map((i) => i.id)).toEqual(['edge']);
    expect(feedInterviews(s, { now: NOW, pastDays: 3 })).toEqual([]);
    expect(FEED_PAST_DAYS).toBeGreaterThan(7);
  });
});

describe('buildInterviewFeed', () => {
  it('writes one calendar with a named event per interview, pinned to its zone', () => {
    const ics = buildInterviewFeed(state({ interviews: [itv(), itv({ id: 'i2', date: '2026-09-12', start: '09:00', end: '09:45' })] }), { now: NOW });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('X-WR-CALNAME:Interviews · Acme');
    expect(ics).toContain('SUMMARY:Interview: Ada · Senior Engineer');
    expect(ics).toContain('DTSTART:20260911T120000Z');
    expect(ics).toContain('UID:i1@hiring');
    expect(ics).toContain('DESCRIPTION:Video call');
  });

  it('carries nothing an unlisted-but-public link should not', () => {
    const ics = buildInterviewFeed(
      state({
        interviews: [
          itv({ meetingLink: 'https://meet.example.com/secret', location: 'Room 4', notes: 'Ask about the outage', interviewers: ['Lena Hoffmann'] }),
        ],
      }),
      { now: NOW }
    );
    expect(ics).not.toContain('secret');
    expect(ics).not.toContain('Lena');
    expect(ics).not.toContain('outage');
    expect(ics).not.toContain('Room 4');
    // First name only, until the user says otherwise.
    expect(ics).not.toContain('Lovelace');
  });

  it('uses full names only when asked', () => {
    const ics = buildInterviewFeed(state({ interviews: [itv()] }), { now: NOW, fullNames: true });
    expect(ics).toContain('SUMMARY:Interview: Ada Lovelace · Senior Engineer');
  });

  it('skips a record it cannot turn into an event instead of failing the feed', () => {
    const ics = buildInterviewFeed(state({ interviews: [itv({ id: 'broken', date: '' }), itv({ id: 'fine' })] }), { now: NOW });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:fine@hiring');
  });

  it('is a valid empty calendar when there is nothing to show', () => {
    const ics = buildInterviewFeed(state(), { now: NOW });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
