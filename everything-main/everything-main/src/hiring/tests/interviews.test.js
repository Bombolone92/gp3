import { describe, it, expect } from 'vitest';
import {
  committedInterviews,
  DEFAULT_WORKING_HOURS,
  interviewBounds,
  interviewConflicts,
  interviewHasEnded,
  interviewTimeLabel,
  interviewTimeWithZone,
  interviewZone,
  nearbyDates,
  overlaps,
  isProposed,
  normalizeSlots,
  proposalsAwaitingReply,
  secondReading,
  slotHasPassed,
  slotOptionsText,
  suggestSlots,
  validateSlots,
  workingHours,
  parseInterviewers,
  pastInterviews,
  sortByDateTime,
  upcomingInterviews,
  validateInterview,
} from '../src/core/interviews.js';

describe('validateInterview', () => {
  it('accepts a well-formed interview', () => {
    expect(validateInterview({ date: '2026-03-10', start: '10:00', end: '11:00', type: 'video' })).toEqual([]);
  });

  it('rejects missing dates, bad times, and inverted ranges', () => {
    expect(validateInterview({ date: '', start: '10:00', end: '11:00' })).toHaveLength(1);
    expect(validateInterview({ date: '2026-03-10', start: 'ten', end: '11:00' })).toHaveLength(1);
    expect(validateInterview({ date: '2026-03-10', start: '11:00', end: '10:30' })).toHaveLength(1);
    expect(validateInterview({ date: '2026-03-10', start: '10:00', end: '11:00', type: 'gauntlet' })).toHaveLength(1);
  });
});

describe('overlaps', () => {
  const base = { date: '2026-03-10', start: '10:00', end: '11:00' };

  it('detects time intersection on the same day', () => {
    expect(overlaps(base, { date: '2026-03-10', start: '10:30', end: '11:30' })).toBe(true);
    expect(overlaps(base, { date: '2026-03-10', start: '09:00', end: '10:01' })).toBe(true);
  });

  it('treats touching intervals and other days as non-overlapping', () => {
    expect(overlaps(base, { date: '2026-03-10', start: '11:00', end: '12:00' })).toBe(false);
    expect(overlaps(base, { date: '2026-03-11', start: '10:30', end: '11:30' })).toBe(false);
  });
});

describe('interviewConflicts', () => {
  const mine = {
    id: 'a',
    candidateId: 'c1',
    date: '2026-03-10',
    start: '10:00',
    end: '11:00',
    interviewers: ['Lena Hoffmann'],
  };

  it('flags an overlapping interview sharing an interviewer, case-insensitively', () => {
    const other = { id: 'b', candidateId: 'c2', date: '2026-03-10', start: '10:30', end: '11:30', interviewers: ['lena hoffmann'] };
    expect(interviewConflicts(mine, [mine, other])).toEqual([other]);
  });

  it('flags a double-booked candidate even with a different panel', () => {
    const other = { id: 'b', candidateId: 'c1', date: '2026-03-10', start: '10:30', end: '11:30', interviewers: ['Sam'] };
    expect(interviewConflicts(mine, [mine, other])).toEqual([other]);
  });

  it('ignores itself, disjoint times, and unrelated people', () => {
    const disjoint = { id: 'b', candidateId: 'c2', date: '2026-03-10', start: '12:00', end: '13:00', interviewers: ['Lena Hoffmann'] };
    const unrelated = { id: 'c', candidateId: 'c3', date: '2026-03-10', start: '10:30', end: '11:30', interviewers: ['Sam'] };
    expect(interviewConflicts(mine, [mine, disjoint, unrelated])).toEqual([]);
  });

  it('flags an overlap whose calendar dates are two days apart', () => {
    // Zones span 26 hours and a local day is 24, so the same hour can
    // carry two different calendar dates: 22:00 on the 10th in Niue
    // (UTC-11) runs into the small hours of the 12th in Kiritimati
    // (UTC+14). Narrowing the search to ±1 day declared this pair free.
    const kiritimati = { id: 'a', candidateId: 'c1', date: '2026-03-12', start: '00:00', end: '01:00', timeZone: 'Pacific/Kiritimati', interviewers: ['Lena'] };
    const niue = { id: 'b', candidateId: 'c2', date: '2026-03-10', start: '22:00', end: '23:59', timeZone: 'Pacific/Niue', interviewers: ['Lena'] };
    expect(overlaps(kiritimati, niue)).toBe(true);
    expect(interviewConflicts(kiritimati, [niue])).toEqual([niue]);
    expect(interviewConflicts(niue, [kiritimati])).toEqual([kiritimati]);
  });

  it('still skips what is genuinely days away', () => {
    const far = { id: 'b', candidateId: 'c2', date: '2026-03-14', start: '10:00', end: '11:00', interviewers: ['Lena Hoffmann'] };
    expect(interviewConflicts(mine, [far])).toEqual([]);
  });
});

