import { describe, it, expect } from 'vitest';
import {
  isValidISO, addDays, addMonths, daysBetween, relativeDays,
  nextTermEnd, renewalInfo, dateToISO, needsAttention, completedTerms,
  decisionFor, decisionHandles, agreementEnd, isTermEnd,
} from '../src/lib/dates.js';

describe('dateToISO', () => {
  it('uses the local calendar day, not UTC', () => {
    // 23:30 local on Aug 5 is already Aug 6 in UTC for zones west of UTC-0:30;
    // the local day must win regardless of the runner's timezone.
    expect(dateToISO(new Date(2026, 7, 5, 23, 30))).toBe('2026-08-05');
    expect(dateToISO(new Date(2026, 0, 1, 0, 10))).toBe('2026-01-01');
  });
});

describe('isValidISO', () => {
  it('accepts real calendar dates', () => {
    expect(isValidISO('2026-08-05')).toBe(true);
    expect(isValidISO('2024-02-29')).toBe(true); // leap year
  });

  it('rejects malformed and impossible dates', () => {
    expect(isValidISO('2026-02-30')).toBe(false);
    expect(isValidISO('2026-13-01')).toBe(false);
    expect(isValidISO('2026-8-5')).toBe(false);
    expect(isValidISO('')).toBe(false);
    expect(isValidISO(null)).toBe(false);
    expect(isValidISO('not a date')).toBe(false);
  });
});

describe('addDays / daysBetween', () => {
  it('adds across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is consistent with daysBetween', () => {
    expect(daysBetween('2026-08-05', addDays('2026-08-05', 90))).toBe(90);
    expect(daysBetween('2026-08-05', '2026-08-01')).toBe(-4);
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0);
  });
});

describe('addMonths', () => {
  it('keeps the day of month when possible', () => {
    expect(addMonths('2026-03-15', 2)).toBe('2026-05-15');
    expect(addMonths('2026-11-10', 3)).toBe('2027-02-10');
  });

  it('clamps to the target month length', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29'); // leap year
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });
});

describe('relativeDays', () => {
  it('covers the named cases', () => {
    expect(relativeDays(0)).toBe('today');
    expect(relativeDays(1)).toBe('tomorrow');
    expect(relativeDays(-1)).toBe('yesterday');
    expect(relativeDays(14)).toBe('in 14 days');
    expect(relativeDays(-7)).toBe('7 days ago');
  });
});

const TODAY = '2026-08-05';

function contract(overrides = {}) {
  return {
    status: 'active', startDate: '2025-01-01', endDate: '2026-12-31',
    autoRenew: false, termMonths: 12, noticeDays: 30,
    ...overrides,
  };
}

describe('nextTermEnd', () => {
  it('returns the end date for fixed-term contracts, even in the past', () => {
    expect(nextTermEnd(contract({ endDate: '2026-01-01' }), TODAY)).toBe('2026-01-01');
  });

  it('rolls auto-renewing contracts forward by their term', () => {
    const c = contract({ endDate: '2026-06-01', autoRenew: true, termMonths: 12 });
    expect(nextTermEnd(c, TODAY)).toBe('2027-06-01');
  });

  it('rolls forward multiple terms when far behind', () => {
    const c = contract({ endDate: '2024-03-10', autoRenew: true, termMonths: 6 });
    expect(nextTermEnd(c, TODAY)).toBe('2026-09-10');
  });

  it('keeps a future end date as-is for auto-renew', () => {
    const c = contract({ endDate: '2026-10-01', autoRenew: true });
    expect(nextTermEnd(c, TODAY)).toBe('2026-10-01');
  });

  it('returns null without an end date', () => {
    expect(nextTermEnd(contract({ endDate: null }), TODAY)).toBeNull();
  });

  it('keeps a month-end anchor instead of drifting after a clamp', () => {
    // Jan 31 rolled monthly must land on each month's last viable day,
    // not get stuck on the 28th after passing through February.
    const c = contract({ endDate: '2026-01-31', autoRenew: true, termMonths: 1 });
    expect(nextTermEnd(c, '2026-08-06')).toBe('2026-08-31');
  });

  it('returns to Feb 29 in a later leap year', () => {
    const c = contract({ endDate: '2024-02-29', autoRenew: true, termMonths: 12 });
    expect(nextTermEnd(c, '2028-01-15')).toBe('2028-02-29');
  });

  it('terminates on pathological ancient dates instead of hanging', () => {
    const c = contract({ endDate: '1900-01-01', autoRenew: true, termMonths: 1 });
    expect(nextTermEnd(c, TODAY)).not.toBeNull();
  });
});

