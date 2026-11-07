import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createStore } from '../src/core/store.js';
import { createMemoryBackend, createPuterBackend } from '../src/core/backend.js';
import {
  buildBackup,
  candidateExport,
  candidatesCSV,
  guessColumn,
  interviewsCSV,
  IMPORT_FIELDS,
  looksLikeHeader,
  validateBackup,
} from '../src/core/transfer.js';
import { buildJobPageHtml } from '../src/core/jobpage.js';
import { groupTasks, onboardingProgress } from '../src/core/onboard.js';
import { parseCSV } from '../src/lib/csv.js';
import { dueFollowups } from '../src/core/followups.js';
import { quickFind } from '../src/core/search.js';

let store;
let backend;

beforeEach(async () => {
  backend = createMemoryBackend();
  store = createStore(backend);
  await store.init();
});

describe('importCandidates', () => {
  it('imports rows in one pass and reports skips with row numbers', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    await store.addCandidate({ name: 'Existing', jobId: job.id, email: 'taken@example.com' });

    const result = await store.importCandidates(
      [
        { name: 'Ada', email: 'ada@example.com', source: 'Referral' },
        { name: '', email: 'noname@example.com' },
        { name: 'Dupe', email: 'TAKEN@example.com' },
        { name: 'Batch Dupe', email: 'ada@example.com' },
        { name: 'Bob' },
      ],
      { jobId: job.id }
    );

    expect(result.added).toBe(2);
    expect(result.skipped).toEqual([
      { row: 2, reason: 'Missing name' },
      { row: 3, reason: 'Duplicate email (TAKEN@example.com)' },
      { row: 4, reason: 'Duplicate email (ada@example.com)' },
    ]);
    expect(store.state.candidates).toHaveLength(3);
    const ada = store.state.candidates.find((c) => c.name === 'Ada');
    expect(ada).toMatchObject({ stage: 'applied', status: 'active', source: 'Referral', jobId: job.id });
    expect(ada.history).toHaveLength(1);
  });

  it('reads the tags column the CSV export writes', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    // candidatesCSV joins them with "; ", and a hand-filled spreadsheet is
    // as likely to use commas; both are one list, cleaned like any other.
    await store.importCandidates(
      [
        { name: 'Ada', tags: 'senior; needs sponsorship' },
        { name: 'Grace', tags: 'Senior, senior , referred by Ada' },
        { name: 'Bob', tags: '  ' },
        { name: 'Lin', tags: ['strong'] },
      ],
      { jobId: job.id }
    );
    const byName = Object.fromEntries(store.state.candidates.map((c) => [c.name, c]));
    expect(byName.Ada.tags).toEqual(['senior', 'needs sponsorship']);
    // Case-insensitive dedupe, like every other way tags are written.
    expect(byName.Grace.tags).toEqual(['Senior', 'referred by Ada']);
    // Nothing to store beats storing an empty list on every row.
    expect(byName.Bob.tags).toBeUndefined();
    expect(byName.Lin.tags).toEqual(['strong']);
  });

  it('reports skips against the entry’s own source row when it carries one', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    // The CSV wizard passes the file line (header and blank lines shift
    // it); the report must echo that, not the entry's batch position.
    const result = await store.importCandidates(
      [
        { row: 2, name: 'Ada', email: 'ada@example.com' },
        { row: 4, name: '', email: 'noname@example.com' },
        { row: 7, name: 'Dupe', email: 'ada@example.com' },
      ],
      { jobId: job.id }
    );
    expect(result.added).toBe(1);
    expect(result.skipped).toEqual([
      { row: 4, reason: 'Missing name' },
      { row: 7, reason: 'Duplicate email (ada@example.com)' },
    ]);
  });

  it('rolls the batch back when the save is refused', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const save = backend.save;
    backend.save = async () => {
      throw new Error('too large');
    };
    await expect(store.importCandidates([{ name: 'Ada' }], { jobId: job.id })).rejects.toThrow('too large');
    backend.save = save;

    // The unsaved rows must not stay in memory: every later candidate
    // write would re-serialize them and fail with the same error.
    expect(store.state.candidates).toEqual([]);
    await store.addCandidate({ name: 'Bob', jobId: job.id });
    expect(store.state.candidates.map((c) => c.name)).toEqual(['Bob']);
  });

  it('tells subscribers about the rollback, even when storage is unreachable', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    let lastSeen = null;
    store.subscribe((s) => {
      lastSeen = s.candidates.length;
    });
    // Offline: the save fails and so does the reload persist falls back
    // on, which is the case where persist keeps the mutation in memory
    // and notifies with it. The batch rollback below has to be announced
    // too, or the views keep rendering rows the store no longer holds.
    backend.save = async () => {
      throw new Error('offline');
    };
    backend.load = async () => {
      throw new Error('offline');
    };
    await expect(store.importCandidates([{ name: 'Ada' }, { name: 'Bob' }], { jobId: job.id })).rejects.toThrow('offline');
    expect(store.state.candidates).toEqual([]);
    expect(lastSeen).toBe(0);
  });

  it('can keep duplicates when dedupe is off, and validates the job', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    await store.addCandidate({ name: 'Existing', jobId: job.id, email: 'a@b.com' });
    const result = await store.importCandidates([{ name: 'Again', email: 'a@b.com' }], { jobId: job.id, skipDuplicates: false });
    expect(result.added).toBe(1);
    await expect(store.importCandidates([{ name: 'X' }], { jobId: 'nope' })).rejects.toThrow(/job not found/i);
  });
});