describe('nearbyDates', () => {
  it('spans two days either side, inclusive and in order', () => {
    expect(nearbyDates('2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02', '2026-03-03']);
  });
});

describe('committedInterviews', () => {
  const candidates = [
    { id: 'c1', status: 'active' },
    { id: 'c2', status: 'rejected' },
    { id: 'c3', status: 'withdrawn' },
  ];
  const live = { id: 'a', candidateId: 'c1', status: 'scheduled' };
  const rejected = { id: 'b', candidateId: 'c2', status: 'scheduled' };
  const withdrawn = { id: 'c', candidateId: 'c3', status: 'scheduled' };
  const proposal = { id: 'd', candidateId: 'c1', status: 'proposed', slots: [] };
  const orphan = { id: 'e', candidateId: 'gone', status: 'scheduled' };

  it('keeps confirmed interviews for candidates still in play', () => {
    expect(committedInterviews([live, proposal], candidates)).toEqual([live]);
  });

  it('drops the interviews of archived candidates, kept only for cleanup', () => {
    expect(committedInterviews([live, rejected, withdrawn], candidates)).toEqual([live]);
  });

  it('keeps an orphaned interview: it is not archived, just candidate-less', () => {
    expect(committedInterviews([orphan], candidates)).toEqual([orphan]);
  });

  it('leaves a live interview unflagged against an archived candidate\'s stale one', () => {
    const mine = { id: 'x', candidateId: 'c1', date: '2026-03-10', start: '10:00', end: '11:00', interviewers: ['Lena'], status: 'scheduled' };
    const theirs = { id: 'y', candidateId: 'c2', date: '2026-03-10', start: '10:30', end: '11:30', interviewers: ['Lena'], status: 'scheduled' };
    expect(interviewConflicts(mine, [mine, theirs])).toEqual([theirs]);
    expect(interviewConflicts(mine, committedInterviews([mine, theirs], candidates))).toEqual([]);
  });
});

describe('interviewHasEnded', () => {
  const now = new Date('2026-09-07T13:00:00');

  it('reads the clock, not the calendar day', () => {
    expect(interviewHasEnded({ date: '2026-09-07', start: '09:00', end: '10:00' }, '', now)).toBe(true);
    expect(interviewHasEnded({ date: '2026-09-07', start: '15:00', end: '16:00' }, '', now)).toBe(false);
    // Still running counts as not over.
    expect(interviewHasEnded({ date: '2026-09-07', start: '12:30', end: '13:30' }, '', now)).toBe(false);
  });

  it('judges it on the interview’s own clock', () => {
    // 04:00 UTC: 13:00 in Tokyo, 21:00 the previous day in Los Angeles.
    const instant = new Date('2026-09-07T04:00:00Z');
    expect(interviewHasEnded({ date: '2026-09-07', start: '09:00', end: '10:00' }, 'Asia/Tokyo', instant)).toBe(true);
    expect(interviewHasEnded({ date: '2026-09-07', start: '09:00', end: '10:00' }, 'America/Los_Angeles', instant)).toBe(false);
  });

  it('never calls a proposal or an unusable record over', () => {
    expect(interviewHasEnded({ status: 'proposed', date: '2026-09-01', start: '09:00', end: '10:00' }, '', now)).toBe(false);
    expect(interviewHasEnded({ date: '', start: '09:00', end: '10:00' }, '', now)).toBe(false);
    expect(interviewHasEnded(null, '', now)).toBe(false);
  });
});

