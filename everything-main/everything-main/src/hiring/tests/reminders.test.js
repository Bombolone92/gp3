import { describe, it, expect } from 'vitest';
import { computeReminders, missingScorecards, reminderSettings, REMINDER_DEFAULTS } from '../src/core/reminders.js';

const NOW = new Date('2026-03-10T10:00:00'); // local 10:00

function baseState(overrides = {}) {
  return {
    settings: {},
    candidates: [{ id: 'c1', name: 'Ada Lovelace' }],
    interviews: [],
    scorecards: [],
    offers: [],
    onboarding: {},
    ...overrides,
  };
}

describe('reminderSettings', () => {
  it('defaults on for reminder kinds, off for browser delivery', () => {
    expect(reminderSettings({})).toEqual(REMINDER_DEFAULTS);
    expect(reminderSettings({ reminders: { browser: true, offers: false } })).toMatchObject({
      browser: true,
      offers: false,
      interviews: true,
    });
  });
});

describe('computeReminders: interviews', () => {
  const itv = (start) => ({ id: 'i1', candidateId: 'c1', date: '2026-03-10', start, end: '11:00', type: 'video', meetingLink: '' });

  it('fires within the 30-minute lead and shortly after start', () => {
    expect(computeReminders(baseState({ interviews: [itv('10:20')] }), NOW)).toHaveLength(1);
    expect(computeReminders(baseState({ interviews: [itv('09:55')] }), NOW)[0].title).toMatch(/starting/i);
  });

  it('stays quiet outside the window, on other days, and when disabled', () => {
    expect(computeReminders(baseState({ interviews: [itv('11:00')] }), NOW)).toHaveLength(0);
    expect(computeReminders(baseState({ interviews: [itv('09:00')] }), NOW)).toHaveLength(0);
    const tomorrow = { ...itv('10:10'), date: '2026-03-11' };
    expect(computeReminders(baseState({ interviews: [tomorrow] }), NOW)).toHaveLength(0);
    const state = baseState({ interviews: [itv('10:10')], settings: { reminders: { interviews: false } } });
    expect(computeReminders(state, NOW)).toHaveLength(0);
  });

  it('fires against the real instant, not the wall clock, across zones', () => {
    // A slot twenty minutes out, written on UTC's clock. Its wall time
    // equals the reader's own only where the offset is zero, so a
    // minutes-since-midnight comparison would miss (or mistime) it.
    const soon = new Date(NOW.getTime() + 20 * 60_000);
    const zoned = {
      ...itv(soon.toISOString().slice(11, 16)),
      date: soon.toISOString().slice(0, 10),
      end: '23:59',
      timeZone: 'UTC',
    };
    const fired = computeReminders(baseState({ interviews: [zoned] }), NOW);
    expect(fired).toHaveLength(1);
    expect(fired[0].title).toMatch(/Interview in 20 min/);
  });

  it('reaches an interview whose zone puts it on another calendar day', () => {
    // 04:00 tomorrow in Tokyo is 19:00 today UTC — for a reader well west
    // of Tokyo it is today, and the old date === today filter missed it.
    const now = new Date('2026-03-10T18:40:00Z');
    const tokyo = { ...itv('04:00'), date: '2026-03-11', timeZone: 'Asia/Tokyo', end: '05:00' };
    expect(computeReminders(baseState({ interviews: [tokyo] }), now)).toHaveLength(1);
  });

  it('says nothing about an archived candidate’s interview', () => {
    const archived = baseState({
      interviews: [itv('10:20')],
      candidates: [{ id: 'c1', name: 'Ada Lovelace', status: 'withdrawn' }],
    });
    expect(computeReminders(archived, NOW)).toHaveLength(0);
    // An interview whose candidate is gone entirely is orphaned, not
    // archived; the views still list it, so it still nudges.
    expect(computeReminders(baseState({ interviews: [itv('10:20')], candidates: [] }), NOW)).toHaveLength(1);
  });

  it('has a stable key for dedupe', () => {
    const [a] = computeReminders(baseState({ interviews: [itv('10:10')] }), NOW);
    const [b] = computeReminders(baseState({ interviews: [itv('10:10')] }), new Date('2026-03-10T10:05:00'));
    expect(a.key).toBe(b.key);
  });

  it('changes the key when the interview is rescheduled, so it notifies again', () => {
    const [a] = computeReminders(baseState({ interviews: [itv('10:10')] }), NOW);
    const [b] = computeReminders(baseState({ interviews: [itv('10:25')] }), NOW);
    expect(a.key).not.toBe(b.key);
  });
});

