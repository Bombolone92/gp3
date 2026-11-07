import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, sanitizeFileName, MAX_ATTACHMENT_BYTES } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';
import { MAX_TAGS } from '../src/core/tags.js';

let store;
let backend;
let tick;

/** Deterministic, strictly increasing clock so ordering by timestamp is stable. */
function makeClock() {
  let t = new Date('2026-03-01T09:00:00Z').getTime();
  return () => new Date((t += 60_000)).toISOString();
}

beforeEach(async () => {
  backend = createMemoryBackend();
  tick = makeClock();
  store = createStore(backend, { now: tick });
  await store.init();
});

async function seedJob(overrides = {}) {
  return store.addJob({ title: 'Frontend Engineer', department: 'Engineering', ...overrides });
}

async function seedCandidate(job, overrides = {}) {
  return store.addCandidate({ name: 'Ada Lovelace', jobId: job.id, ...overrides });
}

describe('jobs', () => {
  it('creates a job with defaults and persists it', async () => {
    const job = await seedJob();
    expect(job.status).toBe('open');
    expect(job.title).toBe('Frontend Engineer');
    expect(backend.peek('jobs')).toHaveLength(1);
  });

  it('requires a title', async () => {
    await expect(store.addJob({ title: '   ' })).rejects.toThrow(/title is required/i);
  });

  it('rejects an inverted salary range', async () => {
    await expect(seedJob({ salaryMin: 90000, salaryMax: 60000 })).rejects.toThrow(/minimum is above/i);
    const job = await seedJob({ salaryMin: 60000, salaryMax: 90000 });
    await expect(store.updateJob(job.id, { salaryMin: 100000 })).rejects.toThrow(/minimum is above/i);
  });

  it('rejects negative and non-numeric salaries', async () => {
    await expect(seedJob({ salaryMin: -5000 })).rejects.toThrow(/positive number/i);
    await expect(seedJob({ salaryMax: 'lots' })).rejects.toThrow(/positive number/i);
    const job = await seedJob({ salaryMin: 60000 });
    await expect(store.updateJob(job.id, { salaryMax: -1 })).rejects.toThrow(/positive number/i);
  });

  it('stamps closedAt when closing and clears it on reopen', async () => {
    const job = await seedJob();
    await store.updateJob(job.id, { status: 'closed' });
    expect(store.state.jobs[0].closedAt).toBeTruthy();
    await store.updateJob(job.id, { status: 'open' });
    expect(store.state.jobs[0].closedAt).toBeNull();
  });

  it('deleting a job cascades to every dependent record', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.addScorecard({ candidateId: candidate.id, author: 'Grace', recommendation: 'yes' });
    await store.createOffer({ candidateId: candidate.id, salary: 90000, startDate: '2026-05-01' });
    await store.moveStage(candidate.id, 'hired');

    await store.deleteJob(job.id);
    expect(store.state.jobs).toHaveLength(0);
    expect(store.state.candidates).toHaveLength(0);
    expect(store.state.interviews).toHaveLength(0);
    expect(store.state.scorecards).toHaveLength(0);
    expect(store.state.offers).toHaveLength(0);
    expect(store.state.onboarding).toEqual({});
    expect(backend.peek('candidates')).toEqual([]);
  });
});

describe('proposing interview times', () => {
  async function proposal(extra = {}) {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const interview = await store.proposeInterview({
      candidateId: candidate.id,
      slots: [
        { date: '2026-09-08', start: '10:00', end: '11:00' },
        { date: '2026-09-07', start: '14:00', end: '15:00' },
      ],
      timeZone: 'Europe/Berlin',
      ...extra,
    });
    return { job, candidate, interview };
  }

  it('stores the options and mirrors the earliest one', async () => {
    const { interview, candidate } = await proposal();
    expect(interview.status).toBe('proposed');
    expect(interview.slots).toHaveLength(2);
    // The schedule orders by date/start, so the record points at the
    // earliest option rather than at nothing.
    expect(interview.date).toBe('2026-09-07');
    expect(interview.start).toBe('14:00');
    expect(interview.proposedAt).toBeTruthy();
    expect(candidate.history.at(-1)).toMatchObject({ type: 'interview', action: 'proposed', count: 2 });
  });

  it('refuses a proposal with nothing to choose between', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(
      store.proposeInterview({ candidateId: candidate.id, slots: [{ date: '2026-09-07', start: '14:00', end: '15:00' }] })
    ).rejects.toThrow(/at least 2/i);
    expect(store.state.interviews).toHaveLength(0);
  });

  it('turns into a normal interview when a slot is confirmed', async () => {
    const { interview, candidate } = await proposal();
    const confirmed = await store.confirmInterviewSlot(interview.id, 1);
    expect(confirmed.status).toBe('scheduled');
    expect(confirmed.date).toBe('2026-09-08');
    expect(confirmed.start).toBe('10:00');
    expect(confirmed.slots).toBeUndefined();
    expect(confirmed.proposedAt).toBeUndefined();
    expect(candidate.history.at(-1)).toMatchObject({ type: 'interview', date: '2026-09-08', start: '10:00' });
    // Confirming twice is not a thing that can happen.
    await expect(store.confirmInterviewSlot(interview.id, 0)).rejects.toThrow(/already has a fixed time/i);
  });

  it('refuses an option that is not on the list', async () => {
    const { interview } = await proposal();
    await expect(store.confirmInterviewSlot(interview.id, 5)).rejects.toThrow(/no longer on the list/i);
    expect(store.state.interviews[0].status).toBe('proposed');
  });

  it('needs an active candidate, to propose and to confirm', async () => {
    const { interview, candidate } = await proposal();
    await store.rejectCandidate(candidate.id, {});
    await expect(store.confirmInterviewSlot(interview.id, 0)).rejects.toThrow(/Restore the candidate/i);
    await expect(
      store.proposeInterview({
        candidateId: candidate.id,
        slots: [
          { date: '2026-09-08', start: '10:00', end: '11:00' },
          { date: '2026-09-09', start: '10:00', end: '11:00' },
        ],
      })
    ).rejects.toThrow(/Restore the candidate/i);
  });

  it('replaces the options on edit, and settles the proposal when a time is typed', async () => {
    const { interview } = await proposal();
    await store.updateInterview(interview.id, {
      slots: [
        { date: '2026-09-10', start: '09:00', end: '09:45' },
        { date: '2026-09-11', start: '09:00', end: '09:45' },
      ],
    });
    expect(interview.slots).toHaveLength(2);
    expect(interview.date).toBe('2026-09-10');
    expect(interview.end).toBe('09:45');
    await store.updateInterview(interview.id, { date: '2026-09-15', start: '11:00', end: '12:00', status: 'scheduled' });
    expect(interview.status).toBe('scheduled');
    expect(interview.slots).toBeUndefined();
  });

  it('keeps the original wait when the options are edited', async () => {
    const { interview } = await proposal();
    const sentAt = interview.proposedAt;
    await store.updateInterview(interview.id, {
      slots: [
        { date: '2026-09-10', start: '09:00', end: '09:45' },
        { date: '2026-09-11', start: '09:00', end: '09:45' },
      ],
    });
    expect(interview.proposedAt).toBe(sentAt);
  });

  it('stamps a fixed interview turned into a proposal as sent now', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const interview = await store.scheduleInterview({
      candidateId: candidate.id,
      date: '2026-09-01',
      start: '10:00',
      end: '11:00',
    });
    const scheduledAt = interview.createdAt;
    await store.updateInterview(interview.id, {
      slots: [
        { date: '2026-09-20', start: '10:00', end: '11:00' },
        { date: '2026-09-21', start: '10:00', end: '11:00' },
      ],
    });
    // Measured from createdAt, the options would read as unanswered for as
    // long as the interview had existed.
    expect(interview.status).toBe('proposed');
    expect(interview.proposedAt > scheduledAt).toBe(true);
  });
});