describe('candidateExport', () => {
  it('bundles one person’s complete file and nobody else’s', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const ada = await store.addCandidate({ name: 'Ada', jobId: job.id, email: 'ada@x.io' });
    const bob = await store.addCandidate({ name: 'Bob', jobId: job.id });
    await store.scheduleInterview({ candidateId: ada.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.scheduleInterview({ candidateId: bob.id, date: '2026-03-11', start: '10:00', end: '11:00' });
    await store.addScorecard({ candidateId: ada.id, author: 'Grace', recommendation: 'yes' });
    await store.createOffer({ candidateId: ada.id, salary: 90000, startDate: '2026-06-01' });
    await store.moveStage(ada.id, 'hired');

    const payload = candidateExport(store.state, ada.id, new Date('2026-03-20T10:00:00Z'));
    expect(payload).toMatchObject({ app: 'hiring', kind: 'candidate', exportedAt: '2026-03-20T10:00:00.000Z' });
    expect(payload.candidate.name).toBe('Ada');
    expect(payload.candidate.history.length).toBeGreaterThan(1);
    expect(payload.job).toEqual({ id: job.id, title: 'Engineer' });
    expect(payload.interviews).toHaveLength(1);
    expect(payload.scorecards).toHaveLength(1);
    expect(payload.offers).toHaveLength(1);
    expect(payload.onboarding.tasks.length).toBeGreaterThan(0);

    expect(() => candidateExport(store.state, 'nope')).toThrow(/not found/i);
    const bobFile = candidateExport(store.state, bob.id);
    expect(bobFile.scorecards).toHaveLength(0);
    expect(bobFile.onboarding).toBeNull();
  });
});

describe('backup round trip', () => {
  it('export, wipe, restore leaves the store indistinguishable', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const candidate = await store.addCandidate({ name: 'Ada', jobId: job.id, email: 'ada@example.com' });
    await store.scheduleInterview({ candidateId: candidate.id, date: '2026-03-10', start: '10:00', end: '11:00' });
    await store.updateSettings({ companyName: 'Acme' });

    const backup = JSON.parse(JSON.stringify(buildBackup(store.state, new Date('2026-03-11T00:00:00Z'))));
    expect(validateBackup(backup)).toEqual([]);

    const second = createStore(createMemoryBackend());
    await second.init();
    await second.restoreBackup(backup);
    expect(second.state.jobs).toEqual(store.state.jobs);
    expect(second.state.candidates).toEqual(store.state.candidates);
    expect(second.state.interviews).toEqual(store.state.interviews);
    expect(second.state.settings.companyName).toBe('Acme');
    expect(second.state.settings.onboarded).toBe(true);
  });

  it('fills the optional fields views rely on when a sparse backup is restored', async () => {
    const sparse = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [{ id: 'c1', name: 'Ada', jobId: 'j1' }],
        interviews: [{ id: 'i1', candidateId: 'c1', jobId: 'j1', date: '2026-03-10', start: '10:00', end: '11:00' }],
        scorecards: [{ id: 's1', candidateId: 'c1' }],
        offers: [{ id: 'o1', candidateId: 'c1' }],
        onboarding: {},
        settings: {},
      },
    };
    expect(validateBackup(sparse)).toEqual([]);
    await store.restoreBackup(sparse);
    const [candidate] = store.state.candidates;
    expect(candidate.email).toBe('');
    // No status in the backup must not read as archived: undefined fails
    // isActive(), dropping the candidate off the board and into the
    // retention purge list.
    expect(candidate.status).toBe('active');
    expect(typeof candidate.createdAt).toBe('string');
    expect(typeof candidate.stageChangedAt).toBe('string');
    expect(candidate.history).toEqual([]);
    expect(store.state.interviews[0].interviewers).toEqual([]);
    expect(typeof store.state.jobs[0].createdAt).toBe('string');
    expect(typeof store.state.scorecards[0].createdAt).toBe('string');
    expect(typeof store.state.offers[0].createdAt).toBe('string');
  });

  it('normalizes status and coerces timestamp sort keys on restore', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer', createdAt: 1704067200000 }],
        candidates: [
          { id: 'c1', name: 'Ada', jobId: 'j1', status: 'shortlisted', createdAt: 1704067200000, stageChangedAt: 1704067200000 },
          { id: 'c2', name: 'Grace', jobId: 'j1', status: 'rejected' },
          { id: 'c3', name: 'Joan', jobId: 'j1', status: 'withdrawn' },
        ],
        interviews: [],
        scorecards: [{ id: 's1', candidateId: 'c1', createdAt: 1704067200000 }],
        offers: [{ id: 'o1', candidateId: 'c1', createdAt: 1704067200000 }],
        onboarding: {},
        settings: {},
      },
    };
    await store.restoreBackup(payload);
    const [ada, grace, joan] = store.state.candidates;
    // Unrecognized status lands on active (the only status write paths
    // start from); recognized archived statuses survive untouched.
    expect(ada.status).toBe('active');
    expect(grace.status).toBe('rejected');
    expect(joan.status).toBe('withdrawn');
    // Numeric epochs must come back as strings: the archive and list views
    // sort with localeCompare, which throws on numbers mid-render.
    expect(typeof ada.createdAt).toBe('string');
    expect(typeof ada.stageChangedAt).toBe('string');
    expect(typeof store.state.jobs[0].createdAt).toBe('string');
    expect(typeof store.state.scorecards[0].createdAt).toBe('string');
    expect(typeof store.state.offers[0].createdAt).toBe('string');
  });

  it('lands a restored job on a status the app can render and save', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [
          { id: 'j1', title: 'Engineer', status: 'archived' },
          { id: 'j2', title: 'Designer' },
          { id: 'j3', title: 'Analyst', status: 'closed' },
        ],
        candidates: [],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: {},
      },
    };
    await store.restoreBackup(payload);
    const [engineer, designer, analyst] = store.state.jobs;
    // Unknown and missing statuses land on 'draft' — a guess must never
    // put a role back on the public site by itself. Real ones survive.
    expect(engineer.status).toBe('draft');
    expect(designer.status).toBe('draft');
    expect(analyst.status).toBe('closed');
    // updateJob validates the merged record, so an unrecognized status
    // used to make every later edit of that job throw.
    await expect(store.updateJob('j1', { title: 'Engineer II' })).resolves.toMatchObject({
      title: 'Engineer II',
    });
  });

  it('coerces the titles, names, and phones views call string methods on', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        // Validation only checks these are present, not that they are text.
        jobs: [{ id: 'j1', title: 2026 }, { id: 'j2', title: 2027 }],
        candidates: [
          { id: 'c1', name: 4242, phone: 5551234, jobId: 'j1' },
          { id: 'c2', name: 4243, jobId: 'j1' },
        ],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: {},
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    const [ada, grace] = store.state.candidates;
    expect(ada.name).toBe('4242');
    expect(ada.phone).toBe('5551234');
    expect(grace.phone).toBe('');
    expect(store.state.jobs.map((j) => j.title)).toEqual(['2026', '2027']);
    // The render paths that used to throw on these: the board's search
    // box, the profile's tel: link, and quick find's job sort.
    expect(() => store.state.candidates.filter((c) => c.name.toLowerCase().includes('42'))).not.toThrow();
    expect(() => ada.phone.replace(/\s+/g, '')).not.toThrow();
    expect(() => quickFind(store.state, '202')).not.toThrow();
    expect(quickFind(store.state, '424').map((r) => r.title)).toEqual(['4242', '4243']);
  });

  it('coerces the company name the public page builders trim', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        // Spread over the default, so this replaces '' rather than
        // falling back to it — and Publish, Preview, and Unpublish all
        // call .trim() on whatever is here.
        settings: { companyName: null },
      },
    };
    await store.restoreBackup(payload);
    expect(store.state.settings.companyName).toBe('');
    expect(() => buildJobPageHtml(store.state.jobs[0], { companyName: store.state.settings.companyName })).not.toThrow();
  });

  it('normalizes onboarding plans so a malformed one cannot break every render', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [
          { id: 'c1', name: 'Ada', jobId: 'j1' },
          { id: 'c2', name: 'Grace', jobId: 'j1' },
        ],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {
          c1: null,
          c2: { startedAt: '2026-03-10T00:00:00Z', tasks: 'not-a-list' },
          // A list of the right shape holding an entry that is not a task:
          // onboardingProgress reads t.done off every one of them, and the
          // overview calls it for every plan on the default route.
          c3: { startedAt: '2026-03-10T00:00:00Z', tasks: [{ id: 't1', title: 'A', done: false }, null, 'oops'] },
        },
        settings: {},
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    expect(store.state.onboarding.c1).toBeUndefined();
    expect(store.state.onboarding.c2).toEqual({ startedAt: '2026-03-10T00:00:00Z', tasks: [] });
    expect(store.state.onboarding.c3.tasks).toEqual([{ id: 't1', title: 'A', done: false }]);
    for (const plan of Object.values(store.state.onboarding)) {
      expect(() => onboardingProgress(plan.tasks)).not.toThrow();
      expect(() => groupTasks(plan.tasks)).not.toThrow();
    }
  });

  it('normalizes follow-ups and pool membership so a malformed candidate cannot break every render', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [
          { id: 'c1', name: 'Ada', jobId: 'j1', followups: { oops: true }, pool: 'yes' },
          {
            id: 'c2',
            name: 'Grace',
            jobId: 'j1',
            status: 'rejected',
            followups: [null, { id: 'fu1', text: 'Call back', dueDate: '2026-03-10', dueTime: '', done: false }],
            pool: { addedAt: '2026-03-01T00:00:00Z', tags: 'not-a-list' },
          },
        ],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: {},
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    const [ada, grace] = store.state.candidates;
    expect(ada.followups).toBeUndefined();
    expect(ada.pool).toBeUndefined();
    expect(grace.followups).toEqual([{ id: 'fu1', text: 'Call back', dueDate: '2026-03-10', dueTime: '', done: false }]);
    // Membership only: labels live on the candidate now, and a
    // "not-a-list" of them leaves nothing behind.
    expect(grace.pool).toEqual({ addedAt: '2026-03-01T00:00:00Z' });
    expect(grace.tags).toEqual([]);
    // The render paths that iterate these must survive the restored data.
    expect(dueFollowups(store.state, new Date('2026-03-20T10:00:00Z'))).toHaveLength(1);
  });

  it('cleans up attachment files only for candidates the restore drops', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const kept = await store.addCandidate({ name: 'Kept', jobId: job.id });
    const dropped = await store.addCandidate({ name: 'Dropped', jobId: job.id });
    const keptAtt = await store.addAttachment(kept.id, { name: 'cv.pdf', size: 10, data: 'KEEP' });
    await store.addAttachment(dropped.id, { name: 'cv.pdf', size: 10, data: 'DROP' });

    const backup = buildBackup(store.state);
    const payload = JSON.parse(JSON.stringify(backup));
    payload.data.candidates = payload.data.candidates.filter((c) => c.id === kept.id);
    payload.data.interviews = [];
    payload.data.scorecards = [];
    payload.data.offers = [];
    await store.restoreBackup(payload);

    // The dropped candidate's files are unreachable and must not linger;
    // the surviving candidate's downloads keep working after a round-trip.
    expect(backend.filePaths()).toEqual([`hiring-data/attachments/${kept.id}/${keptAtt.id}-cv.pdf`]);
    expect(await store.readAttachment(kept.id, keptAtt.id)).toBe('KEEP');
  });

  it('refuses a restore that cannot be fully saved before touching storage or memory', async () => {
    const kv = new Map();
    const puter = {
      kv: {
        get: async (key) => kv.get(key) ?? null,
        set: vi.fn(async (key, value) => kv.set(key, value)),
        del: async (key) => kv.delete(key),
      },
    };
    const cloud = createStore(createPuterBackend(puter));
    await cloud.init();
    await cloud.addJob({ title: 'Existing' });
    puter.kv.set.mockClear();

    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'New' }],
        candidates: [{ id: 'c1', name: 'Ada', jobId: 'j1', notes: 'x'.repeat(400 * 1024) }],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: {},
      },
    };
    await expect(cloud.restoreBackup(payload)).rejects.toThrow(/too large/i);
    // Nothing was written and nothing replaced: the old dataset survives
    // in full instead of being half-swapped for the backup.
    expect(puter.kv.set).not.toHaveBeenCalled();
    expect(cloud.state.jobs.map((j) => j.title)).toEqual(['Existing']);
    expect(cloud.state.candidates).toEqual([]);
  });

  it('drops null history entries and null records so a restore cannot break every render', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [
          {
            id: 'c1',
            name: 'Ada',
            jobId: 'j1',
            history: [{ at: '2026-03-01T00:00:00Z', type: 'created', stage: 'applied' }, null, 'oops'],
          },
        ],
        interviews: [null, { id: 'i1', candidateId: 'c1', jobId: 'j1', date: '2026-03-10', start: '10:00', end: '11:00', type: 'video', interviewers: [] }],
        scorecards: [null],
        offers: [null],
        onboarding: {},
        settings: {},
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    expect(store.state.candidates[0].history).toEqual([{ at: '2026-03-01T00:00:00Z', type: 'created', stage: 'applied' }]);
    expect(store.state.interviews).toHaveLength(1);
    expect(store.state.scorecards).toEqual([]);
    expect(store.state.offers).toEqual([]);
  });

  it('normalizes screening questions and answers on restore', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [
          {
            id: 'j1',
            title: 'Engineer',
            closesOn: '2026-09',
            screeningQuestions: [
              { id: 'q1', label: ' Work authorization? ', kind: 'yesno', mustHave: true },
              { id: 'q2', label: 'Pick', kind: 'choice', options: [] },
              null,
            ],
          },
          { id: 'j2', title: 'Designer', screeningQuestions: 'nope', closesOn: '2026-09-30' },
        ],
        candidates: [
          { id: 'c1', name: 'Ada', jobId: 'j1', answers: [{ label: 'Work authorization?', answer: 'No' }, null, { label: '', answer: 'x' }] },
          { id: 'c2', name: 'Grace', jobId: 'j1', answers: 'nope' },
        ],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: {},
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    expect(store.state.jobs[0].screeningQuestions).toEqual([
      { id: 'q1', label: 'Work authorization?', kind: 'yesno', required: false, mustHave: true },
    ]);
    expect(store.state.jobs[1].screeningQuestions).toBeNull();
    // A half-date would be published as validThrough and would make every
    // later edit of the job throw on the merged record.
    expect(store.state.jobs[0].closesOn).toBeNull();
    expect(store.state.jobs[1].closesOn).toBe('2026-09-30');
    expect(store.state.candidates[0].answers).toEqual([{ label: 'Work authorization?', answer: 'No' }]);
    expect(store.state.candidates[1].answers).toBeUndefined();
  });

  it('lands restored candidates on a stage the configured pipeline contains', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [
          { id: 'c1', name: 'Ada', jobId: 'j1', stage: 'take-home' },
          { id: 'c2', name: 'Grace', jobId: 'j1', stage: 'ghost' },
          { id: 'c3', name: 'Lin', jobId: 'j1' },
        ],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: { stages: [{ key: 'take-home', label: 'Take-home' }] },
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    const [ada, grace, lin] = store.state.candidates;
    // A configured custom stage survives; an unknown or missing one would
    // leave the candidate on no board column, so it lands on 'applied'.
    expect(ada.stage).toBe('take-home');
    expect(grace.stage).toBe('applied');
    expect(lin.stage).toBe('applied');
  });

  it('rejects record ids that could escape the app’s storage paths', async () => {
    const base = {
      app: 'hiring',
      version: 1,
      data: { jobs: [], candidates: [], interviews: [], scorecards: [], offers: [], onboarding: {}, settings: {} },
    };
    const traversalJob = JSON.parse(JSON.stringify(base));
    traversalJob.data.jobs = [{ id: '../../pwned', title: 'Engineer' }];
    expect(validateBackup(traversalJob).join(' ')).toMatch(/job record is malformed/i);

    const traversalCandidate = JSON.parse(JSON.stringify(base));
    traversalCandidate.data.jobs = [{ id: 'j1', title: 'Engineer' }];
    traversalCandidate.data.candidates = [{ id: '../../../', name: 'Ada', jobId: 'j1' }];
    expect(validateBackup(traversalCandidate).join(' ')).toMatch(/candidate record is malformed/i);
    await expect(store.restoreBackup(traversalCandidate)).rejects.toThrow(/candidate record is malformed/i);
  });

  it('sanitizes restored attachment metadata and drops an unusable publish subdomain', async () => {
    const payload = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [{ id: 'j1', title: 'Engineer' }],
        candidates: [
          {
            id: 'c1',
            name: 'Ada',
            jobId: 'j1',
            attachments: [
              { id: 'att_ok', name: '../../etc/passwd', size: 10, at: '2026-03-10T00:00:00Z' },
              { id: '../evil', name: 'resume.pdf', size: 10, at: '2026-03-10T00:00:00Z' },
            ],
          },
        ],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: { publishSite: { subdomain: 'evil.com/#' } },
      },
    };
    expect(validateBackup(payload)).toEqual([]);
    await store.restoreBackup(payload);
    expect(store.state.candidates[0].attachments).toEqual([
      { id: 'att_ok', name: 'passwd', size: 10, at: '2026-03-10T00:00:00Z' },
    ]);
    expect(store.state.settings.publishSite).toBeUndefined();

    payload.data.settings = { publishSite: { subdomain: 'acme-jobs-ab12' } };
    await store.restoreBackup(payload);
    expect(store.state.settings.publishSite).toEqual({ subdomain: 'acme-jobs-ab12' });
  });

  it('keeps the account’s publish site when the backup predates publishing', async () => {
    await store.updateSettings({ publishSite: { subdomain: 'acme-jobs-ab12' } });
    const payload = {
      app: 'hiring',
      version: 1,
      data: { jobs: [], candidates: [], interviews: [], scorecards: [], offers: [], onboarding: {}, settings: {} },
    };
    await store.restoreBackup(payload);
    // The site is an account resource: dropping it would strand the live
    // pages and make the next publish reserve a second subdomain.
    expect(store.state.settings.publishSite).toEqual({ subdomain: 'acme-jobs-ab12' });

    payload.data.settings = { publishSite: { subdomain: 'evil.com/#' } };
    await store.restoreBackup(payload);
    expect(store.state.settings.publishSite).toEqual({ subdomain: 'acme-jobs-ab12' });
  });

  it('reports a null record as malformed instead of throwing', () => {
    const base = {
      app: 'hiring',
      version: 1,
      data: { jobs: [{ id: 'j1', title: 'Engineer' }], candidates: [], interviews: [], scorecards: [], offers: [], onboarding: {}, settings: {} },
    };
    const nullJob = JSON.parse(JSON.stringify(base));
    nullJob.data.jobs = [{ id: 'j1', title: 'Engineer' }, null];
    expect(validateBackup(nullJob).join(' ')).toMatch(/job record is malformed/i);

    const nullCandidate = JSON.parse(JSON.stringify(base));
    nullCandidate.data.candidates = [{ id: 'c1', name: 'Ada', jobId: 'j1' }, null];
    expect(validateBackup(nullCandidate).join(' ')).toMatch(/candidate record is malformed/i);
  });

  it('rejects malformed payloads with readable reasons', async () => {
    expect(validateBackup(null)).toHaveLength(1);
    expect(validateBackup({ app: 'other', version: 1, data: {} }).join(' ')).toMatch(/not exported by this app/i);
    expect(validateBackup({ app: 'hiring', version: 99, data: {} }).join(' ')).toMatch(/newer version/i);
    const missingJob = {
      app: 'hiring',
      version: 1,
      data: {
        jobs: [],
        candidates: [{ id: 'c1', name: 'Ada', jobId: 'ghost' }],
        interviews: [],
        scorecards: [],
        offers: [],
        onboarding: {},
        settings: {},
      },
    };
    expect(validateBackup(missingJob).join(' ')).toMatch(/references a job/i);
    await expect(store.restoreBackup(missingJob)).rejects.toThrow(/references a job/i);
  });
});

