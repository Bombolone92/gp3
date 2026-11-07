import { describe, it, expect } from 'vitest';
import { dueFollowups, followupDue, sortFollowups, validateFollowup } from '../src/core/followups.js';

const NOW = new Date('2026-03-10T10:00:00'); // local 10:00

const fu = (id, dueDate, extra = {}) => ({ id, text: `do ${id}`, dueDate, dueTime: '', done: false, ...extra });

describe('validateFollowup', () => {
  it('requires text and a well-formed due date', () => {
    expect(validateFollowup({ text: 'Call Dana', dueDate: '2026-03-12', dueTime: '' })).toEqual([]);
    expect(validateFollowup({ text: '  ', dueDate: '2026-03-12' })).toHaveLength(1);
    expect(validateFollowup({ text: 'x', dueDate: 'soon' })).toHaveLength(1);
    expect(validateFollowup({ text: 'x', dueDate: '2026-03-12', dueTime: '25:99' })).toHaveLength(1);
    expect(validateFollowup({ text: 'x', dueDate: '2026-03-12', dueTime: '14:30' })).toEqual([]);
  });
});

describe('followupDue', () => {
  it('holds a timed follow-up until its time, then calls it late', () => {
    expect(followupDue(fu('later', '2026-03-10', { dueTime: '23:00' }), NOW)).toBeNull();
    expect(followupDue(fu('now', '2026-03-10', { dueTime: '10:00' }), NOW)).toEqual({ overdue: false });
    expect(followupDue(fu('earlier', '2026-03-10', { dueTime: '09:00' }), NOW)).toEqual({ overdue: true });
  });

  it('treats a date-only follow-up as due from the start of its day', () => {
    expect(followupDue(fu('today', '2026-03-10'), NOW)).toEqual({ overdue: false });
    expect(followupDue(fu('yesterday', '2026-03-09'), NOW)).toEqual({ overdue: true });
    expect(followupDue(fu('tomorrow', '2026-03-11'), NOW)).toBeNull();
  });

  it('is never due when done, dateless, or missing', () => {
    expect(followupDue(fu('done', '2026-03-01', { done: true }), NOW)).toBeNull();
    expect(followupDue(fu('nodate', ''), NOW)).toBeNull();
    expect(followupDue(null, NOW)).toBeNull();
  });
});

describe('dueFollowups', () => {
  const state = (followups) => ({ candidates: [{ id: 'c1', name: 'Ada', followups }] });

  it('includes overdue and due-today items, soonest first, skipping done ones', () => {
    const due = dueFollowups(
      state([fu('today', '2026-03-10'), fu('past', '2026-03-08'), fu('future', '2026-03-11'), fu('finished', '2026-03-01', { done: true })]),
      NOW
    );
    expect(due.map((d) => d.followup.id)).toEqual(['past', 'today']);
    expect(due[0].overdue).toBe(true);
    expect(due[1].overdue).toBe(false);
  });

  it('holds a timed follow-up until its time arrives on the due day', () => {
    const morning = fu('am', '2026-03-10', { dueTime: '09:00' });
    const evening = fu('pm', '2026-03-10', { dueTime: '17:30' });
    expect(dueFollowups(state([morning, evening]), NOW).map((d) => d.followup.id)).toEqual(['am']);
  });

  it('marks a timed follow-up overdue once its time has passed', () => {
    const passed = fu('am', '2026-03-10', { dueTime: '09:00' });
    const rightNow = fu('now', '2026-03-10', { dueTime: '10:00' });
    const dateOnly = fu('day', '2026-03-10');
    const byId = Object.fromEntries(dueFollowups(state([passed, rightNow, dateOnly]), NOW).map((d) => [d.followup.id, d.overdue]));
    expect(byId).toEqual({ am: true, now: false, day: false });
  });

  it('handles candidates without followups', () => {
    expect(dueFollowups({ candidates: [{ id: 'c1' }] }, NOW)).toEqual([]);
  });
});

describe('sortFollowups', () => {
  it('orders open by due date then time, completed at the bottom', () => {
    const list = [
      fu('b', '2026-03-12'),
      fu('done1', '2026-03-01', { done: true, completedAt: '2026-03-02T10:00:00Z' }),
      fu('a', '2026-03-10', { dueTime: '09:00' }),
      fu('a2', '2026-03-10', { dueTime: '15:00' }),
    ];
    expect(sortFollowups(list).map((f) => f.id)).toEqual(['a', 'a2', 'b', 'done1']);
  });
});