describe('interview time zones', () => {
  it('stores the zone given, and refuses one the browser cannot resolve', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const interview = await store.scheduleInterview({
      candidateId: candidate.id,
      date: '2026-03-10',
      start: '14:00',
      end: '15:00',
      timeZone: 'Europe/Berlin',
    });
    expect(interview.timeZone).toBe('Europe/Berlin');
    await expect(
      store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-11', start: '10:00', end: '11:00', timeZone: 'Mars/Olympus' })
    ).rejects.toThrow(/time zone/i);
    await store.updateInterview(interview.id, { timeZone: 'UTC' });
    expect(interview.timeZone).toBe('UTC');
  });

  it('falls back to the account default, and to none at all', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.updateSettings({ timeZone: 'Asia/Tokyo' });
    const withDefault = await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '09:00', end: '10:00' });
    expect(withDefault.timeZone).toBe('Asia/Tokyo');
    await store.updateSettings({ timeZone: '' });
    const floating = await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-12', start: '09:00', end: '10:00' });
    expect(floating.timeZone).toBe('');
  });

  it('keeps an optional zone on the candidate', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job, { timeZone: 'America/Los_Angeles' });
    expect(candidate.timeZone).toBe('America/Los_Angeles');
    await store.updateCandidate(candidate.id, { timeZone: 'nonsense' });
    expect(candidate.timeZone).toBe('');
  });
});

describe('closing dates', () => {
  it('stores a complete date and clears a blank one', async () => {
    const job = await store.addJob({ title: 'Engineer', closesOn: '2026-09-30' });
    expect(job.closesOn).toBe('2026-09-30');
    await store.updateJob(job.id, { closesOn: '' });
    expect(job.closesOn).toBeNull();
  });

  it('defaults to no deadline', async () => {
    expect((await store.addJob({ title: 'Engineer' })).closesOn).toBeNull();
  });

  it('refuses a half-typed date, on create and on update', async () => {
    await expect(store.addJob({ title: 'Engineer', closesOn: '2026-09' })).rejects.toThrow(/complete date/i);
    const job = await store.addJob({ title: 'Designer' });
    await expect(store.updateJob(job.id, { closesOn: 'soon' })).rejects.toThrow(/complete date/i);
    expect(job.closesOn).toBeNull();
  });
});

describe('screening questions', () => {
  it('normalizes a job\u2019s questions and drops the unusable ones', async () => {
    const job = await store.addJob({
      title: 'Rust Engineer',
      screeningQuestions: [
        { id: 'q1', label: '  Work authorization?  ', kind: 'yesno', required: true, mustHave: true },
        { id: 'q2', label: 'Pick one', kind: 'choice', options: [] },
        { id: '', label: 'No id' },
      ],
    });
    expect(job.screeningQuestions).toEqual([
      { id: 'q1', label: 'Work authorization?', kind: 'yesno', required: true, mustHave: true },
    ]);
  });

  it('stores null when a job asks nothing', async () => {
    const job = await store.addJob({ title: 'Designer' });
    expect(job.screeningQuestions).toBeNull();
  });

  it('replaces the question list on update, and clears it', async () => {
    const job = await store.addJob({ title: 'Designer', screeningQuestions: [{ id: 'q1', label: 'Portfolio password' }] });
    await store.updateJob(job.id, { screeningQuestions: [{ id: 'q2', label: 'Notice period', kind: 'short' }] });
    expect(job.screeningQuestions).toEqual([{ id: 'q2', label: 'Notice period', kind: 'short', required: false }]);
    await store.updateJob(job.id, { screeningQuestions: [] });
    expect(job.screeningQuestions).toBeNull();
  });

  it('snapshots answers onto the candidate, and survives the question being reworded', async () => {
    const job = await store.addJob({
      title: 'Rust Engineer',
      screeningQuestions: [{ id: 'q1', label: 'Work authorization?', kind: 'yesno', mustHave: true }],
    });
    const candidate = await store.addCandidate({
      name: 'Ada Lovelace',
      jobId: job.id,
      answers: [{ label: 'Work authorization?', answer: 'No' }, { label: 'Blank', answer: '' }],
    });
    expect(candidate.answers).toEqual([{ label: 'Work authorization?', answer: 'No' }]);
    await store.updateJob(job.id, { screeningQuestions: [{ id: 'q1', label: 'Authorized to work in the EU?', kind: 'yesno' }] });
    expect(store.state.candidates[0].answers).toEqual([{ label: 'Work authorization?', answer: 'No' }]);
  });

  it('carries answers through an import and leaves rows without them alone', async () => {
    const job = await store.addJob({ title: 'Rust Engineer' });
    await store.importCandidates(
      [
        { name: 'With answers', email: 'a@x.io', answers: [{ label: 'Notice period', answer: '2 months' }] },
        { name: 'Without', email: 'b@x.io' },
      ],
      { jobId: job.id }
    );
    expect(store.state.candidates[0].answers).toEqual([{ label: 'Notice period', answer: '2 months' }]);
    expect(store.state.candidates[1].answers).toBeUndefined();
  });
});