describe('renewalInfo', () => {
  it('is none for drafts and terminated contracts', () => {
    expect(renewalInfo(contract({ status: 'draft' }), TODAY).phase).toBe('none');
    expect(renewalInfo(contract({ status: 'terminated' }), TODAY).phase).toBe('none');
  });

  it('is evergreen without an end date', () => {
    expect(renewalInfo(contract({ endDate: null }), TODAY).phase).toBe('evergreen');
  });

  it('is expired for a lapsed fixed term', () => {
    const info = renewalInfo(contract({ endDate: '2026-06-01' }), TODAY);
    expect(info.phase).toBe('expired');
    expect(info.daysLeft).toBeLessThan(0);
  });

  it('is notice inside the notice window', () => {
    // Ends in 20 days with a 30-day notice period: the window is open.
    const info = renewalInfo(contract({ endDate: addDays(TODAY, 20), noticeDays: 30 }), TODAY);
    expect(info.phase).toBe('notice');
    expect(info.noticeDaysLeft).toBe(-10);
  });

  it('is soon within the soon horizon but outside notice', () => {
    const info = renewalInfo(contract({ endDate: addDays(TODAY, 45), noticeDays: 10 }), TODAY);
    expect(info.phase).toBe('soon');
    expect(info.noticeDate).toBe(addDays(TODAY, 35));
  });

  it('is ok when the end is far out', () => {
    const info = renewalInfo(contract({ endDate: addDays(TODAY, 200), noticeDays: 30 }), TODAY);
    expect(info.phase).toBe('ok');
  });

  it('has no notice date when noticeDays is 0', () => {
    const info = renewalInfo(contract({ endDate: addDays(TODAY, 45), noticeDays: 0 }), TODAY);
    expect(info.noticeDate).toBeNull();
    expect(info.noticeDaysLeft).toBeNull();
  });

  it('respects a custom soon horizon', () => {
    const c = contract({ endDate: addDays(TODAY, 45), noticeDays: 0 });
    expect(renewalInfo(c, TODAY, 30).phase).toBe('ok');
    expect(renewalInfo(c, TODAY, 60).phase).toBe('soon');
  });
});

/* --- recorded decisions --- */

const inNotice = (extra = {}) => contract({
  endDate: addDays(TODAY, 20), noticeDays: 30, autoRenew: true, ...extra,
});

const decision = (kind, forTermEnd, extra = {}) => ({
  kind, forTermEnd, date: TODAY, note: '', ...extra,
});

describe('decisionFor', () => {
  it('applies only to the term end it was recorded against', () => {
    const term = addDays(TODAY, 20);
    const c = inNotice({ decision: decision('renewing', term) });
    expect(decisionFor(c, term).kind).toBe('renewing');
    // Once the next term is in play, last year's decision says nothing.
    expect(decisionFor(c, addDays(TODAY, 385))).toBeNull();
  });

  it('ignores junk', () => {
    expect(decisionFor(contract(), '2026-09-01')).toBeNull();
    expect(decisionFor(contract({ decision: { kind: 'maybe' } }), '2026-09-01')).toBeNull();
  });
});

