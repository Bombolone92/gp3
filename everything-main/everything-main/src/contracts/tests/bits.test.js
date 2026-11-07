import { describe, it, expect } from 'vitest';
import { attentionLine, renewalLine, rowSubtitle } from '../src/ui/bits.js';
import { renewalInfo, addDays } from '../src/lib/dates.js';

const TODAY = '2026-08-05';

function contract(overrides = {}) {
  return {
    status: 'active', startDate: '2025-01-01', endDate: addDays(TODAY, 40),
    autoRenew: true, termMonths: 12, noticeDays: 30, decision: null,
    ...overrides,
  };
}

const line = (c) => attentionLine(c, renewalInfo(c, TODAY));

describe('attentionLine', () => {
  it('names the notice deadline while it can still be met', () => {
    const c = contract({ endDate: addDays(TODAY, 40), noticeDays: 30 });
    expect(line(c)).toBe(`Cancel or renegotiate by ${fmt(addDays(TODAY, 10))} (in 10 days)`);
  });

  it('stops asking for notice once the deadline has passed', () => {
    // 18 days to the term end with a 30-day notice period: the window closed
    // twelve days ago, and "cancel by <then>" is not something anyone can do.
    const c = contract({ endDate: addDays(TODAY, 18), noticeDays: 30 });
    expect(line(c)).toBe(`Notice deadline passed ${fmt(addDays(TODAY, -12))} · renews ${fmt(addDays(TODAY, 18))} (in 18 days)`);
    expect(line(contract({ endDate: addDays(TODAY, 18), noticeDays: 30, autoRenew: false })))
      .toContain(`ends ${fmt(addDays(TODAY, 18))}`);
  });

  it('says when a lapsed term ended', () => {
    const c = contract({ endDate: addDays(TODAY, -5), autoRenew: false });
    expect(line(c)).toBe(`Term ended ${fmt(addDays(TODAY, -5))} (5 days ago)`);
  });
});

describe('renewalLine', () => {
  const at = (c) => renewalLine(c, renewalInfo(c, TODAY));
  const term = addDays(TODAY, 20);
  const decision = (kind) => ({ kind, forTermEnd: term, date: TODAY, note: '' });

  it('says what the contract does at its term end', () => {
    expect(at(contract({ endDate: term }))).toBe(`Renews ${fmt(term)} (in 20 days)`);
    expect(at(contract({ endDate: term, autoRenew: false }))).toBe(`Expires ${fmt(term)} (in 20 days)`);
    expect(at(contract({ endDate: null }))).toBeNull();
  });

  it('says a contract ends once notice was given or renewal declined', () => {
    // The badge beside the row says "Notice given"; the line cannot say "Renews".
    expect(at(contract({ endDate: term, decision: decision('notice-given') })))
      .toBe(`Ends ${fmt(term)} (in 20 days)`);
    expect(at(contract({ endDate: term, decision: decision('not-renewing') })))
      .toBe(`Ends ${fmt(term)} (in 20 days)`);
    // Renewing and snoozing change nothing about what happens on the date.
    expect(at(contract({ endDate: term, decision: decision('renewing') })))
      .toBe(`Renews ${fmt(term)} (in 20 days)`);
  });

  it('uses the past tense once that last term is over', () => {
    const gone = addDays(TODAY, -3);
    const c = contract({ endDate: gone, decision: { kind: 'notice-given', forTermEnd: gone, date: TODAY, note: '' } });
    expect(at(c)).toBe(`Ended ${fmt(gone)} (3 days ago)`);
    expect(at(contract({ endDate: gone, autoRenew: false }))).toBe(`Expired ${fmt(gone)} (3 days ago)`);
  });

  it('ignores a decision that was about another term', () => {
    const c = contract({ endDate: term, decision: { kind: 'renewing', forTermEnd: addDays(term, -365), date: TODAY, note: '' } });
    expect(renewalInfo(c, TODAY).decision).toBeNull();
    expect(at(c)).toBe(`Renews ${fmt(term)} (in 20 days)`);
    // Even an ending one, once the end date has been edited away from it.
    const edited = contract({ endDate: term, decision: { kind: 'notice-given', forTermEnd: addDays(term, 3), date: TODAY, note: '' } });
    expect(at(edited)).toBe(`Renews ${fmt(term)} (in 20 days)`);
  });
});

describe('rowSubtitle', () => {
  it('dates a closed-out contract by the term it actually ended on', () => {
    const c = contract({
      status: 'terminated', endDate: '2024-06-01',
      termHistory: [{ start: '2025-06-02', end: '2026-06-01', ended: 'notice-given' }],
    });
    expect(rowSubtitle(c, renewalInfo(c, TODAY))).toBe(`Ended ${fmt('2026-06-01')}`);
    const evergreen = contract({ status: 'terminated', endDate: null });
    expect(rowSubtitle(evergreen, renewalInfo(evergreen, TODAY))).toBe('Closed out');
  });
});

function fmt(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
