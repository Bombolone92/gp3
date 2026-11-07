import { describe, it, expect } from 'vitest';
import {
  averageDaysInStage,
  median,
  offerOutcomes,
  reachedStages,
  scopeCandidates,
  sourceBreakdown,
  stageConversion,
  stageVisits,
  timeToHire,
} from '../src/core/analytics.js';

const T = (day, hour = 0) =>
  new Date(Date.UTC(2026, 2, day, hour)).toISOString();

/** A candidate who applied on day `start` and moved along `moves`. */
function journey(start, moves, extra = {}) {
  const history = [{ at: T(start), type: 'created', stage: 'applied' }];
  let stage = 'applied';
  for (const [day, to] of moves) {
    history.push({ at: T(day), type: 'stage', from: stage, to });
    stage = to;
  }
  return { id: extra.id ?? 'c', jobId: extra.jobId ?? 'j1', source: extra.source ?? '', createdAt: T(start), stage, status: 'active', history, ...extra };
}

describe('median', () => {
  it('handles odd, even, and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('stageVisits', () => {
  it('reconstructs entry and exit per stage, closing the current stage at now', () => {
    const candidate = journey(1, [
      [3, 'screen'],
      [8, 'interview'],
    ]);
    const visits = stageVisits(candidate, T(10));
    expect(visits).toHaveLength(3);
    expect(visits[0]).toMatchObject({ stage: 'applied', days: 2 });
    expect(visits[1]).toMatchObject({ stage: 'screen', days: 5 });
    expect(visits[2]).toMatchObject({ stage: 'interview', to: null, days: 2 });
  });

  it('closes an archived candidate’s last stage at the archive event, not at now', () => {
    const candidate = journey(1, [[3, 'screen']], { status: 'rejected' });
    candidate.history.push({ at: T(5), type: 'rejected', reason: '' });
    const visits = stageVisits(candidate, T(31));
    expect(visits.at(-1)).toMatchObject({ stage: 'screen', to: T(5), days: 2 });
    const screen = averageDaysInStage([candidate], T(31)).find((r) => r.stage === 'screen');
    expect(screen.average).toBe(2);
  });

  it('leaves out a visit whose timestamps cannot be read', () => {
    // Only a hand-edited or foreign backup carries one, but the whole
    // report used to go with it: NaN days spread into the stage average
    // for every candidate, and into Compare's days in process.
    const broken = journey(1, [[5, 'screen']]);
    broken.history[0].at = 'yesterday';
    const visits = stageVisits(broken, T(10));
    expect(visits).toEqual([{ stage: 'screen', from: T(5), to: null, days: 5 }]);
    const healthy = journey(1, [[5, 'screen']]);
    const applied = averageDaysInStage([broken, healthy], T(10)).find((r) => r.stage === 'applied');
    expect(applied.average).toBe(4);
    const total = stageVisits(broken, T(10)).reduce((sum, v) => sum + v.days, 0);
    expect(Number.isFinite(total)).toBe(true);
  });

  it('does not count time in the archive when a candidate is restored', () => {
    const candidate = journey(1, [[3, 'screen']]);
    candidate.history.push({ at: T(5), type: 'rejected', reason: '' });
    candidate.history.push({ at: T(25), type: 'restored' });
    const visits = stageVisits(candidate, T(28));
    // screen: 2 days before the archive, then 3 days after the restore.
    expect(visits.filter((v) => v.stage === 'screen').map((v) => v.days)).toEqual([2, 3]);
  });

  it('starts a fresh applied visit on re-engagement, skipping archived time', () => {
    const candidate = journey(1, [[3, 'screen']], { jobId: 'j2' });
    candidate.history.push({ at: T(5), type: 'rejected', reason: '' });
    candidate.history.push({ at: T(20), type: 'reengaged', from: 'j1', to: 'j2' });
    const visits = stageVisits(candidate, T(24));
    expect(visits.at(-1)).toMatchObject({ stage: 'applied', from: T(20), to: null, days: 4 });
    expect(visits.filter((v) => v.stage === 'screen')).toHaveLength(1);
  });
});

describe('reachedStages / stageConversion', () => {
  it('counts skipped stages as advanced past, not as visited', () => {
    const skipper = journey(1, [[2, 'offer']]); // applied straight to offer
    const conversion = stageConversion([skipper]);
    const applied = conversion.find((c) => c.stage === 'applied');
    const screen = conversion.find((c) => c.stage === 'screen');
    expect(applied).toMatchObject({ reached: 1, advanced: 1 });
    expect(screen).toMatchObject({ reached: 0, advanced: 0, rate: null });
    expect(reachedStages(skipper).has('screen')).toBe(false);
  });

  it('does not leak a previous candidacy into the re-engaged one', () => {
    // Applied to j1, reached offer, was rejected, later re-engaged onto j2.
    const candidate = journey(1, [
      [2, 'screen'],
      [3, 'interview'],
      [4, 'offer'],
    ], { jobId: 'j2' });
    candidate.history.push({ at: T(6), type: 'rejected', reason: '' });
    candidate.history.push({ at: T(20), type: 'reengaged', from: 'j1', to: 'j2' });
    candidate.stage = 'applied';

    expect([...reachedStages(candidate)]).toEqual(['applied']);
    const conversion = stageConversion([candidate]);
    expect(conversion.find((c) => c.stage === 'applied')).toMatchObject({ reached: 1, advanced: 0 });
    expect(conversion.find((c) => c.stage === 'offer')).toMatchObject({ reached: 0 });
  });

  it('computes rates over everyone who reached each stage', () => {
    const hiredOne = journey(1, [
      [2, 'screen'],
      [3, 'interview'],
      [4, 'offer'],
      [5, 'hired'],
    ]);
    const stalled = journey(1, [[2, 'screen']]);
    const fresh = journey(1, []);
    const conversion = stageConversion([hiredOne, stalled, fresh]);
    expect(conversion.find((c) => c.stage === 'applied')).toMatchObject({ reached: 3, advanced: 2 });
    expect(conversion.find((c) => c.stage === 'screen')).toMatchObject({ reached: 2, advanced: 1, rate: 0.5 });
    expect(conversion.find((c) => c.stage === 'offer')).toMatchObject({ reached: 1, advanced: 1, rate: 1 });
  });
});

describe('timeToHire', () => {
  it('measures application-to-hired in days, median across hires', () => {
    const fast = journey(1, [[5, 'hired']]);
    const slow = journey(1, [[21, 'hired']]);
    const open = journey(1, [[2, 'screen']]);
    const result = timeToHire([fast, slow, open]);
    expect(result.count).toBe(2);
    expect(result.median).toBe(12);
  });

  it('skips a hire whose dates cannot be read instead of reporting NaN', () => {
    const fast = journey(1, [[5, 'hired']]);
    const broken = journey(1, [[9, 'hired']]);
    broken.createdAt = 'whenever';
    broken.history[0].at = 'whenever';
    const result = timeToHire([fast, broken]);
    expect(result.count).toBe(1);
    expect(result.median).toBe(4);
  });

  it('scopes hires by when the hire happened when given since', () => {
    const early = journey(1, [[3, 'hired']]);
    const late = journey(1, [[20, 'hired']], { id: 'c2' });
    // Both candidates were added on day 1; only the day-20 hire falls in
    // a window starting on day 10.
    expect(timeToHire([early, late], { since: T(10) })).toEqual({ count: 1, median: 19 });
    expect(timeToHire([early, late])).toMatchObject({ count: 2 });
  });

  it('is empty with no hires', () => {
    expect(timeToHire([journey(1, [])])).toEqual({ count: 0, median: null });
  });

  it('counts a candidate created directly in Hired as a day-zero hire', () => {
    // The editor's starting-stage select includes Hired; the Sources
    // table counts such a candidate as a hire, so the median-time-to-hire
    // tile on the same screen must too.
    const direct = journey(1, []);
    direct.history = [{ at: T(1), type: 'created', stage: 'hired' }];
    direct.stage = 'hired';
    expect(timeToHire([direct])).toEqual({ count: 1, median: 0 });
    // The since window keys off when the hire happened.
    expect(timeToHire([direct], { since: T(2) })).toEqual({ count: 0, median: null });
  });

  it('measures a re-engaged hire from the re-engagement, not record creation', () => {
    // Rejected on j1 after 5 days, re-engaged onto j2 on day 25, hired day 30.
    const candidate = journey(1, [[3, 'screen']], { jobId: 'j2' });
    candidate.history.push({ at: T(5), type: 'rejected', reason: '' });
    candidate.history.push({ at: T(25), type: 'reengaged', from: 'j1', to: 'j2' });
    candidate.history.push({ at: T(30), type: 'stage', from: 'applied', to: 'hired' });
    candidate.stage = 'hired';
    // 5 days on the new candidacy — not 29 spanning the archive gap.
    expect(timeToHire([candidate])).toEqual({ count: 1, median: 5 });
  });

  it('does not attribute a previous candidacy’s hire to the re-engaged one', () => {
    const candidate = journey(1, [[4, 'hired']], { jobId: 'j2', source: 'Referral' });
    candidate.history.push({ at: T(6), type: 'rejected', reason: '' });
    candidate.history.push({ at: T(25), type: 'reengaged', from: 'j1', to: 'j2' });
    candidate.stage = 'applied';
    candidate.status = 'active';
    expect(timeToHire([candidate])).toEqual({ count: 0, median: null });
    expect(sourceBreakdown([candidate])[0]).toMatchObject({ source: 'Referral', total: 1, hired: 0 });
  });
});

describe('averageDaysInStage', () => {
  it('averages across visits including the open current stage', () => {
    const a = journey(1, [[3, 'screen']]); // applied 2d, screen open 7d at T(10)
    const b = journey(1, [[5, 'screen']]); // applied 4d, screen open 5d
    const rows = averageDaysInStage([a, b], T(10));
    expect(rows.find((r) => r.stage === 'applied').average).toBe(3);
    expect(rows.find((r) => r.stage === 'screen').average).toBe(6);
    expect(rows.find((r) => r.stage === 'offer').average).toBeNull();
  });
});

describe('sourceBreakdown', () => {
  it('groups by source with hires, busiest first, Unknown for blank', () => {
    const rows = sourceBreakdown([
      journey(1, [[2, 'hired']], { source: 'Referral' }),
      journey(1, [], { source: 'Referral' }),
      journey(1, [], { source: '' }),
    ]);
    expect(rows[0]).toMatchObject({ source: 'Referral', total: 2, hired: 1 });
    expect(rows[1]).toMatchObject({ source: 'Unknown', total: 1, hired: 0 });
  });
});

describe('offerOutcomes', () => {
  const offers = [
    { candidateId: 'a', status: 'signed', sentAt: T(2), resolvedAt: T(4) },
    { candidateId: 'b', status: 'declined', sentAt: T(2), resolvedAt: T(4) },
    { candidateId: 'c', status: 'sent', sentAt: T(2) },
    { candidateId: 'd', status: 'draft', sentAt: null },
  ];

  it('computes sent, signed, declined, and acceptance', () => {
    expect(offerOutcomes(offers)).toEqual({ sent: 3, signed: 1, declined: 1, acceptance: 0.5 });
  });

  it('scopes to a candidate set and handles no outcomes', () => {
    expect(offerOutcomes(offers, new Set(['c']))).toMatchObject({ sent: 1, acceptance: null });
  });

  it('counts an offer in the period it happened in, not the one it was drafted in', () => {
    // Everything landed on days 2 and 4; a window opening on day 3 holds
    // the two outcomes and none of the sends.
    expect(offerOutcomes(offers, null, { since: T(3) })).toEqual({ sent: 0, signed: 1, declined: 1, acceptance: 0.5 });
    // A window opening after everything is empty, acceptance included.
    expect(offerOutcomes(offers, null, { since: T(9) })).toEqual({ sent: 0, signed: 0, declined: 0, acceptance: null });
    // And one that opens before it all sees the lot.
    expect(offerOutcomes(offers, null, { since: T(1) })).toEqual({ sent: 3, signed: 1, declined: 1, acceptance: 0.5 });
  });

  it('falls back to signedAt when an older record has no resolvedAt', () => {
    const legacy = [{ candidateId: 'a', status: 'signed', sentAt: T(2), signedAt: T(4) }];
    expect(offerOutcomes(legacy, null, { since: T(3) })).toMatchObject({ signed: 1 });
    expect(offerOutcomes(legacy, null, { since: T(5) })).toMatchObject({ signed: 0 });
  });
});

describe('scopeCandidates', () => {
  it('filters by job and created-after timestamp', () => {
    const early = journey(1, [], { id: 'e', jobId: 'j1' });
    const late = journey(20, [], { id: 'l', jobId: 'j2' });
    expect(scopeCandidates([early, late], { jobId: 'j2' })).toEqual([late]);
    expect(scopeCandidates([early, late], { since: T(10) })).toEqual([late]);
    expect(scopeCandidates([early, late], {})).toHaveLength(2);
  });
});