describe('candidates', () => {
  it('starts in Applied with a created event', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    expect(candidate.stage).toBe('applied');
    expect(candidate.status).toBe('active');
    expect(candidate.history).toHaveLength(1);
    expect(candidate.history[0].type).toBe('created');
  });

  it('requires an existing job', async () => {
    await expect(store.addCandidate({ name: 'X', jobId: 'nope' })).rejects.toThrow(/job not found/i);
  });

  it('moves through stages, recording history and stageChangedAt', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const before = candidate.stageChangedAt;
    await store.moveStage(candidate.id, 'screen');
    expect(candidate.stage).toBe('screen');
    expect(candidate.stageChangedAt > before).toBe(true);
    const event = candidate.history.at(-1);
    expect(event).toMatchObject({ type: 'stage', from: 'applied', to: 'screen' });
  });

  it('rejects unknown stages and moving an archived candidate', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(store.moveStage(candidate.id, 'limbo')).rejects.toThrow(/unknown stage/i);
    await store.rejectCandidate(candidate.id, { reason: 'Not a fit' });
    await expect(store.moveStage(candidate.id, 'screen')).rejects.toThrow(/restore/i);
  });

  it('advanceStage walks the pipeline and stops at the end', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.advanceStage(candidate.id);
    expect(candidate.stage).toBe('screen');
    await store.moveStage(candidate.id, 'hired');
    await expect(store.advanceStage(candidate.id)).rejects.toThrow(/final stage/i);
  });

  it('moves and advances through configured custom stages', async () => {
    await store.updateSettings({
      stages: [
        { key: 'applied', label: 'Applied' },
        { key: 'stg_take', label: 'Take-home' },
        { key: 'offer', label: 'Offer' },
        { key: 'hired', label: 'Hired' },
      ],
    });
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'stg_take');
    expect(candidate.stage).toBe('stg_take');
    // 'interview' was removed from the configured list, so it is unknown now.
    await expect(store.moveStage(candidate.id, 'interview')).rejects.toThrow(/unknown stage/i);
    await store.advanceStage(candidate.id);
    expect(candidate.stage).toBe('offer');
    await store.advanceStage(candidate.id);
    expect(candidate.stage).toBe('hired');
    // The hired anchor still starts the onboarding plan.
    expect(store.state.onboarding[candidate.id].tasks.length).toBeGreaterThan(0);
  });

  it('hiring creates the onboarding plan exactly once', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'hired');
    const plan = store.state.onboarding[candidate.id];
    expect(plan.tasks.length).toBeGreaterThan(0);
    await store.toggleOnboardingTask(candidate.id, plan.tasks[0].id);
    await store.moveStage(candidate.id, 'offer');
    await store.moveStage(candidate.id, 'hired');
    // Progress survives a bounce out of Hired and back.
    expect(store.state.onboarding[candidate.id].tasks[0].done).toBe(true);
  });

  it('bulk-moves only movable candidates, in one persist', async () => {
    const job = await seedJob();
    const a = await seedCandidate(job, { name: 'A' });
    const b = await seedCandidate(job, { name: 'B' });
    const c = await seedCandidate(job, { name: 'C', stage: 'screen' });
    const archived = await seedCandidate(job, { name: 'D' });
    await store.rejectCandidate(archived.id);

    await expect(store.moveCandidatesStage([a.id], 'limbo')).rejects.toThrow(/unknown stage/i);
    const moved = await store.moveCandidatesStage([a.id, b.id, c.id, archived.id, 'ghost'], 'screen');
    // c was already there, archived is not active, ghost does not exist.
    expect(moved).toBe(2);
    expect(a.stage).toBe('screen');
    expect(b.stage).toBe('screen');
    expect(archived.stage).toBe('applied');
  });

  it('bulk-move into hired starts onboarding plans', async () => {
    const job = await seedJob();
    const a = await seedCandidate(job, { name: 'A' });
    const b = await seedCandidate(job, { name: 'B' });
    await store.moveCandidatesStage([a.id, b.id], 'hired');
    expect(store.state.onboarding[a.id].tasks.length).toBeGreaterThan(0);
    expect(store.state.onboarding[b.id].tasks.length).toBeGreaterThan(0);
  });

  it('bulk-archives active candidates with one shared reason', async () => {
    const job = await seedJob();
    const a = await seedCandidate(job, { name: 'A' });
    const b = await seedCandidate(job, { name: 'B' });
    const gone = await seedCandidate(job, { name: 'C' });
    await store.rejectCandidate(gone.id);
    const affected = await store.rejectCandidates([a.id, b.id, gone.id], { reason: 'Role closed' });
    expect(affected.map((c) => c.name)).toEqual(['A', 'B']);
    expect(a.status).toBe('rejected');
    expect(a.history.at(-1)).toMatchObject({ type: 'rejected', reason: 'Role closed' });
    const withdrawn = await seedCandidate(job, { name: 'E' });
    await store.rejectCandidates([withdrawn.id], { withdrawn: true });
    expect(withdrawn.status).toBe('withdrawn');
  });

  it('talent pool: archived candidates join, keep their tags, and can leave', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(store.addToPool(candidate.id)).rejects.toThrow(/archived/i);
    await store.rejectCandidate(candidate.id);
    await store.addToPool(candidate.id, [' strong ', 'bad timing', '', 'strong']);
    // Membership is the pool record; the labels are the candidate's own,
    // so they stay readable if they are ever taken back off the shelf.
    expect(candidate.pool.tags).toBeUndefined();
    expect(candidate.tags).toEqual(['strong', 'bad timing']);
    expect(candidate.history.at(-1)).toMatchObject({ type: 'pool', action: 'added' });
    const addedAt = candidate.pool.addedAt;
    // Joining again keeps the join date, adds no second event, and adds to
    // the tags rather than replacing them.
    await store.addToPool(candidate.id, ['senior']);
    expect(candidate.pool).toEqual({ addedAt });
    expect(candidate.tags).toEqual(['strong', 'bad timing', 'senior']);
    expect(candidate.history.filter((e) => e.type === 'pool')).toHaveLength(1);
    await store.removeFromPool(candidate.id);
    expect(candidate.pool).toBeUndefined();
    // Leaving the pool is not losing your labels.
    expect(candidate.tags).toEqual(['strong', 'bad timing', 'senior']);
  });

  it('re-engages an archived candidate on a new job, records following along', async () => {
    const job = await seedJob();
    const other = await seedJob({ title: 'Platform Engineer' });
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'interview');
    await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await expect(store.reengageCandidate(candidate.id, other.id)).rejects.toThrow(/already in play/i);
    await store.rejectCandidate(candidate.id, { reason: 'Runner-up' });
    await store.reengageCandidate(candidate.id, other.id);
    expect(candidate).toMatchObject({ jobId: other.id, status: 'active', stage: 'applied' });
    expect(candidate.history.at(-1)).toMatchObject({ type: 'reengaged', from: job.id, to: other.id });
    expect(store.state.interviews[0].jobId).toBe(other.id);
  });

  it('re-engaging takes the abandoned candidacy’s open offer off the table', async () => {
    const job = await seedJob();
    const other = await seedJob({ title: 'Platform Engineer' });
    const candidate = await seedCandidate(job);
    const offer = await store.createOffer({ candidateId: candidate.id, salary: 120000, startDate: '2026-10-01' });
    await store.sendOffer(offer.id);
    await store.rejectCandidate(candidate.id, { reason: 'Took another role' });
    await store.reengageCandidate(candidate.id, other.id);

    // Otherwise the fresh candidacy inherits "Awaiting signature" on the
    // old role's terms, and the offer it is heading towards cannot be
    // drafted at all.
    expect(offer.status).toBe('withdrawn');
    expect(offer.resolvedAt).toBeTruthy();
    expect(candidate.history.some((e) => e.type === 'offer' && e.action === 'withdrawn')).toBe(true);
    const next = await store.createOffer({ candidateId: candidate.id, salary: 90000, startDate: '2026-11-01' });
    expect(next.jobId).toBe(other.id);
  });

  it('re-engaging drops the abandoned candidacy’s onboarding checklist', async () => {
    await store.updateSettings({
      onboardingTemplates: [
        { id: 'tpl_eng', name: 'Engineering onboarding', tasks: [{ title: 'Laptop' }, { title: 'Repo access' }], departments: ['Engineering'] },
        { id: 'tpl_sales', name: 'Sales onboarding', tasks: [{ title: 'CRM seat' }], departments: ['Sales'] },
      ],
    });
    const eng = await seedJob({ title: 'Engineer', department: 'Engineering' });
    const sales = await seedJob({ title: 'Account Executive', department: 'Sales' });
    const candidate = await seedCandidate(eng);
    await store.moveStage(candidate.id, 'hired');
    const first = store.state.onboarding[candidate.id];
    expect(first.templateName).toBe('Engineering onboarding');
    await store.toggleOnboardingTask(candidate.id, first.tasks[0].id, true);
    await store.rejectCandidate(candidate.id, { reason: 'Reneged' });
    await store.reengageCandidate(candidate.id, sales.id);
    expect(store.state.onboarding[candidate.id]).toBeUndefined();

    // Hiring them again stamps the template their new job points at,
    // rather than resurrecting the old role's half-ticked list.
    await store.moveStage(candidate.id, 'hired');
    const second = store.state.onboarding[candidate.id];
    expect(second.templateName).toBe('Sales onboarding');
    expect(second.tasks.map((t) => t.title)).toEqual(['CRM seat']);
    expect(second.tasks.every((t) => t.done === false)).toBe(true);
  });

  it('re-engaging leaves a resolved offer alone', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const offer = await store.createOffer({ candidateId: candidate.id, salary: 120000, startDate: '2026-10-01' });
    await store.sendOffer(offer.id);
    await store.declineOffer(offer.id);
    const resolvedAt = offer.resolvedAt;
    await store.rejectCandidate(candidate.id);
    await store.reengageCandidate(candidate.id, job.id);
    expect(offer).toMatchObject({ status: 'declined', resolvedAt });
  });

  it('reject and restore round-trip keeps the stage', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'interview');
    await store.rejectCandidate(candidate.id);
    expect(candidate.status).toBe('rejected');
    await store.restoreCandidate(candidate.id);
    expect(candidate.status).toBe('active');
    expect(candidate.stage).toBe('interview');
  });

  it('rejecting stamps stageChangedAt so the archive reflects when it happened', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'screen');
    const movedAt = candidate.stageChangedAt;
    await store.rejectCandidate(candidate.id, { reason: 'Not a fit' });
    expect(candidate.stageChangedAt > movedAt).toBe(true);
    expect(candidate.history.at(-1)).toMatchObject({ type: 'rejected', reason: 'Not a fit' });
  });

  it('moving a candidate to another job carries their records along', async () => {
    const jobA = await seedJob({ title: 'Job A' });
    const jobB = await seedJob({ title: 'Job B' });
    const candidate = await seedCandidate(jobA);
    await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.addScorecard({ candidateId: candidate.id, author: 'Grace', recommendation: 'yes' });
    await store.createOffer({ candidateId: candidate.id, salary: 90000, startDate: '2026-05-01' });

    await store.updateCandidate(candidate.id, { jobId: jobB.id });

    expect(candidate.jobId).toBe(jobB.id);
    expect(store.state.interviews[0].jobId).toBe(jobB.id);
    expect(store.state.scorecards[0].jobId).toBe(jobB.id);
    expect(store.state.offers[0].jobId).toBe(jobB.id);
    expect(candidate.history.at(-1)).toMatchObject({ type: 'job', from: jobA.id, to: jobB.id });
    expect(backend.peek('interviews')[0].jobId).toBe(jobB.id);
  });

  it('editing without a job change leaves history and records untouched', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const historyLength = candidate.history.length;
    await store.updateCandidate(candidate.id, { jobId: job.id, notes: 'Updated' });
    expect(candidate.history).toHaveLength(historyLength);
    expect(candidate.notes).toBe('Updated');
  });

  it('trims contact and text fields on update, like on creation', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.updateCandidate(candidate.id, { email: '  ada@example.com  ', phone: ' +44 20 1234 ', link: ' example.com ' });
    expect(candidate.email).toBe('ada@example.com');
    expect(candidate.phone).toBe('+44 20 1234');
    expect(candidate.link).toBe('example.com');
  });

  it('deleting a candidate removes their dependent records only', async () => {
    const job = await seedJob();
    const keep = await seedCandidate(job, { name: 'Keep Me' });
    const drop = await seedCandidate(job, { name: 'Drop Me' });
    await store.scheduleInterview({ candidateId: keep.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.scheduleInterview({ candidateId: drop.id, date: '2026-03-11', start: '10:00', end: '11:00' });
    await store.deleteCandidate(drop.id);
    expect(store.state.candidates.map((c) => c.name)).toEqual(['Keep Me']);
    expect(store.state.interviews).toHaveLength(1);
    expect(store.state.interviews[0].candidateId).toBe(keep.id);
  });
});