describe('decisionHandles', () => {
  it('holds for the three real answers', () => {
    for (const kind of ['notice-given', 'renewing', 'not-renewing']) {
      expect(decisionHandles(decision(kind, TODAY), TODAY)).toBe(true);
    }
  });

  it('holds for a snooze only until its date', () => {
    expect(decisionHandles(decision('snoozed', TODAY, { until: addDays(TODAY, 3) }), TODAY)).toBe(true);
    expect(decisionHandles(decision('snoozed', TODAY, { until: TODAY }), TODAY)).toBe(true);
    expect(decisionHandles(decision('snoozed', TODAY, { until: addDays(TODAY, -1) }), TODAY)).toBe(false);
    expect(decisionHandles(decision('snoozed', TODAY, { until: 'someday' }), TODAY)).toBe(false);
  });

  it('is false without a decision', () => {
    expect(decisionHandles(null, TODAY)).toBe(false);
  });
});

describe('needsAttention', () => {
  it('is true for an open notice window and a lapsed term', () => {
    expect(needsAttention(inNotice(), renewalInfo(inNotice(), TODAY))).toBe(true);
    const expired = contract({ endDate: addDays(TODAY, -5), autoRenew: false });
    expect(needsAttention(expired, renewalInfo(expired, TODAY))).toBe(true);
  });

  it('is false once any decision is recorded for that term', () => {
    for (const kind of ['notice-given', 'renewing', 'not-renewing']) {
      const c = inNotice({ decision: decision(kind, addDays(TODAY, 20)) });
      expect(needsAttention(c, renewalInfo(c, TODAY))).toBe(false);
    }
  });

  it('is false while snoozed and true again the day after', () => {
    const snoozed = (until) => inNotice({ decision: decision('snoozed', addDays(TODAY, 20), { until }) });
    const a = snoozed(addDays(TODAY, 5));
    expect(needsAttention(a, renewalInfo(a, TODAY))).toBe(false);
    const b = snoozed(addDays(TODAY, -1));
    expect(needsAttention(b, renewalInfo(b, TODAY))).toBe(true);
  });

  it('ignores drafts and terminated contracts', () => {
    expect(needsAttention(contract({ status: 'draft', endDate: addDays(TODAY, -5) }))).toBe(false);
    expect(needsAttention(contract({ status: 'terminated', endDate: addDays(TODAY, -5) }))).toBe(false);
  });
});

describe('nextTermEnd with a recorded ending', () => {
  it('stops rolling forward at the term the notice was given for', () => {
    const term = addDays(TODAY, -10);
    const c = contract({
      endDate: term, autoRenew: true, termMonths: 12,
      decision: decision('notice-given', term),
    });
    // Without the decision this would have rolled a year forward.
    expect(nextTermEnd(c, TODAY)).toBe(term);
    expect(renewalInfo(c, TODAY).phase).toBe('expired');
  });

  it('keeps rolling when the decision was to renew', () => {
    const term = addDays(TODAY, -10);
    const c = contract({
      endDate: term, autoRenew: true, termMonths: 12,
      decision: decision('renewing', term),
    });
    expect(nextTermEnd(c, TODAY)).toBe(addMonths(term, 12));
  });
});

describe('isTermEnd', () => {
  it('is the end date of a fixed term and nothing else', () => {
    const c = contract({ endDate: '2026-06-01', autoRenew: false });
    expect(isTermEnd(c, '2026-06-01')).toBe(true);
    expect(isTermEnd(c, '2027-06-01')).toBe(false);
  });

  it('is every renewal boundary of an auto-renewing contract', () => {
    const c = contract({ endDate: '2026-01-31', autoRenew: true, termMonths: 6 });
    expect(isTermEnd(c, '2026-01-31')).toBe(true);
    // Counted from the anchor each time, so a clamped month end stays on the series.
    expect(isTermEnd(c, '2026-07-31')).toBe(true);
    expect(isTermEnd(c, '2027-01-31')).toBe(true);
    expect(isTermEnd(c, '2026-07-30')).toBe(false);
    expect(isTermEnd(c, '2025-07-31')).toBe(false);
  });

  it('is false for junk and for a contract with no end date', () => {
    expect(isTermEnd(contract({ endDate: null }), '2026-06-01')).toBe(false);
    expect(isTermEnd(contract(), 'someday')).toBe(false);
  });
});