describe('computeReminders: proposals', () => {
  const proposal = (proposedAt, extra = {}) => ({
    id: 'i1',
    candidateId: 'c1',
    date: '2026-03-20',
    start: '10:00',
    end: '11:00',
    type: 'phone',
    status: 'proposed',
    slots: [
      { date: '2026-03-20', start: '10:00', end: '11:00' },
      { date: '2026-03-21', start: '10:00', end: '11:00' },
    ],
    proposedAt,
    ...extra,
  });

  it('nudges once the reply is a few days late', () => {
    const late = computeReminders(baseState({ interviews: [proposal('2026-03-06T10:00:00Z')] }), NOW);
    expect(late).toHaveLength(1);
    expect(late[0].kind).toBe('proposal');
    expect(late[0].title).toMatch(/No reply on times/);
  });

  it('stays quiet while the wait is still reasonable, and when switched off', () => {
    expect(computeReminders(baseState({ interviews: [proposal('2026-03-09T10:00:00Z')] }), NOW)).toHaveLength(0);
    const off = baseState({ interviews: [proposal('2026-03-01T10:00:00Z')], settings: { reminders: { proposals: false } } });
    expect(computeReminders(off, NOW)).toHaveLength(0);
  });

  it('says nothing about an archived candidate', () => {
    const state = baseState({
      interviews: [proposal('2026-03-01T10:00:00Z')],
      candidates: [{ id: 'c1', name: 'Ada Lovelace', status: 'rejected' }],
    });
    expect(computeReminders(state, NOW)).toHaveLength(0);
  });

  it('does not treat a proposal as an interview about to start', () => {
    // Its mirrored start is 20 minutes away, but nobody has agreed to it.
    const soon = proposal('2026-03-10T09:00:00Z', { date: '2026-03-10', start: '10:20' });
    expect(computeReminders(baseState({ interviews: [soon] }), NOW)).toHaveLength(0);
  });
});

describe('computeReminders: offers', () => {
  it('covers expiring and already-expired sent offers', () => {
    const offers = [
      { id: 'o1', candidateId: 'c1', status: 'sent', expires: '2026-03-12' },
      { id: 'o2', candidateId: 'c1', status: 'sent', expires: '2026-03-08' },
      { id: 'o3', candidateId: 'c1', status: 'sent', expires: '2026-04-01' },
      { id: 'o4', candidateId: 'c1', status: 'draft', expires: '2026-03-11' },
    ];
    const due = computeReminders(baseState({ offers }), NOW);
    expect(due.map((r) => r.kind)).toEqual(['offer', 'offer']);
    expect(due[1].title).toMatch(/expired/i);
  });

  it('stays quiet about an archived candidate’s offer', () => {
    // The UI hides "Record signature" once the candidate is archived, so
    // an expiry nudge would point at an action the app refuses to offer.
    const offer = { id: 'o1', candidateId: 'c1', status: 'sent', expires: '2026-03-12' };
    const archived = baseState({ candidates: [{ id: 'c1', name: 'Ada Lovelace', status: 'rejected' }], offers: [offer] });
    expect(computeReminders(archived, NOW)).toHaveLength(0);
    const active = baseState({ candidates: [{ id: 'c1', name: 'Ada Lovelace', status: 'active' }], offers: [offer] });
    expect(computeReminders(active, NOW)).toHaveLength(1);
  });

  it('gives the expired nudge a different key from the expiring one', () => {
    // The dedupe store persists consumed keys, so if both states shared a
    // key, the "expiring" notification would permanently swallow the
    // "expired" one that follows a few days later.
    const offer = { id: 'o1', candidateId: 'c1', status: 'sent', expires: '2026-03-12' };
    const [soon] = computeReminders(baseState({ offers: [offer] }), NOW);
    const [lapsed] = computeReminders(baseState({ offers: [offer] }), new Date('2026-03-14T10:00:00'));
    expect(soon.title).toMatch(/expiring/i);
    expect(lapsed.title).toMatch(/expired/i);
    expect(soon.key).not.toBe(lapsed.key);
  });
});

describe('computeReminders: follow-ups', () => {
  const withFollowup = (followup) =>
    baseState({ candidates: [{ id: 'c1', name: 'Ada Lovelace', followups: [followup] }] });
  const fu = { id: 'f1', text: 'Call about the take-home', dueDate: '2026-03-10', dueTime: '', done: false };

  it('reminds when due today and labels overdue ones', () => {
    const due = computeReminders(withFollowup(fu), NOW);
    expect(due.map((r) => r.kind)).toEqual(['followup']);
    expect(due[0].body).toBe('Call about the take-home');
    const late = computeReminders(withFollowup({ ...fu, dueDate: '2026-03-08' }), NOW);
    expect(late[0].title).toMatch(/overdue/i);
  });

  it('stays quiet for future, completed, or disabled follow-ups', () => {
    expect(computeReminders(withFollowup({ ...fu, dueDate: '2026-03-11' }), NOW)).toHaveLength(0);
    expect(computeReminders(withFollowup({ ...fu, done: true }), NOW)).toHaveLength(0);
    const state = withFollowup(fu);
    state.settings = { reminders: { followups: false } };
    expect(computeReminders(state, NOW)).toHaveLength(0);
  });

  it('keys on the due slot so a rescheduled follow-up notifies again', () => {
    const [a] = computeReminders(withFollowup(fu), NOW);
    const [b] = computeReminders(withFollowup(fu), new Date('2026-03-10T11:00:00'));
    expect(a.key).toBe(b.key);
    const [c] = computeReminders(withFollowup({ ...fu, dueDate: '2026-03-09' }), NOW);
    expect(c.key).not.toBe(a.key);
  });
});