describe('interviews', () => {
  it('validates times before saving', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(
      store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '11:00', end: '10:00' })
    ).rejects.toThrow(/end time/i);
  });

  it('logs a timeline event on the candidate', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    expect(candidate.history.at(-1)).toMatchObject({ type: 'interview', date: '2026-03-10' });
  });

  it('refuses to schedule for an archived candidate, but leaves cleanup open', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const itv = await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.rejectCandidate(candidate.id);
    await expect(
      store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-12', start: '10:00', end: '11:00' })
    ).rejects.toThrow(/restore the candidate/i);
    // Existing interviews can still be corrected or removed.
    await store.updateInterview(itv.id, { date: '2026-03-11' });
    await store.deleteInterview(itv.id);
    expect(store.state.interviews).toHaveLength(0);
    await store.restoreCandidate(candidate.id);
    await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-12', start: '10:00', end: '11:00' });
    expect(store.state.interviews).toHaveLength(1);
  });

  it('deleting an interview keeps its scorecards, unlinked', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const itv = await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.addScorecard({ candidateId: candidate.id, interviewId: itv.id, author: 'Grace', recommendation: 'yes' });
    await store.deleteInterview(itv.id);
    expect(store.state.interviews).toHaveLength(0);
    expect(store.state.scorecards).toHaveLength(1);
    expect(store.state.scorecards[0].interviewId).toBeNull();
  });
});