describe('ordering and buckets', () => {
  const now = new Date('2026-03-10T08:00:00');
  const list = [
    { id: '1', date: '2026-03-11', start: '09:00', end: '10:00' },
    { id: '2', date: '2026-03-10', start: '14:00', end: '15:00' },
    { id: '3', date: '2026-03-10', start: '09:00', end: '10:00' },
    { id: '4', date: '2026-03-01', start: '09:00', end: '10:00' },
  ];

  it('sorts by date then start time', () => {
    expect(sortByDateTime(list).map((i) => i.id)).toEqual(['4', '3', '2', '1']);
  });

  it('splits upcoming (today onward) from past, past most recent first', () => {
    expect(upcomingInterviews(list, now).map((i) => i.id)).toEqual(['3', '2', '1']);
    expect(pastInterviews(list, now).map((i) => i.id)).toEqual(['4']);
  });

  it('keeps past interviews chronological within a day, newest day first', () => {
    const past = [
      { id: 'late', date: '2026-03-05', start: '15:00', end: '16:00' },
      { id: 'early', date: '2026-03-05', start: '09:00', end: '10:00' },
      { id: 'older', date: '2026-03-01', start: '12:00', end: '13:00' },
    ];
    expect(pastInterviews(past, now).map((i) => i.id)).toEqual(['early', 'late', 'older']);
  });
});

describe('parseInterviewers', () => {
  it('splits, trims, collapses whitespace, and dedupes case-insensitively', () => {
    expect(parseInterviewers(' Lena  Hoffmann , sam,  , LENA HOFFMANN')).toEqual(['Lena Hoffmann', 'sam']);
    expect(parseInterviewers('')).toEqual([]);
    expect(parseInterviewers(null)).toEqual([]);
  });
});