describe('computeReminders: onboarding', () => {
  const state = (over = {}) =>
    baseState({
      candidates: [{ id: 'c1', name: 'Ada Lovelace', status: 'active', stage: 'hired' }],
      offers: [{ id: 'o1', candidateId: 'c1', status: 'signed', startDate: '2026-03-12' }],
      onboarding: {
        c1: { tasks: [{ id: 't1', title: 'Order laptop', offsetDays: -7, done: false }] },
      },
      ...over,
    });

  it('nudges about a dated task that has come due', () => {
    const [reminder] = computeReminders(state(), NOW);
    expect(reminder).toMatchObject({ kind: 'onboarding', route: 'onboarding' });
    expect(reminder.title).toMatch(/Onboarding overdue: Ada Lovelace/);
    expect(reminder.body).toMatch(/Order laptop/);
    // The due date is in the key, so a moved start date nudges again.
    expect(reminder.key).toBe('onboarding-t1-2026-03-05');
  });

  it('says nothing for a done task, a hire who left, or when switched off', () => {
    const done = state({ onboarding: { c1: { tasks: [{ id: 't1', title: 'Order laptop', offsetDays: -7, done: true }] } } });
    expect(computeReminders(done, NOW)).toHaveLength(0);
    const reneged = state({ candidates: [{ id: 'c1', name: 'Ada', status: 'rejected', stage: 'hired' }] });
    expect(computeReminders(reneged, NOW)).toHaveLength(0);
    const backOut = state({ candidates: [{ id: 'c1', name: 'Ada', status: 'active', stage: 'offer' }] });
    expect(computeReminders(backOut, NOW)).toHaveLength(0);
    const off = state({ settings: { reminders: { onboarding: false } } });
    expect(computeReminders(off, NOW)).toHaveLength(0);
  });
});

describe('missingScorecards', () => {
  const itv = (id, date) => ({ id, candidateId: 'c1', date, start: '10:00', end: '11:00', type: 'video' });

  it('flags interviews older than a day without a scorecard, newest first', () => {
    const state = baseState({
      interviews: [itv('old', '2026-03-05'), itv('older', '2026-03-02'), itv('covered', '2026-03-06'), itv('today', '2026-03-10')],
      scorecards: [{ id: 's1', interviewId: 'covered' }],
    });
    expect(missingScorecards(state, NOW).map((i) => i.id)).toEqual(['old', 'older']);
  });

  it('never asks for feedback on a proposal nobody accepted', () => {
    const state = baseState({
      interviews: [{ ...itv('proposed', '2026-03-05'), status: 'proposed', slots: [{ date: '2026-03-05', start: '10:00', end: '11:00' }] }],
    });
    expect(missingScorecards(state, NOW)).toEqual([]);
  });

  it('treats unlinked feedback as covering the interviews held before it', () => {
    // Feedback added from the profile carries no interview link; a
    // scorecard written after the Mar 5 interview silences its nag, but
    // not the nag for an interview held later than the feedback.
    const state = baseState({
      interviews: [itv('reviewed', '2026-03-05'), itv('later', '2026-03-08')],
      scorecards: [{ id: 's1', candidateId: 'c1', interviewId: null, createdAt: '2026-03-06T09:00:00.000Z' }],
    });
    expect(missingScorecards(state, NOW).map((i) => i.id)).toEqual(['later']);
  });

  it('forgets interviews outside the 14-day window and deleted candidates', () => {
    const state = baseState({
      interviews: [itv('ancient', '2026-02-01'), { ...itv('ghost', '2026-03-05'), candidateId: 'gone' }],
    });
    expect(missingScorecards(state, NOW)).toEqual([]);
  });

  it('compares unlinked feedback by its local day, not the UTC one', () => {
    // Feedback written the evening of Mar 6 local time carries a Mar 7
    // UTC timestamp west of Greenwich; it must not cover the Mar 7
    // interview, which had not happened yet when it was written.
    const createdAt = new Date(2026, 2, 6, 20, 0).toISOString();
    const state = baseState({
      interviews: [itv('before', '2026-03-05'), itv('after', '2026-03-07')],
      scorecards: [{ id: 's1', candidateId: 'c1', interviewId: null, createdAt }],
    });
    expect(missingScorecards(state, NOW).map((i) => i.id)).toEqual(['after']);
  });

  it('stops nagging once the candidate is archived', () => {
    // Rejecting or withdrawing ends the evaluation; two more weeks of
    // "no feedback yet" for a decision already made is noise.
    const state = baseState({
      candidates: [{ id: 'c1', name: 'Ada Lovelace', status: 'rejected' }],
      interviews: [itv('old', '2026-03-05')],
    });
    expect(missingScorecards(state, NOW)).toEqual([]);
  });

  it('feeds scorecard reminders unless disabled', () => {
    const state = baseState({ interviews: [itv('old', '2026-03-05')] });
    expect(computeReminders(state, NOW).map((r) => r.kind)).toEqual(['scorecard']);
    state.settings = { reminders: { scorecards: false } };
    expect(computeReminders(state, NOW)).toHaveLength(0);
  });
});