describe('offers', () => {
  async function offerSetup() {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const offer = await store.createOffer({ candidateId: candidate.id, salary: 95000, startDate: '2026-05-01' });
    return { job, candidate, offer };
  }

  it('allows only one open offer per candidate', async () => {
    const { candidate } = await offerSetup();
    await expect(
      store.createOffer({ candidateId: candidate.id, salary: 80000, startDate: '2026-06-01' })
    ).rejects.toThrow(/already has an open offer/i);
  });

  it('sending pulls an early-stage candidate into Offer', async () => {
    const { candidate, offer } = await offerSetup();
    expect(candidate.stage).toBe('applied');
    await store.sendOffer(offer.id);
    expect(offer.status).toBe('sent');
    expect(offer.sentAt).toBeTruthy();
    expect(candidate.stage).toBe('offer');
  });

  it('sending never drags a candidate back from a stage after Offer', async () => {
    await store.updateSettings({
      stages: [
        { key: 'applied', label: 'Applied' },
        { key: 'screen', label: 'Screening' },
        { key: 'offer', label: 'Offer' },
        { key: 'refs', label: 'References' },
        { key: 'hired', label: 'Hired' },
      ],
    });
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'refs');
    const offer = await store.createOffer({ candidateId: candidate.id, salary: 90000, startDate: '2026-06-01' });
    await store.sendOffer(offer.id);
    expect(offer.status).toBe('sent');
    expect(candidate.stage).toBe('refs');
    // No bogus regression event lands on the timeline either.
    expect(candidate.history.filter((e) => e.type === 'stage').at(-1)).toMatchObject({ from: 'applied', to: 'refs' });
  });

  it('signing records the signature and hires the candidate', async () => {
    const { candidate, offer } = await offerSetup();
    await store.sendOffer(offer.id);
    await store.signOffer(offer.id, '  Ada Lovelace ');
    expect(offer.status).toBe('signed');
    expect(offer.signerName).toBe('Ada Lovelace');
    expect(candidate.stage).toBe('hired');
    expect(store.state.onboarding[candidate.id]).toBeTruthy();
  });

  it('refuses to sign without a name or from the wrong state', async () => {
    const { offer } = await offerSetup();
    await expect(store.signOffer(offer.id, 'Ada')).rejects.toThrow(/cannot be signed/i);
    await store.sendOffer(offer.id);
    await expect(store.signOffer(offer.id, '   ')).rejects.toThrow(/full name/i);
  });

  it('only drafts are editable', async () => {
    const { offer } = await offerSetup();
    await store.updateOffer(offer.id, { salary: 99000 });
    expect(offer.salary).toBe(99000);
    await store.sendOffer(offer.id);
    await expect(store.updateOffer(offer.id, { salary: 50000 })).rejects.toThrow(/draft/i);
  });

  it('refuses to draft, send, or sign for an archived candidate', async () => {
    const { candidate, offer } = await offerSetup();
    await store.rejectCandidate(candidate.id);
    await expect(store.sendOffer(offer.id)).rejects.toThrow(/restore the candidate/i);
    await store.restoreCandidate(candidate.id);
    await store.sendOffer(offer.id);
    await store.rejectCandidate(candidate.id, { withdrawn: true });
    await expect(store.signOffer(offer.id, 'Ada Lovelace')).rejects.toThrow(/restore the candidate/i);
    expect(candidate.stage).not.toBe('hired');
    expect(store.state.onboarding[candidate.id]).toBeUndefined();
    // Closing out the offer remains possible: that is bookkeeping, not a move.
    await store.withdrawOffer(offer.id);
    expect(offer.status).toBe('withdrawn');
    await expect(
      store.createOffer({ candidateId: candidate.id, salary: 80000, startDate: '2026-06-01' })
    ).rejects.toThrow(/restore the candidate/i);
  });

  it('declined and withdrawn are terminal; sent offers cannot be deleted', async () => {
    const { offer } = await offerSetup();
    await store.sendOffer(offer.id);
    await expect(store.deleteOffer(offer.id)).rejects.toThrow(/withdraw/i);
    await store.declineOffer(offer.id);
    expect(offer.status).toBe('declined');
    await expect(store.sendOffer(offer.id)).rejects.toThrow(/cannot be sent/i);
    await store.deleteOffer(offer.id);
    expect(store.state.offers).toHaveLength(0);
  });
});

describe('scorecards', () => {
  it('validates the recommendation and author', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(
      store.addScorecard({ candidateId: candidate.id, author: '', recommendation: 'yes' })
    ).rejects.toThrow(/reviewer/i);
    await expect(
      store.addScorecard({ candidateId: candidate.id, author: 'Grace', recommendation: 'maybe' })
    ).rejects.toThrow(/recommendation/i);
  });

  it('stores ratings and logs the event', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const sc = await store.addScorecard({
      candidateId: candidate.id,
      author: 'Grace',
      recommendation: 'strong_yes',
      ratings: { skills: 5 },
    });
    expect(sc.jobId).toBe(job.id);
    expect(candidate.history.at(-1)).toMatchObject({ type: 'scorecard', author: 'Grace' });
  });

  it('snapshots the job rubric on new scorecards; default rubric stays implicit', async () => {
    const rubric = [{ key: 'dim_product', label: 'Product sense' }];
    const job = await seedJob({ ratingFields: rubric });
    const candidate = await seedCandidate(job);
    const sc = await store.addScorecard({
      candidateId: candidate.id,
      author: 'Grace',
      recommendation: 'yes',
      ratings: { dim_product: 4 },
    });
    expect(sc.fields).toEqual(rubric);

    const plain = await seedJob({ title: 'Backend Engineer' });
    const other = await seedCandidate(plain, { name: 'Grace Hopper' });
    const sc2 = await store.addScorecard({ candidateId: other.id, author: 'Ada', recommendation: 'yes' });
    expect(sc2.fields).toBeUndefined();
  });

  it('normalizes job rubric edits and clears an emptied rubric to the default', async () => {
    const job = await seedJob();
    await store.updateJob(job.id, {
      ratingFields: [
        { key: 'dim_a', label: '  Craft  ' },
        { key: 'bad key!', label: 'Nope' },
      ],
    });
    expect(job.ratingFields).toEqual([{ key: 'dim_a', label: 'Craft' }]);
    await store.updateJob(job.id, { ratingFields: [] });
    expect(job.ratingFields).toBeNull();
  });
});

describe('onboarding tasks', () => {
  it('toggles, adds, and removes tasks', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job, { stage: 'hired' });
    const plan = store.state.onboarding[candidate.id];
    const first = plan.tasks[0];
    await store.toggleOnboardingTask(candidate.id, first.id);
    expect(first.done).toBe(true);
    const task = await store.addOnboardingTask(candidate.id, 'Order business cards');
    expect(plan.tasks).toContain(task);
    await store.removeOnboardingTask(candidate.id, task.id);
    expect(plan.tasks).not.toContain(task);
  });

  it('throws for a candidate without a plan', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(store.toggleOnboardingTask(candidate.id, 'x')).rejects.toThrow(/no onboarding plan/i);
  });
});