describe('CSV export and import helpers', () => {
  it('candidatesCSV resolves job titles and stage labels', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    await store.addCandidate({ name: 'Doe, Ada', jobId: job.id, stage: 'screen', notes: 'said "hi"' });
    const rows = parseCSV(candidatesCSV(store.state));
    expect(rows[0][0]).toBe('Name');
    expect(rows[1][0]).toBe('Doe, Ada');
    expect(rows[1][3]).toBe('Engineer');
    expect(rows[1][4]).toBe('Screening');
  });

  it('candidatesCSV carries the last contact, blank when there is none', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const written = await store.addCandidate({ name: 'Ada', jobId: job.id });
    await store.addCandidate({ name: 'Grace', jobId: job.id });
    const event = await store.logEmail(written.id, { template: 'invite', subject: 'Interview' });
    await store.setCandidateTags(written.id, ['senior', 'referred by Ada']);
    const rows = parseCSV(candidatesCSV(store.state));
    expect(rows[0].at(-1)).toBe('Last contacted');
    expect(rows[0].at(-3)).toBe('Tags');
    expect(rows[1].at(-1)).toBe(event.at);
    expect(rows[1].at(-3)).toBe('senior; referred by Ada');
    expect(rows[2].at(-1)).toBe('');
  });

  it('interviewsCSV names the clock and says what is only proposed', async () => {
    const job = await store.addJob({ title: 'Engineer' });
    const candidate = await store.addCandidate({ name: 'Ada', jobId: job.id });
    await store.scheduleInterview({
      candidateId: candidate.id,
      date: '2026-09-01',
      start: '10:00',
      end: '11:00',
      timeZone: 'Asia/Tokyo',
    });
    await store.proposeInterview({
      candidateId: candidate.id,
      slots: [
        { date: '2026-09-02', start: '10:00', end: '11:00' },
        { date: '2026-09-03', start: '10:00', end: '11:00' },
      ],
      timeZone: 'Europe/Berlin',
    });
    const rows = parseCSV(interviewsCSV(store.state));
    expect(rows[0].slice(0, 5)).toEqual(['Date', 'Start', 'End', 'Time zone', 'Status']);
    expect(rows[1].slice(0, 5)).toEqual(['2026-09-01', '10:00', '11:00', 'Asia/Tokyo', 'scheduled']);
    // The proposal exports at its earliest option, labelled for what it is.
    expect(rows[2].slice(0, 5)).toEqual(['2026-09-02', '10:00', '11:00', 'Europe/Berlin', 'proposed']);
    expect(rows[1][5]).toBe('Ada');
    expect(rows[1][6]).toBe('Engineer');
  });

  it('guessColumn and looksLikeHeader recognize common headers', () => {
    const headers = ['Full Name', 'E-mail Address', 'Telephone', 'Where from', 'LinkedIn URL', 'Comments', 'Tags'];
    const byKey = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, guessColumn(headers, f)]));
    expect(byKey.name).toBe(0);
    expect(byKey.email).toBe(1);
    expect(byKey.phone).toBe(2);
    expect(byKey.link).toBe(4);
    expect(byKey.notes).toBe(5);
    expect(byKey.tags).toBe(6);
    expect(looksLikeHeader(headers)).toBe(true);
    expect(looksLikeHeader(['Name', 'Email', 'Phone', 'Source', 'Notes'])).toBe(true);
    expect(looksLikeHeader(['Ada Lovelace', 'ada@example.com'])).toBe(false);
  });

  it('looksLikeHeader does not mistake candidate data for a header row', () => {
    // Substring matches used to classify these as headers, silently
    // dropping the first person from a headerless import.
    expect(looksLikeHeader(['Ada Lovelace', 'ada@example.com', 'https://linkedin.com/in/ada'])).toBe(false);
    expect(looksLikeHeader(['Bob Marley', 'bob@x.com', 'Sourced'])).toBe(false);
    expect(looksLikeHeader(['Jo Smith', 'left message on phone'])).toBe(false);
    expect(looksLikeHeader(['Jane Doe', 'jane@x.com', 'https://gracehopper.dev'])).toBe(false);
  });
});