describe('time zones', () => {
  const berlin = { id: 'a', candidateId: 'c1', date: '2026-03-10', start: '14:00', end: '15:00', timeZone: 'Europe/Berlin', interviewers: ['Lena'] };
  const sf = { id: 'b', candidateId: 'c2', date: '2026-03-10', start: '06:00', end: '07:00', timeZone: 'America/Los_Angeles', interviewers: ['Lena'] };

  it('spans the absolute instants of its own zone', () => {
    const [start, end] = interviewBounds(berlin);
    expect(new Date(start).toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-03-10T14:00:00.000Z');
    expect(interviewBounds({ date: '', start: '10:00', end: '11:00' })).toBeNull();
  });

  it('sees a cross-zone double-booking that local minutes hid', () => {
    // 14:00 in Berlin and 06:00 in San Francisco are the same hour.
    expect(overlaps(berlin, sf)).toBe(true);
    expect(interviewConflicts(berlin, [berlin, sf])).toEqual([sf]);
  });

  it('does not invent a clash between slots that only look close', () => {
    const later = { ...sf, id: 'c', start: '09:00', end: '10:00' };
    expect(overlaps(berlin, later)).toBe(false);
    expect(interviewConflicts(berlin, [berlin, later])).toEqual([]);
  });

  it('can clash across midnight, which same-day comparison could not', () => {
    const tokyo = { id: 'd', candidateId: 'c3', date: '2026-03-11', start: '07:00', end: '08:00', timeZone: 'Asia/Tokyo', interviewers: ['Lena'] };
    // 07:00 on the 11th in Tokyo is 22:00 on the 10th UTC.
    const evening = { id: 'e', candidateId: 'c4', date: '2026-03-10', start: '23:00', end: '23:59', timeZone: 'Europe/Berlin', interviewers: ['Lena'] };
    expect(overlaps(tokyo, evening)).toBe(true);
  });

  it('keeps comparing zoneless interviews on the local clock', () => {
    const a = { date: '2026-03-10', start: '10:00', end: '11:00' };
    expect(overlaps(a, { date: '2026-03-10', start: '10:30', end: '11:30' })).toBe(true);
    expect(overlaps(a, { date: '2026-03-10', start: '11:00', end: '12:00' })).toBe(false);
    expect(overlaps(a, { date: '2026-03-11', start: '10:30', end: '11:30' })).toBe(false);
  });

  it('falls back through the interview, the account, then the device', () => {
    expect(interviewZone(berlin, { timeZone: 'UTC' })).toBe('Europe/Berlin');
    expect(interviewZone({ timeZone: '' }, { timeZone: 'UTC' })).toBe('UTC');
    expect(interviewZone({}, {})).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    // A zone this browser cannot resolve is not a zone.
    expect(interviewZone({ timeZone: 'Mars/Olympus' }, { timeZone: 'UTC' })).toBe('UTC');
  });

  it('names the zone for the candidate and stays quiet about our own', () => {
    expect(interviewTimeWithZone(berlin, berlin.start)).toMatch(/CET|GMT\+1/);
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const local = { date: '2026-03-10', start: '14:00', end: '15:00', timeZone: own };
    expect(interviewTimeLabel(local, local.start)).not.toMatch(/GMT|UTC/);
  });

  it('reads a slot on a second clock, and says nothing when it is the same one', () => {
    // March 10 is already summer time in the US, still winter in Europe.
    expect(secondReading(berlin, 'America/Los_Angeles')).toMatch(/6[:.]00.*(PDT|GMT-7)/);
    expect(secondReading(berlin, 'Europe/Berlin')).toBe('');
    expect(secondReading(berlin, '')).toBe('');
    expect(secondReading({ date: '', start: '14:00' }, 'UTC')).toBe('');
  });
});

describe('proposals', () => {
  it('recognizes a proposal only by its status', () => {
    expect(isProposed({ status: 'proposed' })).toBe(true);
    expect(isProposed({ status: 'scheduled' })).toBe(false);
    expect(isProposed({})).toBe(false);
    expect(isProposed(null)).toBe(false);
  });

  it('cleans slot lists: usable ranges, in order, deduped, capped', () => {
    expect(
      normalizeSlots([
        { date: '2026-09-08', start: '10:00', end: '11:00' },
        { date: '2026-09-07', start: '14:00', end: '15:00' },
        { date: '2026-09-07', start: '14:00', end: '15:00' },
        { date: '2026-09-07', start: '16:00', end: '15:00' },
        { date: 'nope', start: '10:00', end: '11:00' },
      ])
    ).toEqual([
      { date: '2026-09-07', start: '14:00', end: '15:00' },
      { date: '2026-09-08', start: '10:00', end: '11:00' },
    ]);
    expect(normalizeSlots(null)).toEqual([]);
    expect(normalizeSlots(Array.from({ length: 9 }, (_, i) => ({ date: `2026-09-0${i + 1}`, start: '10:00', end: '11:00' })))).toHaveLength(4);
  });

  it('reads a passed option as passed by the clock, not by the date', () => {
    // 2026-09-07, 13:00 local.
    const now = new Date('2026-09-07T13:00:00');
    const earlierToday = { date: '2026-09-07', start: '11:00', end: '12:00' };
    const laterToday = { date: '2026-09-07', start: '15:00', end: '16:00' };
    const lastWeek = { date: '2026-08-31', start: '15:00', end: '16:00' };
    expect(slotHasPassed(earlierToday, '', now)).toBe(true);
    expect(slotHasPassed(laterToday, '', now)).toBe(false);
    expect(slotHasPassed(lastWeek, '', now)).toBe(true);
    // The option is read on its interview's clock: 11:00 in Tokyo is
    // yesterday evening in Los Angeles, and 11:00 in Los Angeles is still
    // ahead of a 13:00 Tokyo now.
    const tokyoNoon = new Date('2026-09-07T03:00:00Z');
    expect(slotHasPassed({ date: '2026-09-07', start: '11:00' }, 'Asia/Tokyo', tokyoNoon)).toBe(true);
    expect(slotHasPassed({ date: '2026-09-07', start: '11:00' }, 'America/Los_Angeles', tokyoNoon)).toBe(false);
    // An unusable option is not called passed.
    expect(slotHasPassed({ date: 'nope', start: '11:00' }, '', now)).toBe(false);
    expect(slotHasPassed(null, '', now)).toBe(false);
  });

  it('insists on a real choice, and on usable options', () => {
    expect(validateSlots([{ date: '2026-09-07', start: '14:00', end: '15:00' }])).toHaveLength(1);
    expect(validateSlots([])).toHaveLength(1);
    expect(
      validateSlots([
        { date: '2026-09-07', start: '14:00', end: '15:00' },
        { date: '2026-09-08', start: '10:00', end: '11:00' },
      ])
    ).toEqual([]);
    // A row the user left half-filled is reported, not silently dropped.
    expect(
      validateSlots([
        { date: '2026-09-07', start: '14:00', end: '15:00' },
        { date: '2026-09-08', start: '10:00', end: '11:00' },
        { date: '', start: '10:00', end: '11:00' },
      ])
    ).toHaveLength(1);
  });

  it('suggests open windows inside the working week', () => {
    // Monday 2026-09-07, 08:00 local.
    const now = new Date('2026-09-07T08:00:00');
    const found = suggestSlots([], { now, count: 3, timeZone: '' });
    expect(found).toHaveLength(3);
    // Two hours of lead time, so nothing before 10:00 on the first day.
    expect(found[0].date).toBe('2026-09-07');
    expect(found[0].start >= '10:00').toBe(true);
    // Spread over days rather than stacked in one afternoon.
    expect(new Set(found.map((s) => s.date)).size).toBeGreaterThan(1);
    // Every option honours the requested length.
    const long = suggestSlots([], { now, count: 1, duration: 90 });
    expect(long[0].end).toBe(
      `${String(Number(long[0].start.slice(0, 2)) + 1).padStart(2, '0')}:${long[0].start.slice(3) === '00' ? '30' : '00'}`
    );
  });

  it('never suggests a booked hour, but ignores other proposals', () => {
    const now = new Date('2026-09-07T08:00:00');
    const booked = { id: 'i1', date: '2026-09-07', start: '10:00', end: '11:00', status: 'scheduled' };
    const alsoProposed = { id: 'i2', date: '2026-09-07', start: '11:00', end: '12:00', status: 'proposed', slots: [{ date: '2026-09-07', start: '11:00', end: '12:00' }] };
    const found = suggestSlots([booked, alsoProposed], { now, count: 2 });
    expect(found.some((s) => s.date === '2026-09-07' && s.start === '10:00')).toBe(false);
    expect(found[0]).toEqual({ date: '2026-09-07', start: '11:00', end: '12:00' });
  });

  it('skips days outside the configured working week', () => {
    // Saturday 2026-09-12.
    const now = new Date('2026-09-12T08:00:00');
    const weekdays = suggestSlots([], { now, count: 1 });
    expect(weekdays[0].date).toBe('2026-09-14');
    const weekends = suggestSlots([], { now, count: 1, settings: { workingHours: { start: '09:00', end: '17:00', days: [6] } } });
    expect(weekends[0].date).toBe('2026-09-12');
  });

  it('falls back to the default window when the stored one is unusable', () => {
    expect(workingHours(null)).toEqual(DEFAULT_WORKING_HOURS);
    expect(workingHours({ workingHours: { start: '18:00', end: '09:00', days: [1] } })).toEqual(DEFAULT_WORKING_HOURS);
    expect(workingHours({ workingHours: { days: [] } })).toEqual(DEFAULT_WORKING_HOURS);
    expect(workingHours({ workingHours: { start: '08:00', end: '12:00', days: [1, 9, 'x'] } })).toEqual({
      start: '08:00',
      end: '12:00',
      days: [1],
    });
  });

  it('writes the options as a numbered list that names the zone', () => {
    const text = slotOptionsText({
      timeZone: 'Europe/Berlin',
      slots: [
        { date: '2026-09-07', start: '14:00', end: '15:00' },
        { date: '2026-09-08', start: '10:00', end: '11:00' },
      ],
    });
    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^1\. Monday, September 7 — /);
    expect(lines[0]).toMatch(/CEST|GMT\+2/);
    expect(lines[1]).toMatch(/^2\. Tuesday, September 8 — /);
  });

  it('lists outstanding proposals oldest first, after a wait', () => {
    const now = new Date('2026-09-10T10:00:00Z');
    const list = [
      { id: 'a', status: 'proposed', proposedAt: '2026-09-09T10:00:00Z' },
      { id: 'b', status: 'proposed', proposedAt: '2026-09-05T10:00:00Z' },
      { id: 'c', status: 'scheduled', proposedAt: '2026-09-01T10:00:00Z' },
    ];
    expect(proposalsAwaitingReply(list, { now }).map((i) => i.id)).toEqual(['b', 'a']);
    expect(proposalsAwaitingReply(list, { now, afterDays: 3 }).map((i) => i.id)).toEqual(['b']);
  });
});