describe('follow-ups', () => {
  it('adds, toggles, and deletes follow-ups with validation', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(store.addFollowup(candidate.id, { text: '  ', dueDate: '2026-03-12' })).rejects.toThrow(/describe/i);
    await expect(store.addFollowup(candidate.id, { text: 'Call', dueDate: 'soon' })).rejects.toThrow(/due date/i);
    const followup = await store.addFollowup(candidate.id, { text: '  Call about take-home  ', dueDate: '2026-03-12', dueTime: '14:00' });
    expect(followup).toMatchObject({ text: 'Call about take-home', dueDate: '2026-03-12', dueTime: '14:00', done: false });
    await store.toggleFollowup(candidate.id, followup.id);
    expect(followup.done).toBe(true);
    expect(followup.completedAt).toBeTruthy();
    await store.toggleFollowup(candidate.id, followup.id);
    expect(followup).toMatchObject({ done: false, completedAt: null });
    await store.deleteFollowup(candidate.id, followup.id);
    expect(candidate.followups).toHaveLength(0);
    await expect(store.deleteFollowup(candidate.id, followup.id)).rejects.toThrow(/not found/i);
  });
});

describe('onboarding templates', () => {
  const sales = {
    id: 'sales',
    name: 'Sales onboarding',
    tasks: [
      { title: 'CRM access', category: 'IT & access', offsetDays: -2 },
      { title: 'Territory handover', category: 'Team' },
    ],
    jobIds: [],
    departments: ['Go-to-market'],
  };

  it('stamps the template that matches the hire\u2019s job', async () => {
    await store.updateSettings({ onboardingTemplates: [sales] });
    const job = await store.addJob({ title: 'Account Executive', department: 'Go-to-market' });
    const candidate = await store.addCandidate({ name: 'Ada', jobId: job.id });
    await store.moveStage(candidate.id, 'hired');
    const plan = store.state.onboarding[candidate.id];
    expect(plan.templateName).toBe('Sales onboarding');
    expect(plan.tasks.map((t) => t.title)).toEqual(['CRM access', 'Territory handover']);
    expect(plan.tasks[0].offsetDays).toBe(-2);
    expect(plan.tasks[1].offsetDays).toBeUndefined();
  });

  it('falls back to the shipped checklist when no template matches', async () => {
    await store.updateSettings({ onboardingTemplates: [{ ...sales, departments: ['Sales'] }] });
    const job = await store.addJob({ title: 'Engineer', department: 'Engineering' });
    const candidate = await store.addCandidate({ name: 'Grace', jobId: job.id, stage: 'hired' });
    // No general template, so the first one stands — that is the rule
    // templateForJob states, and the plan is never empty.
    expect(store.state.onboarding[candidate.id].tasks.length).toBeGreaterThan(0);
  });

  it('never rewrites a plan a hire already has', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'hired');
    const before = store.state.onboarding[candidate.id];
    await store.updateSettings({ onboardingTemplates: [sales] });
    await store.moveStage(candidate.id, 'offer');
    await store.moveStage(candidate.id, 'hired');
    expect(store.state.onboarding[candidate.id]).toBe(before);
    expect(store.state.onboarding[candidate.id].templateName).toBe('Standard onboarding');
  });
});

describe('interview guides', () => {
  const GUIDE = {
    id: 'gd1',
    name: 'Phone screen',
    questions: [{ id: 'q1', text: 'Walk me through your last project', field: 'skills' }],
    types: ['phone'],
    stages: [],
  };

  it('attaches a guide to an interview, and only a real one', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.updateSettings({ guides: [GUIDE] });
    const itv = await store.scheduleInterview({
      candidateId: candidate.id,
      date: '2026-03-10',
      start: '10:00',
      end: '11:00',
      guideId: 'gd1',
    });
    expect(itv.guideId).toBe('gd1');
    const none = await store.scheduleInterview({
      candidateId: candidate.id,
      date: '2026-03-11',
      start: '10:00',
      end: '11:00',
      guideId: 'gd_nope',
    });
    expect(none.guideId).toBe('');
    await store.updateInterview(itv.id, { guideId: '' });
    expect(itv.guideId).toBe('');
  });

  it('snapshots the questions and answers onto the scorecard', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.updateSettings({ guides: [GUIDE] });
    const scorecard = await store.addScorecard({
      candidateId: candidate.id,
      author: 'Lena',
      recommendation: 'yes',
      guideName: 'Phone screen',
      guideAnswers: [
        { question: 'Walk me through your last project', field: 'skills', answer: 'Billing rewrite, end to end.' },
        { question: 'Unanswered', field: '', answer: '' },
      ],
    });
    expect(scorecard.guideName).toBe('Phone screen');
    expect(scorecard.guideAnswers).toEqual([
      { question: 'Walk me through your last project', field: 'skills', answer: 'Billing rewrite, end to end.' },
    ]);
    // Rewriting the guide leaves written feedback exactly as it was.
    await store.updateSettings({ guides: [{ ...GUIDE, questions: [{ id: 'q1', text: 'Something else entirely' }] }] });
    expect(store.state.scorecards[0].guideAnswers[0].question).toBe('Walk me through your last project');
  });

  it('keeps a scorecard with no guide free of guide fields', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const scorecard = await store.addScorecard({ candidateId: candidate.id, author: 'Lena', recommendation: 'yes' });
    expect(scorecard.guideAnswers).toBeUndefined();
    expect(scorecard.guideName).toBeUndefined();
  });
});

