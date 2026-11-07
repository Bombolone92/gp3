/** The sample dataset must be internally consistent, whenever it is built. */
import { describe, it, expect } from 'vitest';
import { buildSeedData } from '../src/core/seed.js';
import { isValidStage } from '../src/core/pipeline.js';
import { validateInterview } from '../src/core/interviews.js';
import { validateScorecard } from '../src/core/scorecards.js';
import { OFFER_STATUS } from '../src/core/offers.js';
import { todayISO } from '../src/lib/dates.js';

const NOW = new Date('2026-03-10T09:00:00');
const seed = buildSeedData(NOW);

describe('referential integrity', () => {
  const jobIds = new Set(seed.jobs.map((j) => j.id));
  const candidateIds = new Set(seed.candidates.map((c) => c.id));

  it('every candidate points at a real job', () => {
    for (const c of seed.candidates) expect(jobIds.has(c.jobId)).toBe(true);
  });

  it('every interview, scorecard, and offer points at real records', () => {
    for (const i of seed.interviews) {
      expect(candidateIds.has(i.candidateId)).toBe(true);
      expect(jobIds.has(i.jobId)).toBe(true);
    }
    const interviewIds = new Set(seed.interviews.map((i) => i.id));
    for (const s of seed.scorecards) {
      expect(candidateIds.has(s.candidateId)).toBe(true);
      if (s.interviewId) expect(interviewIds.has(s.interviewId)).toBe(true);
    }
    for (const o of seed.offers) expect(candidateIds.has(o.candidateId)).toBe(true);
  });

  it('every onboarding plan belongs to a hired candidate', () => {
    for (const id of Object.keys(seed.onboarding)) {
      const candidate = seed.candidates.find((c) => c.id === id);
      expect(candidate?.stage).toBe('hired');
    }
  });
});

describe('record validity', () => {
  it('stages, interviews, scorecards, and offers all pass their validators', () => {
    for (const c of seed.candidates) expect(isValidStage(c.stage)).toBe(true);
    for (const i of seed.interviews) expect(validateInterview(i)).toEqual([]);
    for (const s of seed.scorecards) expect(validateScorecard(s)).toEqual([]);
    for (const o of seed.offers) expect(Object.values(OFFER_STATUS)).toContain(o.status);
  });

  it('every candidate’s history walks to their current stage, in order', () => {
    // Reports are reconstructed purely from history: a candidate sitting
    // in a stage their history never reached would make the sample
    // Reports contradict the sample board.
    for (const c of seed.candidates) {
      const ats = c.history.map((e) => e.at);
      expect([...ats].sort()).toEqual(ats);
      let stage = 'applied';
      for (const e of c.history) {
        if (e.type === 'stage') {
          expect(e.from).toBe(stage);
          stage = e.to;
        }
      }
      expect(stage).toBe(c.stage);
    }
    for (const c of seed.candidates.filter((x) => x.status === 'active')) {
      const lastMove = [...c.history].reverse().find((e) => e.type === 'stage');
      expect(c.stageChangedAt).toBe(lastMove ? lastMove.at : c.createdAt);
    }
  });

  it('ids are unique across each collection', () => {
    for (const list of [seed.jobs, seed.candidates, seed.interviews, seed.scorecards, seed.offers]) {
      expect(new Set(list.map((r) => r.id)).size).toBe(list.length);
    }
  });
});

describe('liveliness relative to now', () => {
  it('includes upcoming interviews so the dashboard is never empty', () => {
    const today = todayISO(NOW);
    expect(seed.interviews.some((i) => i.date >= today)).toBe(true);
  });

  it('includes one offer awaiting signature and one signed hire mid-onboarding', () => {
    expect(seed.offers.some((o) => o.status === 'sent')).toBe(true);
    const signed = seed.offers.find((o) => o.status === 'signed');
    expect(signed).toBeTruthy();
    const plan = seed.onboarding[signed.candidateId];
    expect(plan.tasks.some((t) => t.done)).toBe(true);
    expect(plan.tasks.some((t) => !t.done)).toBe(true);
  });

  it('stores the plan the way the app writes one, with stable task ids', () => {
    const plan = seed.onboarding.cnd_sofia;
    // The store stamps the template's name onto every plan it creates, and
    // the Onboarding view reads it; the sample hire must not be the one
    // checklist that cannot say where it came from.
    expect(plan.templateName).toBeTruthy();
    // The id maker is the second argument: passed in the template's place
    // it was ignored, and the plan drew random ids instead.
    const again = buildSeedData(NOW);
    expect(plan.tasks.map((t) => t.id)).toEqual(again.onboarding.cnd_sofia.tasks.map((t) => t.id));
    expect(plan.tasks.some((t) => Number.isInteger(t.offsetDays))).toBe(true);
  });

  it('names a company for offer letters', () => {
    expect(seed.settings.companyName).toBeTruthy();
  });
});