describe('nextTermEnd after the schedule moved under a decision', () => {
  // Notice was given for the term ending Sep 1; the end date was then
  // corrected to Oct 15. Sep 1 is no longer a term end of anything.
  const moved = contract({
    endDate: '2026-10-15', autoRenew: true, termMonths: 12,
    decision: decision('notice-given', '2026-09-01'),
  });

  it('does not let a date that is no longer a term end cap the schedule', () => {
    expect(nextTermEnd(moved, TODAY)).toBe('2026-10-15');
    // The decision was about another term, so it no longer answers this one.
    expect(renewalInfo(moved, TODAY).decision).toBeNull();
    // And the agreement is not treated as ending on the stale date, which
    // closed every "until the contract ends" series at Sep 1.
    expect(agreementEnd(moved, TODAY)).toBeNull();
  });

  it('still stops at a decision keyed to a real term end', () => {
    const term = addDays(TODAY, -10);
    const c = contract({
      endDate: addMonths(term, -12), autoRenew: true, termMonths: 12,
      decision: decision('notice-given', term),
    });
    expect(nextTermEnd(c, TODAY)).toBe(term);
  });
});

describe('agreementEnd', () => {
  it('is the end date of a fixed term', () => {
    const c = contract({ endDate: addDays(TODAY, 30), autoRenew: false });
    expect(agreementEnd(c, TODAY)).toBe(addDays(TODAY, 30));
  });

  it('is unknown while a contract keeps rolling forward', () => {
    // The renewal date is when the term ends, not when the agreement does.
    const c = contract({ endDate: addDays(TODAY, 30), autoRenew: true, termMonths: 12 });
    expect(nextTermEnd(c, TODAY)).toBe(addDays(TODAY, 30));
    expect(agreementEnd(c, TODAY)).toBeNull();
  });

  it('is the term end once a decision makes that term the last', () => {
    const term = addDays(TODAY, 30);
    for (const kind of ['notice-given', 'not-renewing']) {
      const c = contract({
        endDate: term, autoRenew: true, termMonths: 12, decision: decision(kind, term),
      });
      expect(agreementEnd(c, TODAY)).toBe(term);
    }
  });

  it('is null for an evergreen agreement', () => {
    expect(agreementEnd(contract({ endDate: null }), TODAY)).toBeNull();
  });
});

describe('completedTerms', () => {
  it('is empty while the first term is still running', () => {
    expect(completedTerms(contract({ endDate: addDays(TODAY, 20) }), TODAY)).toEqual([]);
  });

  it('records one term for a lapsed fixed term', () => {
    const c = contract({ startDate: '2025-01-01', endDate: '2026-01-01', autoRenew: false });
    expect(completedTerms(c, TODAY)).toEqual([{ start: '2025-01-01', end: '2026-01-01' }]);
  });

  it('records every crossed boundary for a long-neglected auto-renewal', () => {
    const c = contract({
      startDate: '2023-06-02', endDate: '2024-06-01', autoRenew: true, termMonths: 12,
    });
    expect(completedTerms(c, TODAY)).toEqual([
      { start: '2023-06-02', end: '2024-06-01' },
      { start: '2024-06-02', end: '2025-06-01' },
      { start: '2025-06-02', end: '2026-06-01' },
    ]);
  });

  it('stops at the term a notice was given for', () => {
    const c = contract({
      startDate: '2024-06-02', endDate: '2025-06-01', autoRenew: true, termMonths: 12,
      decision: decision('notice-given', '2025-06-01'),
    });
    expect(completedTerms(c, TODAY)).toEqual([{ start: '2024-06-02', end: '2025-06-01' }]);
  });

  it('has nothing to say without an end date', () => {
    expect(completedTerms(contract({ endDate: null }), TODAY)).toEqual([]);
  });
});