describe('tags', () => {
  it('sets, replaces, and cleans a candidate\u2019s tags', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.setCandidateTags(candidate.id, [' Senior ', 'senior', 'Rust', '']);
    expect(candidate.tags).toEqual(['Senior', 'Rust']);
    await store.setCandidateTags(candidate.id, []);
    expect(candidate.tags).toEqual([]);
  });

  it('accepts tags at creation, on any stage or status', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job, { tags: ['referred by Ada'] });
    expect(candidate.tags).toEqual(['referred by Ada']);
    await store.rejectCandidate(candidate.id);
    await store.setCandidateTags(candidate.id, ['silver medalist']);
    expect(candidate.tags).toEqual(['silver medalist']);
  });

  it('says when the cap bites instead of dropping the tail', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`);
    await expect(store.setCandidateTags(candidate.id, many)).rejects.toThrow(/up to 12 tags/i);
    expect(candidate.tags).toEqual([]);
  });

  it('consolidates the labels an old pool entry carried on first write', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.rejectCandidate(candidate.id);
    await store.addToPool(candidate.id, ['strong']);
    // Simulate a record written before tags moved onto the candidate.
    candidate.tags = [];
    candidate.pool.tags = ['strong', 'bad timing'];
    await store.setCandidateTags(candidate.id, ['strong']);
    expect(candidate.tags).toEqual(['strong']);
    expect(candidate.pool.tags).toBeUndefined();
  });

  it('adds and removes across a selection in one pass', async () => {
    const job = await seedJob();
    const a = await seedCandidate(job, { name: 'Ada', tags: ['to screen'] });
    const b = await seedCandidate(job, { name: 'Grace', tags: ['to screen', 'senior'] });
    const { changed } = await store.tagCandidates([a.id, b.id, 'cnd_missing'], { add: ['screened'], remove: ['to screen'] });
    expect(changed).toBe(2);
    expect(a.tags).toEqual(['screened']);
    expect(b.tags).toEqual(['senior', 'screened']);
    // Nothing to do is not an error, and writes nothing.
    expect(await store.tagCandidates([a.id], { add: ['screened'] })).toEqual({ changed: 0, atCapacity: 0 });
    expect(await store.tagCandidates([a.id], {})).toEqual({ changed: 0, atCapacity: 0 });
  });

  it('reports the candidates a bulk tag could not fit', async () => {
    const job = await seedJob();
    const full = await seedCandidate(job, { name: 'Ada', tags: Array.from({ length: MAX_TAGS }, (_, i) => `tag${i}`) });
    const room = await seedCandidate(job, { name: 'Grace', tags: ['senior'] });
    // The cap drops the tail silently, so the count is the only way the
    // bulk bar can avoid claiming a tag it never applied.
    const result = await store.tagCandidates([full.id, room.id], { add: ['screened'] });
    expect(result).toEqual({ changed: 1, atCapacity: 1 });
    expect(full.tags).toHaveLength(MAX_TAGS);
    expect(full.tags).not.toContain('screened');
    expect(room.tags).toEqual(['senior', 'screened']);
    // Making room in the same pass is not "at capacity".
    expect(await store.tagCandidates([full.id], { add: ['screened'], remove: ['tag0'] })).toEqual({
      changed: 1,
      atCapacity: 0,
    });
    expect(full.tags).toContain('screened');
  });
});

describe('logged emails', () => {
  it('records a draft, then lets the user confirm it went out', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const event = await store.logEmail(candidate.id, { template: 'invite', subject: 'Interview with Acme' });
    expect(event).toMatchObject({ type: 'email', template: 'invite', subject: 'Interview with Acme', sent: false });
    expect(event.at).toBeTruthy();
    await store.markEmailSent(candidate.id, event.id);
    const stored = candidate.history.at(-1);
    expect(stored.sent).toBe(true);
    expect(stored.sentAt).toBeTruthy();
    // Confirming twice is a no-op, not an error.
    await store.markEmailSent(candidate.id, event.id);
    expect(candidate.history.filter((e) => e.type === 'email')).toHaveLength(1);
  });

  it('refuses to confirm something that is not on the timeline', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(store.markEmailSent(candidate.id, 'evt_nope')).rejects.toThrow(/not on the timeline/i);
  });

  it('confirms a whole batch in one pass, skipping what it cannot', async () => {
    const job = await seedJob();
    const a = await seedCandidate(job, { name: 'Ada' });
    const b = await seedCandidate(job, { name: 'Grace' });
    const first = await store.logEmail(a.id, { template: 'reject', subject: 'Your application' });
    const second = await store.logEmail(b.id, { template: 'reject', subject: 'Your application' });
    const marked = await store.markEmailsSent([
      { candidateId: a.id, eventId: first.id },
      { candidateId: b.id, eventId: second.id },
      { candidateId: b.id, eventId: 'evt_missing' },
      { candidateId: 'cnd_missing', eventId: first.id },
    ]);
    expect(marked).toBe(2);
    expect(a.history.at(-1).sent).toBe(true);
    expect(b.history.at(-1).sent).toBe(true);
  });

  it('keeps the subject short enough to render', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const event = await store.logEmail(candidate.id, { subject: 'x'.repeat(500) });
    expect(event.subject).toHaveLength(300);
  });
});

describe('timeline notes', () => {
  it('appends trimmed notes to history', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const note = await store.addCandidateNote(candidate.id, '  Left a voicemail  ');
    expect(note).toMatchObject({ type: 'note', text: 'Left a voicemail' });
    expect(note.id).toBeTruthy();
    expect(candidate.history.at(-1)).toBe(note);
  });

  it('rejects empty notes and caps length', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(store.addCandidateNote(candidate.id, '   ')).rejects.toThrow(/needs some text/i);
    const long = await store.addCandidateNote(candidate.id, 'x'.repeat(2000));
    expect(long.text.length).toBe(1000);
  });

  it('deletes only the targeted note, never system events', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.moveStage(candidate.id, 'screen');
    const note = await store.addCandidateNote(candidate.id, 'Asked for a week');
    const before = candidate.history.length;
    await store.deleteCandidateNote(candidate.id, note.id);
    expect(candidate.history).toHaveLength(before - 1);
    expect(candidate.history.some((e) => e.type === 'stage')).toBe(true);
    await expect(store.deleteCandidateNote(candidate.id, 'nope')).rejects.toThrow(/not found/i);
  });

  it('notes survive stage moves and archive round-trips', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.addCandidateNote(candidate.id, 'Strong referral');
    await store.rejectCandidate(candidate.id);
    await store.restoreCandidate(candidate.id);
    expect(candidate.history.filter((e) => e.type === 'note')).toHaveLength(1);
  });
});

describe('attachments', () => {
  it('sanitizes file names', () => {
    expect(sanitizeFileName('resume.pdf')).toBe('resume.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\docs\\cv final.pdf')).toBe('cv final.pdf');
    expect(sanitizeFileName('a\u0000b.pdf')).toBe('ab.pdf');
    expect(sanitizeFileName('')).toBe('file');
    expect(sanitizeFileName('x'.repeat(200)).length).toBe(80);
  });

  it('is idempotent even when the length cut lands on a space', () => {
    // restoreBackup re-sanitizes stored names and the file path is built
    // from the name: a second pass that trims a space the 80-char cut
    // exposed would rename the attachment and orphan its file.
    const name = `${'a'.repeat(79)} b c.pdf`;
    const once = sanitizeFileName(name);
    expect(sanitizeFileName(once)).toBe(once);
    expect(once.endsWith(' ')).toBe(false);
  });

  it('uploads the file first, then records metadata', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const att = await store.addAttachment(candidate.id, { name: 'resume.pdf', type: 'application/pdf', size: 1234, data: 'PDFDATA' });
    expect(candidate.attachments).toHaveLength(1);
    expect(att).toMatchObject({ name: 'resume.pdf', size: 1234 });
    expect(backend.peekFile(`hiring-data/attachments/${candidate.id}/${att.id}-resume.pdf`)).toBe('PDFDATA');
    expect(candidate.history.at(-1)).toMatchObject({ type: 'attachment', name: 'resume.pdf' });
    const blob = await store.readAttachment(candidate.id, att.id);
    expect(blob).toBe('PDFDATA');
  });

  it('rejects oversized, empty, and over-count uploads', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await expect(
      store.addAttachment(candidate.id, { name: 'big.zip', size: MAX_ATTACHMENT_BYTES + 1, data: 'x' })
    ).rejects.toThrow(/capped/i);
    await expect(store.addAttachment(candidate.id, { name: 'x', size: 0, data: '' })).rejects.toThrow(/empty/i);
    expect(candidate.attachments ?? []).toHaveLength(0);
    expect(backend.filePaths()).toHaveLength(0);
  });

  it('deletes the file with the metadata, tolerating an already-missing file', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const att = await store.addAttachment(candidate.id, { name: 'cv.pdf', size: 10, data: 'DATA' });
    await store.deleteAttachment(candidate.id, att.id);
    expect(candidate.attachments).toHaveLength(0);
    expect(backend.filePaths()).toHaveLength(0);

    const again = await store.addAttachment(candidate.id, { name: 'cv.pdf', size: 10, data: 'DATA' });
    await backend.deleteFile(`hiring-data/attachments/${candidate.id}/${again.id}-cv.pdf`);
    await store.deleteAttachment(candidate.id, again.id);
    expect(candidate.attachments).toHaveLength(0);
  });

  it('keeps attachment files when the record removal fails to save', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const att = await store.addAttachment(candidate.id, { name: 'cv.pdf', size: 10, data: 'DATA' });

    const save = backend.save;
    backend.save = async () => {
      throw new Error('offline');
    };
    await expect(store.deleteCandidate(candidate.id)).rejects.toThrow('offline');
    backend.save = save;

    // The save never happened, so a reload resurrects the record — its
    // file must still be there for it.
    expect(backend.peekFile(`hiring-data/attachments/${candidate.id}/${att.id}-cv.pdf`)).toBe('DATA');
  });

  it('does not resurrect an attachment deleted while another one uploads', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const first = await store.addAttachment(candidate.id, { name: 'old.pdf', size: 10, data: 'OLD' });

    // Hold the next file write open, as a large upload would.
    const write = backend.writeFile;
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    backend.writeFile = async (path, data) => {
      backend.writeFile = write;
      await gate;
      return write(path, data);
    };
    const uploading = store.addAttachment(candidate.id, { name: 'big.pdf', size: 20, data: 'BIG' });
    await store.deleteAttachment(candidate.id, first.id);
    release();
    await uploading;

    expect(candidate.attachments.map((a) => a.name)).toEqual(['big.pdf']);
    expect(backend.filePaths()).toHaveLength(1);
  });

  it('removes attachment files when the candidate or their job is deleted', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.addAttachment(candidate.id, { name: 'cv.pdf', size: 10, data: 'DATA' });
    await store.deleteCandidate(candidate.id);
    expect(backend.filePaths()).toHaveLength(0);

    const job2 = await seedJob({ title: 'Second' });
    const c2 = await seedCandidate(job2, { name: 'Two' });
    await store.addAttachment(c2.id, { name: 'cv.pdf', size: 10, data: 'DATA' });
    await store.deleteJob(job2.id);
    expect(backend.filePaths()).toHaveLength(0);
  });
});

describe('sample data and settings', () => {
  it('loadSampleData flags the dataset; wipe clears everything', async () => {
    await store.loadSampleData({
      jobs: [{ id: 'j1', title: 'X', status: 'open', createdAt: tick() }],
      candidates: [],
      settings: { companyName: 'Acme' },
    });
    expect(store.state.settings.sampleData).toBe(true);
    expect(store.state.settings.onboarded).toBe(true);
    expect(store.state.settings.companyName).toBe('Acme');
    expect(store.state.jobs).toHaveLength(1);

    await store.wipeSampleData();
    expect(store.state.jobs).toHaveLength(0);
    expect(store.state.settings.sampleData).toBe(false);
    expect(store.state.settings.companyName).toBe('');
  });

  it('wipe removes attachment files uploaded while exploring', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    await store.addAttachment(candidate.id, { name: 'cv.pdf', size: 10, data: 'DATA' });
    await store.wipeSampleData();
    expect(backend.filePaths()).toHaveLength(0);
  });

  it('persists settings across a reload', async () => {
    await store.updateSettings({ companyName: 'Initech' });
    const second = createStore(backend, { now: tick });
    await second.init();
    expect(second.state.settings.companyName).toBe('Initech');
  });

  it('notifies subscribers on every mutation', async () => {
    let calls = 0;
    store.subscribe(() => calls++);
    const job = await seedJob();
    await seedCandidate(job);
    expect(calls).toBe(2);
  });
});

describe('persist failure', () => {
  /** Make saves of the given collection reject until restored. */
  function breakSaves(collection, message) {
    const realSave = backend.save.bind(backend);
    backend.save = async (c, v) => {
      if (c === collection) throw new Error(message);
      return realSave(c, v);
    };
    return () => {
      backend.save = realSave;
    };
  }

  it('rolls the in-memory change back when the save is rejected', async () => {
    const job = await seedJob();
    const heal = breakSaves('candidates', 'The candidates data is too large to save.');
    await expect(seedCandidate(job)).rejects.toThrow(/too large/);
    // The rejected candidate must not survive in memory: the UI would
    // show a record that was never stored, and every later candidates
    // save would fail behind the same error, blaming innocent edits.
    expect(store.state.candidates).toHaveLength(0);
    // …and must not ride along with the next successful write.
    heal();
    await seedCandidate(job, { name: 'Grace Hopper' });
    expect(store.state.candidates.map((c) => c.name)).toEqual(['Grace Hopper']);
    expect(backend.peek('candidates').map((c) => c.name)).toEqual(['Grace Hopper']);
  });

  it('reverts a failed stage move instead of poisoning later saves', async () => {
    const job = await seedJob();
    const candidate = await seedCandidate(job);
    const heal = breakSaves('candidates', 'save rejected');
    await expect(store.moveStage(candidate.id, 'screen')).rejects.toThrow('save rejected');
    expect(store.state.candidates[0].stage).toBe('applied');
    heal();
    await store.updateCandidate(candidate.id, { phone: '123' });
    expect(backend.peek('candidates')[0]).toMatchObject({ stage: 'applied', phone: '123' });
  });

  it('reverts a failed settings change without losing the defaults', async () => {
    await store.updateSettings({ companyName: 'Initech' });
    const heal = breakSaves('settings', 'save rejected');
    await expect(store.updateSettings({ companyName: 'Globex' })).rejects.toThrow('save rejected');
    expect(store.state.settings.companyName).toBe('Initech');
    expect(store.state.settings.stages ?? null).not.toBe(undefined);
    heal();
  });
});
