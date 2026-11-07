/**
 * Application store: holds all collections in memory, exposes actions that
 * mutate state, persists the affected collections through the backend
 * adapter, and notifies subscribers after every change.
 *
 * Collections:
 *   jobs        [{ id, title, department, location, type, workMode, status,
 *                  description, salaryMin, salaryMax, currency, createdAt,
 *                  closedAt, closesOn, screeningQuestions }]
 *   candidates  [{ id, name, email, phone, jobId, stage, status, source,
 *                  link, notes, tags, answers, createdAt, stageChangedAt,
 *                  history: [event] }]
 *   interviews  [{ id, candidateId, jobId, date, start, end, timeZone, type,
 *                  interviewers, location, meetingLink, notes, createdAt,
 *                  status: 'scheduled' | 'proposed', slots, proposedAt,
 *                  guideId }]
 *   scorecards  [{ id, candidateId, interviewId, jobId, author, ratings,
 *                  recommendation, notes, guideName, guideAnswers,
 *                  createdAt }]
 *   offers      [{ id, candidateId, jobId, salary, currency, bonus, equity,
 *                  startDate, expires, notes, status, sentAt, signedAt,
 *                  signerName, resolvedAt, createdAt }]
 *   onboarding  { candidateId: { startedAt, templateName,
 *                                 tasks: [{ id, title, category, offsetDays,
 *                                           done }] } }
 */
import { isSafeId, uid } from '../lib/id.js';
import { isMissingPathError } from './backend.js';
import { isValidStage, nextStage, stageIndex, STATUS } from './pipeline.js';
import { isProposed, normalizeSlots, validateInterview, validateSlots } from './interviews.js';
import { normalizeTimeZone } from '../lib/zones.js';
import { normalizeRatingFields, validateScorecard } from './scorecards.js';
import { normalizeAnswers, normalizeScreeningQuestions } from './screening.js';
import { canTransition, isOpenOffer, OFFER_STATUS, validateOffer } from './offers.js';
import { validateFollowup } from './followups.js';
import { buildOnboardingPlan, normalizeOnboardingTemplates, templateForJob } from './onboard.js';
import { buildBackup, validateBackup } from './transfer.js';
import { isFeedFile } from './feed.js';
import {
  isSnapshotName,
  prunable,
  SNAPSHOT_DIR,
  SNAPSHOT_INDEX,
  snapshotCounts,
  snapshotDue,
  snapshotName,
  sortSnapshots,
} from './snapshots.js';
import { candidateTags, MAX_TAGS, normalizeTags, tagKey } from './tags.js';
import { findGuide, normalizeGuideAnswers, normalizeGuides } from './guides.js';

const DATA_COLLECTIONS = ['jobs', 'candidates', 'interviews', 'scorecards', 'offers', 'onboarding'];
const COLLECTIONS = [...DATA_COLLECTIONS, 'settings'];

const DEFAULT_SETTINGS = { onboarded: false, sampleData: false, companyName: '', timeZone: '' };

export const JOB_STATUS = ['draft', 'open', 'closed'];
export const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship'];
export const WORK_MODES = ['Onsite', 'Hybrid', 'Remote'];
export const CANDIDATE_SOURCES = ['Job board', 'Referral', 'Sourced', 'Agency', 'Career page', 'Other'];

const ATTACHMENTS_DIR = 'hiring-data/attachments';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_CANDIDATE = 12;

/**
 * Strip directories and control characters; keep something readable.
 * Must be idempotent: restoreBackup re-sanitizes stored names, and the
 * attachment's file path is built from the name — a second pass that
 * changes anything (say, trimming a space the 80-char cut exposed)
 * orphans the file on disk.
 */
export function sanitizeFileName(name) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 80)
    .trim();
  return base || 'file';
}

/**
 * A job's closing date: '' and null mean "no deadline", anything else has
 * to be a complete date. It is published as the posting's `validThrough`,
 * which is what stops aggregators serving a stale role, so a half-typed
 * date must not be stored as one.
 */
function normalizeClosesOn(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('The closing date needs to be a complete date.');
  return text;
}

/** '' and null mean "not stated"; anything else must be a non-negative number. */
function normalizeSalary(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Salary must be a positive number.');
  }
  return amount;
}

export function createStore(backend, { now = () => new Date().toISOString(), snapshots = false } = {}) {
  const state = {
    jobs: [],
    candidates: [],
    interviews: [],
    scorecards: [],
    offers: [],
    onboarding: {},
    settings: { ...DEFAULT_SETTINGS },
    loaded: false,
  };

  const listeners = new Set();

  function notify() {
    for (const fn of listeners) fn(state);
  }

  /** What a collection holds before anything was ever written to it. */
  function emptyCollection(name) {
    if (name === 'onboarding') return {};
    if (name === 'settings') return { ...DEFAULT_SETTINGS };
    return [];
  }

  /**
   * Write the named collections to storage. Actions mutate state first
   * and persist after, so a rejected save must not leave the mutation in
   * memory: the UI would show a change that was never stored, a too-large
   * collection would wedge every later save behind the same error, and
   * the phantom change would silently ride along with the next successful
   * write. Reload the failed collections from storage — the last state
   * the user was truthfully shown as saved — then rethrow.
   */
  async function persist(...collections) {
    const results = await Promise.allSettled(collections.map((c) => backend.save(c, state[c])));
    const failure = results.find((r) => r.status === 'rejected');
    if (!failure) return;
    await Promise.all(
      collections.map(async (c, i) => {
        if (results[i].status !== 'rejected') return;
        try {
          const stored = await backend.load(c);
          state[c] = stored ?? emptyCollection(c);
          if (c === 'settings') state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
        } catch {
          // Storage is unreachable for reads too (offline). Keeping the
          // mutation in memory lets a later save retry it — the pre-fix
          // behavior, now confined to the case with no better option.
        }
      })
    );
    notify();
    throw failure.reason;
  }

  function requireJob(id) {
    const job = state.jobs.find((j) => j.id === id);
    if (!job) throw new Error('Job not found.');
    return job;
  }

  function requireCandidate(id) {
    const candidate = state.candidates.find((c) => c.id === id);
    if (!candidate) throw new Error('Candidate not found.');
    return candidate;
  }

  /** Offer moves drive the pipeline, so they need a candidate still on it. */
  function requireActiveCandidate(id, action) {
    const candidate = requireCandidate(id);
    if (candidate.status !== STATUS.ACTIVE) {
      throw new Error(`Restore the candidate before ${action}.`);
    }
    return candidate;
  }

  function requireOffer(id) {
    const offer = state.offers.find((o) => o.id === id);
    if (!offer) throw new Error('Offer not found.');
    return offer;
  }

  function assertValid(errors) {
    if (errors.length > 0) throw new Error(errors.join(' '));
  }

  /**
   * A plan for this candidate from the template their job points at. Never
   * called for a candidate who already has one: a plan in progress is
   * theirs, not the template's.
   */
  function planFor(candidate) {
    const job = state.jobs.find((j) => j.id === candidate.jobId);
    const template = templateForJob(state.settings, job);
    return { startedAt: now(), templateName: template.name, tasks: buildOnboardingPlan(template) };
  }

  function logEvent(candidate, event) {
    candidate.history = [...(candidate.history ?? []), { at: now(), ...event }];
  }

  /**
   * Move a candidate between stages (no persist — callers batch that).
   * Entering 'hired' creates the onboarding plan. Returns the collections
   * that changed.
   */
  function applyStageMove(candidate, stage) {
    if (!isValidStage(stage, state.settings)) throw new Error(`Unknown stage: ${stage}`);
    if (candidate.stage === stage) return [];
    logEvent(candidate, { type: 'stage', from: candidate.stage, to: stage });
    candidate.stage = stage;
    candidate.stageChangedAt = now();
    const touched = ['candidates'];
    if (stage === 'hired' && !state.onboarding[candidate.id]) {
      state.onboarding[candidate.id] = planFor(candidate);
      touched.push('onboarding');
    }
    return touched;
  }

  function attachmentPath(candidateId, attachment) {
    return `${ATTACHMENTS_DIR}/${candidateId}/${attachment.id}-${attachment.name}`;
  }

  /** Drop every record hanging off the given candidate ids (no persist). */
  function dropCandidateData(ids) {
    const gone = new Set(ids);
    state.candidates = state.candidates.filter((c) => !gone.has(c.id));
    state.interviews = state.interviews.filter((i) => !gone.has(i.candidateId));
    state.scorecards = state.scorecards.filter((s) => !gone.has(s.candidateId));
    state.offers = state.offers.filter((o) => !gone.has(o.candidateId));
    for (const id of gone) delete state.onboarding[id];
  }

  /**
   * Attachment file cleanup, only after the record removal is saved: a
   * failed save resurrects the records on reload, and records listing
   * files that no longer exist are unrecoverable — an orphaned file is
   * merely invisible. Best-effort: a failed directory delete must not
   * turn a completed removal into an error.
   */
  async function deleteAttachmentDirs(ids) {
    await Promise.all(ids.map((id) => backend.deleteDir(`${ATTACHMENTS_DIR}/${id}`).catch(() => {})));
  }

  /* ---- Snapshots -------------------------------------------------------
     Automatic copies of the whole dataset in the user's own drive. Off
     unless the app asks for them (tests build stores without them), and
     never allowed to interrupt the work in front of the user: a snapshot
     that cannot be written is a missing safety net, not a failed action. */

  async function readIndex() {
    try {
      const blob = await backend.readFile(SNAPSHOT_INDEX);
      const parsed = JSON.parse(typeof blob === 'string' ? blob : await blob.text());
      return Array.isArray(parsed?.snapshots) ? parsed.snapshots : [];
    } catch {
      // No index, or an unreadable one: the directory listing is the
      // source of truth for what exists, so carry on without the extras.
      return [];
    }
  }

  /** Take a snapshot now. Returns its entry, or null when disabled. */
  async function writeSnapshot(reason) {
    if (!snapshots || !backend.listDir) return null;
    const at = now();
    const payload = buildBackup(state, new Date(at));
    const name = snapshotName(at, reason);
    const body = JSON.stringify(payload);
    await backend.writeFile(`${SNAPSHOT_DIR}/${name}`, body);
    const entry = { name, at, reason, bytes: new TextEncoder().encode(body).length, counts: snapshotCounts(payload) };
    // Prune against what is really there — the listing already includes the
    // file just written — then record the survivors: an index that lists a
    // deleted file would offer a restore that 404s.
    const existing = await backend.listDir(SNAPSHOT_DIR).catch(() => []);
    const gone = prunable(existing.filter((e) => isSnapshotName(e.name)));
    await Promise.all(gone.map((old) => backend.deleteFile(`${SNAPSHOT_DIR}/${old}`).catch(() => {})));
    const index = [entry, ...(await readIndex()).filter((e) => e?.name !== name && !gone.includes(e?.name))];
    await backend.writeFile(SNAPSHOT_INDEX, JSON.stringify({ snapshots: index })).catch(() => {});
    return entry;
  }

  /**
   * A snapshot before something irreversible. Swallows its own failures —
   * refusing the wipe because the safety net could not be written would
   * leave the user unable to act at all.
   *
   * Only the purge is rate-limited, and only against itself: the
   * retention review walks deleteCandidate one record at a time, so
   * thirty deletions have to write one file rather than thirty. A wipe or
   * a restore is a single deliberate act that replaces the whole dataset,
   * and the dialog offering it says a copy is taken first ("so this is
   * reversible") — while one shared timer let a purge minutes earlier
   * swallow that copy, leaving everything done since with no recovery
   * point behind a promise that there was one.
   */
  const PURGE_GUARD_MS = 10 * 60 * 1000;
  let lastPurgeGuardAt = null;
  async function guardSnapshot(reason) {
    if (!snapshots || !backend.listDir) return;
    const stamp = new Date(now()).getTime();
    const loops = reason === 'purge';
    if (loops && lastPurgeGuardAt !== null && Number.isFinite(stamp) && stamp - lastPurgeGuardAt < PURGE_GUARD_MS) {
      return;
    }
    try {
      await writeSnapshot(reason);
      if (loops) lastPurgeGuardAt = stamp;
    } catch (err) {
      console.error('Snapshot before a destructive action failed', err);
    }
  }

  return {
    state,

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    async init() {
      const loaded = await Promise.all(COLLECTIONS.map((c) => backend.load(c)));
      COLLECTIONS.forEach((c, i) => {
        if (loaded[i] !== null && loaded[i] !== undefined) state[c] = loaded[i];
      });
      state.settings = { ...DEFAULT_SETTINGS, ...state.settings };
      state.loaded = true;
      notify();
    },

    // ---- Settings -------------------------------------------------------

    async updateSettings(patch) {
      state.settings = { ...state.settings, ...patch };
      await persist('settings');
      notify();
      return state.settings;
    },

    // ---- Jobs -----------------------------------------------------------

    async addJob({ title, department = '', location = '', type = 'Full-time', workMode = 'Onsite', description = '', salaryMin = null, salaryMax = null, currency = 'USD', status = 'open', ratingFields = null, screeningQuestions = null, closesOn = null }) {
      const trimmed = String(title ?? '').trim();
      if (!trimmed) throw new Error('A job title is required.');
      if (!JOB_STATUS.includes(status)) throw new Error(`Unknown job status: ${status}`);
      const lo = normalizeSalary(salaryMin);
      const hi = normalizeSalary(salaryMax);
      if (lo !== null && hi !== null && lo > hi) {
        throw new Error('The salary minimum is above the maximum.');
      }
      const job = {
        id: uid('job'),
        title: trimmed,
        department: String(department).trim(),
        location: String(location).trim(),
        type,
        workMode,
        description: String(description).trim(),
        salaryMin: lo,
        salaryMax: hi,
        currency,
        status,
        closesOn: normalizeClosesOn(closesOn),
        // null means "follow the default scorecard rubric".
        ratingFields: normalizeRatingFields(ratingFields),
        // What the public apply form asks beyond the standard fields;
        // null means "nothing extra".
        screeningQuestions: normalizeScreeningQuestions(screeningQuestions),
        createdAt: now(),
        closedAt: null,
      };
      state.jobs.push(job);
      await persist('jobs');
      notify();
      return job;
    },

    async updateJob(id, patch) {
      const job = requireJob(id);
      if (patch.title !== undefined && !String(patch.title).trim()) {
        throw new Error('A job title is required.');
      }
      const next = { ...job, ...patch };
      if (patch.title !== undefined) next.title = String(patch.title).trim();
      next.salaryMin = normalizeSalary(next.salaryMin);
      next.salaryMax = normalizeSalary(next.salaryMax);
      next.closesOn = normalizeClosesOn(next.closesOn);
      if (next.salaryMin !== null && next.salaryMax !== null && next.salaryMin > next.salaryMax) {
        throw new Error('The salary minimum is above the maximum.');
      }
      if (!JOB_STATUS.includes(next.status)) throw new Error(`Unknown job status: ${next.status}`);
      if (patch.ratingFields !== undefined) next.ratingFields = normalizeRatingFields(patch.ratingFields);
      if (patch.screeningQuestions !== undefined) {
        next.screeningQuestions = normalizeScreeningQuestions(patch.screeningQuestions);
      }
      next.closedAt = next.status === 'closed' ? (job.closedAt ?? now()) : null;
      Object.assign(job, next);
      await persist('jobs');
      notify();
      return job;
    },

    /** Removes the job and everything attached to it, candidates included. */
    async deleteJob(id) {
      requireJob(id);
      // A job takes its candidates with it: the biggest single-click loss
      // in the app.
      await guardSnapshot('purge');
      state.jobs = state.jobs.filter((j) => j.id !== id);
      const candidateIds = state.candidates.filter((c) => c.jobId === id).map((c) => c.id);
      dropCandidateData(candidateIds);
      await persist(...DATA_COLLECTIONS);
      await deleteAttachmentDirs(candidateIds);
      notify();
    },

    // ---- Candidates -----------------------------------------------------

    async addCandidate({ name, jobId, email = '', phone = '', source = '', link = '', notes = '', stage = 'applied', answers = null, timeZone = '', tags = [] }) {
      const trimmed = String(name ?? '').trim();
      if (!trimmed) throw new Error('A candidate name is required.');
      requireJob(jobId);
      if (!isValidStage(stage, state.settings)) throw new Error(`Unknown stage: ${stage}`);
      const cleanAnswers = normalizeAnswers(answers);
      const candidate = {
        id: uid('cnd'),
        name: trimmed,
        email: String(email).trim(),
        phone: String(phone).trim(),
        jobId,
        stage,
        status: STATUS.ACTIVE,
        source: String(source).trim(),
        link: String(link).trim(),
        notes: String(notes).trim(),
        // Where they are, so a proposed slot can be read on their clock.
        timeZone: normalizeTimeZone(timeZone),
        tags: normalizeTags(tags),
        // Screening answers are snapshotted (label + answer), so editing
        // the job's questions later never rewrites what was answered.
        ...(cleanAnswers ? { answers: cleanAnswers } : {}),
        createdAt: now(),
        stageChangedAt: now(),
        history: [{ at: now(), type: 'created', stage }],
      };
      state.candidates.push(candidate);
      const touched = ['candidates'];
      if (stage === 'hired') {
        state.onboarding[candidate.id] = planFor(candidate);
        touched.push('onboarding');
      }
      await persist(...touched);
      notify();
      return candidate;
    },

    async updateCandidate(id, patch) {
      const candidate = requireCandidate(id);
      if (patch.name !== undefined && !String(patch.name).trim()) {
        throw new Error('A candidate name is required.');
      }
      const touched = new Set(['candidates']);
      if (patch.jobId !== undefined && patch.jobId !== candidate.jobId) {
        requireJob(patch.jobId);
        // Interviews, scorecards, and offers carry a denormalized jobId;
        // they must follow the candidate or they stay on the old job.
        for (const collection of ['interviews', 'scorecards', 'offers']) {
          state[collection] = state[collection].map((record) => {
            if (record.candidateId !== id) return record;
            touched.add(collection);
            return { ...record, jobId: patch.jobId };
          });
        }
        logEvent(candidate, { type: 'job', from: candidate.jobId, to: patch.jobId });
      }
      // Store the same shape addCandidate does: contact and text fields
      // trimmed, so mailto/tel links and duplicate detection stay reliable.
      const cleaned = { ...patch };
      for (const key of ['name', 'email', 'phone', 'source', 'link', 'notes']) {
        if (cleaned[key] !== undefined) cleaned[key] = String(cleaned[key]).trim();
      }
      if (cleaned.timeZone !== undefined) cleaned.timeZone = normalizeTimeZone(cleaned.timeZone);
      if (cleaned.tags !== undefined) cleaned.tags = normalizeTags(cleaned.tags);
      Object.assign(candidate, cleaned);
      await persist(...touched);
      notify();
      return candidate;
    },

    async moveStage(id, stage) {
      const candidate = requireCandidate(id);
      if (candidate.status !== STATUS.ACTIVE) {
        throw new Error('Restore the candidate before moving them.');
      }
      const touched = applyStageMove(candidate, stage);
      if (touched.length > 0) {
        await persist(...touched);
        notify();
      }
      return candidate;
    },

    async advanceStage(id) {
      const candidate = requireCandidate(id);
      const next = nextStage(candidate.stage, state.settings);
      if (!next) throw new Error('Already at the final stage.');
      return this.moveStage(id, next);
    },

    /**
     * Move several active candidates to one stage in a single pass (one
     * persist, one notify). Unknown, archived, or already-there ids are
     * skipped. Returns how many actually moved.
     */
    async moveCandidatesStage(ids, stage) {
      if (!isValidStage(stage, state.settings)) throw new Error(`Unknown stage: ${stage}`);
      const touched = new Set();
      let moved = 0;
      for (const id of ids) {
        const candidate = state.candidates.find((c) => c.id === id);
        if (!candidate || candidate.status !== STATUS.ACTIVE || candidate.stage === stage) continue;
        for (const collection of applyStageMove(candidate, stage)) touched.add(collection);
        moved += 1;
      }
      if (touched.size > 0) {
        await persist(...touched);
        notify();
      }
      return moved;
    },

    /**
     * Archive several active candidates in a single pass (one persist,
     * one notify), with the same reason recorded on each timeline.
     * Returns the candidates that were archived.
     */
    async rejectCandidates(ids, { reason = '', withdrawn = false } = {}) {
      const affected = [];
      for (const id of ids) {
        const candidate = state.candidates.find((c) => c.id === id);
        if (!candidate || candidate.status !== STATUS.ACTIVE) continue;
        candidate.status = withdrawn ? STATUS.WITHDRAWN : STATUS.REJECTED;
        candidate.stageChangedAt = now();
        logEvent(candidate, { type: candidate.status, reason: String(reason).trim() });
        affected.push(candidate);
      }
      if (affected.length > 0) {
        await persist('candidates');
        notify();
      }
      return affected;
    },

    async rejectCandidate(id, { reason = '', withdrawn = false } = {}) {
      const candidate = requireCandidate(id);
      if (candidate.status !== STATUS.ACTIVE) throw new Error('Candidate is already closed.');
      candidate.status = withdrawn ? STATUS.WITHDRAWN : STATUS.REJECTED;
      // The archive sorts and labels by stageChangedAt ("Rejected · 2d ago");
      // stamp it like restoreCandidate does, or the label shows the last
      // stage move instead of when the candidate was actually archived.
      candidate.stageChangedAt = now();
      logEvent(candidate, { type: candidate.status, reason: String(reason).trim() });
      await persist('candidates');
      notify();
      return candidate;
    },

    async restoreCandidate(id) {
      const candidate = requireCandidate(id);
      if (candidate.status === STATUS.ACTIVE) return candidate;
      candidate.status = STATUS.ACTIVE;
      candidate.stageChangedAt = now();
      logEvent(candidate, { type: 'restored' });
      await persist('candidates');
      notify();
      return candidate;
    },

    // ---- Tags -------------------------------------------------------------

    /**
     * Replace a candidate's tags. Writing them also consolidates the ones
     * an old talent-pool entry carried, so a tag removed here does not
     * come back from `pool.tags` the next time it is read.
     */
    async setCandidateTags(id, tags) {
      const candidate = requireCandidate(id);
      // Say when the cap bites rather than silently dropping the tail and
      // letting the user find out the next time they look.
      const distinct = new Set((Array.isArray(tags) ? tags : []).map(tagKey).filter(Boolean)).size;
      if (distinct > MAX_TAGS) {
        throw new Error(`A candidate can carry up to ${MAX_TAGS} tags. Remove ${distinct - MAX_TAGS}.`);
      }
      candidate.tags = normalizeTags(tags);
      if (candidate.pool?.tags) delete candidate.pool.tags;
      await persist('candidates');
      notify();
      return candidate.tags;
    },

    /**
     * Add and remove tags across a selection in one pass. Used by the
     * board's bulk bar, where the whole point is not repeating yourself.
     *
     * Returns { changed, atCapacity }: how many records were rewritten,
     * and how many could not take every tag because they already carry
     * MAX_TAGS. normalizeTags caps the list, so without that second
     * number a candidate at the limit was skipped in silence while the
     * bulk bar reported the rest as done — the one-candidate path
     * (setCandidateTags) refuses out loud instead.
     */
    async tagCandidates(ids, { add = [], remove = [] } = {}) {
      const additions = normalizeTags(add);
      const removals = new Set(normalizeTags(remove).map(tagKey));
      if (additions.length === 0 && removals.size === 0) return { changed: 0, atCapacity: 0 };
      let changed = 0;
      let atCapacity = 0;
      for (const id of ids) {
        const candidate = state.candidates.find((c) => c.id === id);
        if (!candidate) continue;
        const before = candidateTags(candidate);
        const wanted = [...before.filter((t) => !removals.has(tagKey(t))), ...additions];
        if (new Set(wanted.map(tagKey).filter(Boolean)).size > MAX_TAGS) atCapacity += 1;
        const next = normalizeTags(wanted);
        if (next.join('\u0001') === before.join('\u0001') && !candidate.pool?.tags) continue;
        candidate.tags = next;
        if (candidate.pool?.tags) delete candidate.pool.tags;
        changed += 1;
      }
      if (changed > 0) {
        await persist('candidates');
        notify();
      }
      return { changed, atCapacity };
    },

    // ---- Talent pool ------------------------------------------------------

    /**
     * Mark an archived candidate as a talent-pool member (silver medalist
     * worth re-engaging later). Membership is the whole record now — the
     * labels that used to live in here are the candidate's own tags,
     * available in every stage instead of only in the pool.
     */
    async addToPool(id, tags = []) {
      const candidate = requireCandidate(id);
      if (!candidate.pool && candidate.status === STATUS.ACTIVE) {
        throw new Error('Only archived candidates join the talent pool.');
      }
      if (!candidate.pool) logEvent(candidate, { type: 'pool', action: 'added' });
      candidate.pool = { addedAt: candidate.pool?.addedAt ?? now() };
      const extra = normalizeTags(tags);
      if (extra.length > 0) candidate.tags = normalizeTags([...candidateTags(candidate), ...extra]);
      await persist('candidates');
      notify();
      return candidate;
    },

    async removeFromPool(id) {
      const candidate = requireCandidate(id);
      if (!candidate.pool) return candidate;
      delete candidate.pool;
      logEvent(candidate, { type: 'pool', action: 'removed' });
      await persist('candidates');
      notify();
      return candidate;
    },

    /**
     * Start a fresh candidacy for an archived candidate on another (or the
     * same) job: back to Applied, active again, full profile trail kept.
     * Interviews, scorecards, and offers follow the candidate like any
     * other job move, and the timeline records the re-engagement.
     */
    async reengageCandidate(id, jobId) {
      const candidate = requireCandidate(id);
      requireJob(jobId);
      if (candidate.status === STATUS.ACTIVE) {
        throw new Error('This candidate is already in play.');
      }
      const touched = new Set(['candidates']);
      // An offer still open when the candidacy was abandoned is not live
      // work on the new one — but it followed the candidate across, so the
      // profile announced "Awaiting signature" for a role they had just
      // been put back to Applied on, at the old role's salary; the overview
      // counted it, the expiry reminder nagged about it, and drafting the
      // offer this re-engagement is heading towards was refused with "this
      // candidate already has an open offer". Take it off the table, which
      // is what withdrawn means and what actually happened.
      for (const offer of state.offers) {
        if (offer.candidateId !== id || !isOpenOffer(offer)) continue;
        offer.status = OFFER_STATUS.WITHDRAWN;
        offer.resolvedAt = now();
        logEvent(candidate, { type: 'offer', action: OFFER_STATUS.WITHDRAWN });
        touched.add('offers');
      }
      // An onboarding checklist belongs to the candidacy that earned it.
      // It is hidden while the candidate is not hired, so dropping it
      // changes nothing on screen now — but hiring them again would have
      // reused it, because a plan is only stamped when there is none: the
      // new hire inherited half-ticked tasks from the previous role's
      // template, and the Onboarding view named that template beside
      // their new job. Clear it so the next hire is stamped from the
      // template their job actually points at.
      if (state.onboarding[id]) {
        delete state.onboarding[id];
        touched.add('onboarding');
      }
      if (jobId !== candidate.jobId) {
        for (const collection of ['interviews', 'scorecards', 'offers']) {
          state[collection] = state[collection].map((record) => {
            if (record.candidateId !== id) return record;
            touched.add(collection);
            return { ...record, jobId };
          });
        }
      }
      logEvent(candidate, { type: 'reengaged', from: candidate.jobId, to: jobId });
      candidate.jobId = jobId;
      candidate.status = STATUS.ACTIVE;
      candidate.stage = 'applied';
      candidate.stageChangedAt = now();
      await persist(...touched);
      notify();
      return candidate;
    },

    /** Removes the candidate and their interviews, scorecards, offers, and plan. */
    async deleteCandidate(id) {
      requireCandidate(id);
      // The retention purge walks this in a loop; the rate limit inside
      // means one recovery point for the run, not one per person.
      await guardSnapshot('purge');
      dropCandidateData([id]);
      await persist(...DATA_COLLECTIONS);
      await deleteAttachmentDirs([id]);
      notify();
    },

    // ---- Bulk import / backup --------------------------------------------

    /**
     * Import candidates in one pass (one persist, one notify). Rows without
     * a name are skipped; duplicate emails (against existing candidates and
     * within the batch) are skipped when `skipDuplicates` is on. Returns
     * { added, skipped: [{ row, reason }] }. Each entry may carry `row`,
     * the 1-based line it came from in the user's file (the CSV wizard
     * passes it so the skip report matches the spreadsheet, header row and
     * blank lines included); without it the entry's position stands in.
     */
    async importCandidates(entries, { jobId, skipDuplicates = true }) {
      requireJob(jobId);
      const seenEmails = new Set(
        state.candidates.map((c) => String(c.email ?? '').trim().toLowerCase()).filter(Boolean)
      );
      const added = [];
      const skipped = [];
      entries.forEach((entry, index) => {
        const row = entry.row ?? index + 1;
        const name = String(entry.name ?? '').trim();
        if (!name) {
          skipped.push({ row, reason: 'Missing name' });
          return;
        }
        const email = String(entry.email ?? '').trim();
        const emailKey = email.toLowerCase();
        if (skipDuplicates && emailKey && seenEmails.has(emailKey)) {
          skipped.push({ row, reason: `Duplicate email (${email})` });
          return;
        }
        if (emailKey) seenEmails.add(emailKey);
        const rowAnswers = normalizeAnswers(entry.answers);
        // A CSV cell holds them as text; candidatesCSV writes "a; b", and
        // a spreadsheet hand-filled by a recruiter is as likely to use
        // commas. Either separator, then the usual cleaning.
        const rowTags = normalizeTags(
          Array.isArray(entry.tags) ? entry.tags : String(entry.tags ?? '').split(/[;,]/)
        );
        added.push({
          id: uid('cnd'),
          name,
          email,
          phone: String(entry.phone ?? '').trim(),
          jobId,
          stage: 'applied',
          status: STATUS.ACTIVE,
          source: String(entry.source ?? '').trim(),
          link: String(entry.link ?? '').trim(),
          notes: String(entry.notes ?? '').trim(),
          ...(rowTags.length > 0 ? { tags: rowTags } : {}),
          ...(rowAnswers ? { answers: rowAnswers } : {}),
          createdAt: now(),
          stageChangedAt: now(),
          history: [{ at: now(), type: 'created', stage: 'applied' }],
        });
      });
      if (added.length > 0) {
        // A big import is the likeliest way to hit the storage size limit.
        // Roll the batch back when the save refuses it: leaving unsaved
        // rows in memory would make every later candidate write
        // re-serialize the same oversized array and fail with the same
        // error until the page is reloaded.
        const before = state.candidates;
        state.candidates = [...state.candidates, ...added];
        try {
          await persist('candidates');
        } catch (err) {
          state.candidates = before;
          // persist notifies before it rethrows, so the views have already
          // been handed a list with the new rows in it. Undoing that
          // silently left them on screen — clickable, and answering
          // "Candidate not found" — until some later change happened to
          // re-render. Announce the rollback that actually happened.
          notify();
          throw err;
        }
        notify();
      }
      return { added: added.length, skipped };
    },

    /** Replace every collection with a validated backup payload. */
    async restoreBackup(payload) {
      const problems = validateBackup(payload);
      if (problems.length > 0) throw new Error(problems.join(' '));
      // Everything currently here is about to be replaced — including by a
      // month-old file chosen by mistake, which is the case this exists for.
      await guardSnapshot('restore');
      const data = payload.data;
      // Validation guarantees ids, names, and job links — not every optional
      // field. Views sort on createdAt/stageChangedAt, search on email, and
      // join interviewers directly, so fill the gaps a hand-edited or older
      // backup may leave. Well-formed data passes through unchanged.
      const restoredAt = now();
      // Validation only checks that titles and names are present, not that
      // they are text. Every field below has a render path that calls a
      // string method on it straight, so a number from a hand-edited
      // backup takes that screen down: quick find sorts jobs with
      // title.localeCompare, the board's search box reads
      // name.toLowerCase, and the profile builds its tel: link with
      // phone.replace. Coerce them the way addJob/addCandidate store them.
      const jobs = data.jobs.map((j) => ({
        ...j,
        title: String(j.title),
        // Every write path keeps a job on one of the three statuses and the
        // whole UI branches on them, updateJob included: an unknown (or
        // missing) one renders an empty badge, hides the job from every
        // filter tab but "All", and makes the editor's Save fail forever
        // with "Unknown job status" — updateJob validates the merged
        // record, so the bad value poisons edits that never touched it.
        // Land on 'draft': it is the app's own "not live yet" state, so a
        // guess can never put a role back on the public site by itself.
        status: JOB_STATUS.includes(j.status) ? j.status : 'draft',
        // The public apply form renders these and the profile reads
        // answers against them, so restore them in the shape addJob
        // stores: known kinds, safe ids, choices with options.
        screeningQuestions: normalizeScreeningQuestions(j.screeningQuestions),
        // Published as validThrough and rendered on the public page; a
        // half-date from a hand-edited backup must not reach either, and
        // must not make every later updateJob throw on the merged record.
        closesOn: /^\d{4}-\d{2}-\d{2}$/.test(String(j.closesOn ?? '')) ? j.closesOn : null,
        createdAt: String(j.createdAt ?? restoredAt),
      }));
      const candidates = data.candidates.map((c) => ({
        ...c,
        name: String(c.name),
        email: String(c.email ?? ''),
        phone: String(c.phone ?? ''),
        // Every in-app write path keeps stages inside the configured list
        // (removal is blocked while any candidate occupies one). A restored
        // stage outside it would put the candidate in no board column while
        // the profile select silently displays the first stage; land them
        // somewhere real instead.
        stage: isValidStage(c.stage, data.settings) ? c.stage : 'applied',
        // A candidate with no (or an unrecognized) status would be active
        // by every write path's standards yet fail isActive(): off the
        // board, mislabeled "Withdrawn" in the archive, and offered up by
        // the retention purge. Default to active, like addCandidate does.
        status: Object.values(STATUS).includes(c.status) ? c.status : STATUS.ACTIVE,
        // String-coerce the sort keys: views localeCompare these, and a
        // numeric epoch from a hand-edited backup would throw mid-render.
        createdAt: String(c.createdAt ?? restoredAt),
        stageChangedAt: String(c.stageChangedAt ?? c.createdAt ?? restoredAt),
        // The timeline, reports, and retention all switch on entry.type, so
        // history needs the same per-entry filter as follow-ups below.
        history: Array.isArray(c.history) ? c.history.filter((e) => e && typeof e === 'object') : [],
        timeZone: normalizeTimeZone(c.timeZone),
        // Tags are chips on the board, the profile, and the filters; a
        // non-list would break every one of those render paths.
        tags: normalizeTags(c.tags),
        // Answers are rendered as label/answer pairs on the profile and in
        // Compare; a non-list (or a stray null entry) would take those
        // screens down the way a bad followups list would.
        answers: normalizeAnswers(c.answers) ?? undefined,
        // Attachment ids and names are file-path segments; restore them in
        // the shape addAttachment stores (inert id, sanitized name).
        attachments: Array.isArray(c.attachments)
          ? c.attachments.filter((a) => isSafeId(a?.id)).map((a) => ({ ...a, name: sanitizeFileName(a.name) }))
          : undefined,
        // Follow-ups and pool membership are iterated on every render —
        // the dashboard's due list, the board's badges, the pool tab — so
        // a non-list (or a stray null entry) would make the whole app
        // unrenderable: the same hole the onboarding plans below plug.
        followups: Array.isArray(c.followups) ? c.followups.filter((f) => f && typeof f === 'object') : undefined,
        pool:
          c.pool && typeof c.pool === 'object' && !Array.isArray(c.pool)
            ? {
                addedAt: c.pool.addedAt ?? restoredAt,
                // A backup written before tags moved onto the candidate
                // carries them here; keep them readable rather than
                // dropping labels somebody wrote.
                ...(Array.isArray(c.pool.tags) && c.pool.tags.length > 0
                  ? { tags: normalizeTags(c.pool.tags) }
                  : {}),
              }
            : undefined,
      }));
      // Validation vouches for job and candidate records but only checks
      // that these are arrays — a null entry would throw right here.
      const records = (list) => list.filter((r) => r && typeof r === 'object');
      const interviews = records(data.interviews).map((i) => {
        // A proposal is only a proposal while it still holds options to
        // pick from; without them the schedule would show a row whose
        // "Confirm a time" has nothing to confirm.
        const slots = normalizeSlots(i.slots);
        const proposed = i.status === 'proposed' && slots.length > 0;
        return {
        ...i,
        status: proposed ? 'proposed' : 'scheduled',
        ...(proposed ? { slots, proposedAt: String(i.proposedAt ?? i.createdAt ?? restoredAt) } : { slots: undefined, proposedAt: undefined }),
        date: String(i.date ?? ''),
        // A zone this browser cannot resolve would be shown as no zone at
        // all while conflict detection and the .ics still tried to honor
        // it; store what the app can actually read back.
        timeZone: normalizeTimeZone(i.timeZone),
        interviewers: Array.isArray(i.interviewers) ? i.interviewers : [],
        };
      });
      const scorecards = records(data.scorecards).map((s) => ({
        ...s,
        // Rendered as question/answer pairs under the scorecard; a
        // non-list would take the profile down.
        guideAnswers: normalizeGuideAnswers(s.guideAnswers) ?? undefined,
        createdAt: String(s.createdAt ?? restoredAt),
      }));
      const offers = records(data.offers).map((o) => ({ ...o, createdAt: String(o.createdAt ?? restoredAt) }));
      // Views dereference plan.tasks on every render (the dashboard is the
      // default route), so one null or task-less plan would make the whole
      // app unrenderable. Keep only plans in the shape the app writes —
      // and only real tasks inside them: onboardingProgress reads t.done
      // and groupTasks reads t.category off every entry, so a single null
      // in the list takes down the same screens a null plan would.
      const onboarding = Object.fromEntries(
        Object.entries(data.onboarding && typeof data.onboarding === 'object' ? data.onboarding : {})
          .filter(([, plan]) => plan && typeof plan === 'object' && !Array.isArray(plan))
          .map(([id, plan]) => [
            id,
            { ...plan, tasks: Array.isArray(plan.tasks) ? plan.tasks.filter((t) => t && typeof t === 'object') : [] },
          ])
      );
      const settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}), onboarded: true };
      // The company name is spread over its default, so a hand-edited
      // backup can replace '' with null — and the public page builders
      // call .trim() on it straight. That took down Publish, Preview, and
      // Unpublish (which rewrites the site index) with a raw TypeError,
      // including the reconcile the restore itself runs. Store it the way
      // the Settings dialog does.
      settings.companyName = String(settings.companyName ?? '').trim();
      // The account's default interview zone: same reasoning as the
      // per-interview one, and it seeds every new interview.
      settings.timeZone = normalizeTimeZone(settings.timeZone);
      // Guides drive the interview editor and the scorecard form; a
      // malformed one would render an empty question list at best.
      settings.guides = normalizeGuides(settings.guides);
      // Onboarding templates stamp every future hire's checklist; an
      // unusable one would produce an empty plan.
      settings.onboardingTemplates = normalizeOnboardingTemplates(settings.onboardingTemplates);
      // workingHours() validates on read (a broken window falls back to
      // the default), so nothing to coerce here beyond keeping the shape
      // an object: an array or a string would survive its own checks.
      if (settings.workingHours && (typeof settings.workingHours !== 'object' || Array.isArray(settings.workingHours))) {
        delete settings.workingHours;
      }
      // The calendar feed's file name becomes a path in the user's cloud
      // and a public URL, so only a name this app would have minted may
      // come back from a backup — the same rule attachment names follow.
      if (settings.calendarFeed && !isFeedFile(settings.calendarFeed.file)) delete settings.calendarFeed;
      // The publish subdomain is rendered as "https://<subdomain>.puter.site"
      // links; a value that cannot be a real subdomain must not survive.
      if (settings.publishSite && !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(String(settings.publishSite.subdomain ?? ''))) {
        delete settings.publishSite;
      }
      // The public site is an account resource, not backup payload: a
      // backup that predates publishing must not disown the live site —
      // the UI could no longer take its pages down, and the next publish
      // would reserve a second subdomain while the first kept serving.
      if (!settings.publishSite && state.settings.publishSite) {
        settings.publishSite = state.settings.publishSite;
      }
      const next = { jobs, candidates, interviews, scorecards, offers, onboarding, settings };
      // persist writes each collection independently, so a value that
      // cannot be saved (the KV size limit) would leave storage split
      // between the old and the new dataset — with the old data already
      // gone. Refuse before the first write, and before memory is touched.
      for (const c of COLLECTIONS) backend.preflight?.(c, next[c]);
      // Candidates the restore drops leave attachment files no UI can
      // reach; candidates that survive keep theirs, so a same-account
      // backup round-trip keeps its downloads working.
      const restoredIds = new Set(candidates.map((c) => c.id));
      const removedIds = state.candidates.filter((c) => !restoredIds.has(c.id)).map((c) => c.id);
      Object.assign(state, next);
      await persist(...COLLECTIONS);
      await deleteAttachmentDirs(removedIds);
      notify();
    },

    // ---- Timeline notes -------------------------------------------------

    /** Append a freeform note to the candidate's timeline. */
    async addCandidateNote(id, text) {
      const candidate = requireCandidate(id);
      const trimmed = String(text ?? '').trim();
      if (!trimmed) throw new Error('A note needs some text.');
      logEvent(candidate, { type: 'note', id: uid('evt'), text: trimmed.slice(0, 1000) });
      await persist('candidates');
      notify();
      return candidate.history.at(-1);
    },

    /** Notes are the only editable history: they can be deleted, one by one. */
    async deleteCandidateNote(candidateId, eventId) {
      const candidate = requireCandidate(candidateId);
      const before = candidate.history?.length ?? 0;
      candidate.history = (candidate.history ?? []).filter((e) => !(e.type === 'note' && e.id === eventId));
      if (candidate.history.length === before) throw new Error('Note not found.');
      await persist('candidates');
      notify();
    },

    // ---- Contact log ------------------------------------------------------

    /**
     * Record that a draft was opened to this candidate. The app cannot see
     * a send — every message goes through the user's own mail client — so
     * the event says what it knows, and `markEmailSent` is how the user
     * upgrades it to a fact.
     */
    async logEmail(id, { template = '', subject = '' } = {}) {
      const candidate = requireCandidate(id);
      logEvent(candidate, {
        type: 'email',
        id: uid('evt'),
        template: String(template),
        subject: String(subject).trim().slice(0, 300),
        sent: false,
      });
      await persist('candidates');
      notify();
      return candidate.history.at(-1);
    },

    async markEmailSent(candidateId, eventId) {
      const candidate = requireCandidate(candidateId);
      const event = (candidate.history ?? []).find((e) => e.type === 'email' && e.id === eventId);
      if (!event) throw new Error('That email is not on the timeline.');
      if (event.sent) return event;
      event.sent = true;
      event.sentAt = now();
      await persist('candidates');
      notify();
      return event;
    },

    /** Same, for a batch the rejection queue just walked through. */
    async markEmailsSent(entries) {
      let marked = 0;
      for (const { candidateId, eventId } of entries) {
        const candidate = state.candidates.find((c) => c.id === candidateId);
        const event = (candidate?.history ?? []).find((e) => e.type === 'email' && e.id === eventId && !e.sent);
        if (!event) continue;
        event.sent = true;
        event.sentAt = now();
        marked += 1;
      }
      if (marked > 0) {
        await persist('candidates');
        notify();
      }
      return marked;
    },

    // ---- Follow-ups -------------------------------------------------------

    /** Record a commitment: "call Dana Thursday". Due date required, time optional. */
    async addFollowup(candidateId, { text, dueDate, dueTime = '' }) {
      const candidate = requireCandidate(candidateId);
      assertValid(validateFollowup({ text, dueDate, dueTime }));
      const followup = {
        id: uid('fu'),
        text: String(text).trim().slice(0, 300),
        dueDate,
        dueTime: dueTime || '',
        done: false,
        completedAt: null,
        createdAt: now(),
      };
      candidate.followups = [...(candidate.followups ?? []), followup];
      await persist('candidates');
      notify();
      return followup;
    },

    async toggleFollowup(candidateId, followupId, done = undefined) {
      const candidate = requireCandidate(candidateId);
      const followup = (candidate.followups ?? []).find((f) => f.id === followupId);
      if (!followup) throw new Error('Follow-up not found.');
      followup.done = done === undefined ? !followup.done : Boolean(done);
      followup.completedAt = followup.done ? now() : null;
      await persist('candidates');
      notify();
      return followup;
    },

    async deleteFollowup(candidateId, followupId) {
      const candidate = requireCandidate(candidateId);
      const before = candidate.followups?.length ?? 0;
      candidate.followups = (candidate.followups ?? []).filter((f) => f.id !== followupId);
      if (candidate.followups.length === before) throw new Error('Follow-up not found.');
      await persist('candidates');
      notify();
    },

    // ---- Attachments ----------------------------------------------------

    /**
     * Upload first, then record metadata: a failed write must never leave
     * a listed attachment with no file behind it.
     */
    async addAttachment(candidateId, { name, type = '', size, data }) {
      const candidate = requireCandidate(candidateId);
      const list = candidate.attachments ?? [];
      if (list.length >= MAX_ATTACHMENTS_PER_CANDIDATE) {
        throw new Error(`A candidate can hold up to ${MAX_ATTACHMENTS_PER_CANDIDATE} attachments.`);
      }
      const bytes = Number(size ?? data?.size);
      if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('That file looks empty.');
      if (bytes > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Attachments are capped at ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB per file.`);
      }
      const attachment = {
        id: uid('att'),
        name: sanitizeFileName(name),
        type: String(type),
        size: bytes,
        at: now(),
      };
      await backend.writeFile(attachmentPath(candidateId, attachment), data);
      // Re-read the list: the view stays interactive during the upload, so
      // an attachment deleted meanwhile must not be resurrected by the
      // pre-upload snapshot (its file is already gone).
      candidate.attachments = [...(candidate.attachments ?? []), attachment];
      logEvent(candidate, { type: 'attachment', name: attachment.name });
      await persist('candidates');
      notify();
      return attachment;
    },

    async readAttachment(candidateId, attachmentId) {
      const candidate = requireCandidate(candidateId);
      const attachment = (candidate.attachments ?? []).find((a) => a.id === attachmentId);
      if (!attachment) throw new Error('Attachment not found.');
      return backend.readFile(attachmentPath(candidateId, attachment));
    },

    async deleteAttachment(candidateId, attachmentId) {
      const candidate = requireCandidate(candidateId);
      const attachment = (candidate.attachments ?? []).find((a) => a.id === attachmentId);
      if (!attachment) throw new Error('Attachment not found.');
      try {
        await backend.deleteFile(attachmentPath(candidateId, attachment));
      } catch (err) {
        // An already-missing file should not stop the metadata cleanup.
        if (!isMissingPathError(err)) throw err;
      }
      candidate.attachments = candidate.attachments.filter((a) => a.id !== attachmentId);
      await persist('candidates');
      notify();
    },

    // ---- Interviews -----------------------------------------------------

    async scheduleInterview({ candidateId, date, start, end, timeZone = '', type = 'video', interviewers = [], location = '', meetingLink = '', notes = '', guideId = '' }) {
      // New interviews are for people still in process — the editor's own
      // candidate list agrees. Rescheduling or deleting what already
      // exists stays open: cleanup must not require un-archiving anyone.
      const candidate = requireActiveCandidate(candidateId, 'scheduling an interview');
      assertValid(validateInterview({ date, start, end, type, timeZone }));
      const interview = {
        id: uid('itv'),
        candidateId,
        jobId: candidate.jobId,
        date,
        start,
        end,
        // '' means the times are read on whatever clock the reader is on,
        // which is what every interview meant before zones existed.
        timeZone: normalizeTimeZone(timeZone) || normalizeTimeZone(state.settings.timeZone),
        type,
        interviewers: interviewers.map((n) => String(n).trim()).filter(Boolean),
        location: String(location).trim(),
        meetingLink: String(meetingLink).trim(),
        notes: String(notes).trim(),
        // The question set to run this interview from; '' is "no guide".
        guideId: findGuide(state.settings, guideId)?.id ?? '',
        status: 'scheduled',
        createdAt: now(),
      };
      state.interviews.push(interview);
      logEvent(candidate, { type: 'interview', date, start });
      await persist('interviews', 'candidates');
      notify();
      return interview;
    },

    async updateInterview(id, patch) {
      const interview = state.interviews.find((i) => i.id === id);
      if (!interview) throw new Error('Interview not found.');
      const next = { ...interview, ...patch };
      assertValid(validateInterview(next));
      if (patch.timeZone !== undefined) next.timeZone = normalizeTimeZone(patch.timeZone);
      if (patch.guideId !== undefined) next.guideId = findGuide(state.settings, patch.guideId)?.id ?? '';
      // Editing a proposal replaces its options; its date/start/end keep
      // pointing at the earliest one, which is what the schedule shows.
      if (patch.slots !== undefined) {
        assertValid(validateSlots(patch.slots));
        next.slots = normalizeSlots(patch.slots);
        next.status = 'proposed';
        // A fixed booking turned into a proposal is a proposal sent now.
        // Without its own stamp the wait was measured from createdAt, so
        // an interview scheduled a fortnight ago and re-offered as options
        // today read "sent 12 days ago, no reply" the moment it was saved
        // — and fired the unanswered-proposal nudge in the same minute. An
        // existing proposal keeps its original stamp: editing the options
        // does not restart the wait for a reply.
        if (!isProposed(interview)) next.proposedAt = now();
        Object.assign(next, next.slots[0]);
      } else if (patch.status === 'scheduled' && isProposed(interview)) {
        // Typing a time into a proposal settles it: one stated time, and no
        // stale list of options beside it inviting a second confirmation.
        next.slots = undefined;
        next.proposedAt = undefined;
      }
      Object.assign(interview, next);
      await persist('interviews');
      notify();
      return interview;
    },

    /**
     * Offer the candidate a choice of times instead of one fixed slot. The
     * record is a real interview from the start — it sits on the schedule
     * and in the candidate's timeline — but its status says nobody has
     * agreed to it yet, and its date/start/end mirror the earliest option
     * so every list that orders interviews by time keeps working.
     */
    async proposeInterview({ candidateId, slots, timeZone = '', type = 'video', interviewers = [], location = '', meetingLink = '', notes = '', guideId = '' }) {
      const candidate = requireActiveCandidate(candidateId, 'proposing interview times');
      assertValid(validateSlots(slots));
      const clean = normalizeSlots(slots);
      assertValid(validateInterview({ ...clean[0], type, timeZone }));
      const interview = {
        id: uid('itv'),
        candidateId,
        jobId: candidate.jobId,
        ...clean[0],
        timeZone: normalizeTimeZone(timeZone) || normalizeTimeZone(state.settings.timeZone),
        type,
        interviewers: interviewers.map((n) => String(n).trim()).filter(Boolean),
        location: String(location).trim(),
        meetingLink: String(meetingLink).trim(),
        notes: String(notes).trim(),
        guideId: findGuide(state.settings, guideId)?.id ?? '',
        status: 'proposed',
        slots: clean,
        proposedAt: now(),
        createdAt: now(),
      };
      state.interviews.push(interview);
      logEvent(candidate, { type: 'interview', action: 'proposed', count: clean.length });
      await persist('interviews', 'candidates');
      notify();
      return interview;
    },

    /** The candidate picked one: the proposal becomes a scheduled interview. */
    async confirmInterviewSlot(id, index) {
      const interview = state.interviews.find((i) => i.id === id);
      if (!interview) throw new Error('Interview not found.');
      if (!isProposed(interview)) throw new Error('This interview already has a fixed time.');
      const slot = normalizeSlots(interview.slots)[index];
      if (!slot) throw new Error('That option is no longer on the list.');
      const candidate = requireActiveCandidate(interview.candidateId, 'confirming the time');
      assertValid(validateInterview({ ...slot, type: interview.type, timeZone: interview.timeZone }));
      Object.assign(interview, slot);
      interview.status = 'scheduled';
      // The options are dropped, not kept: the record now states one time,
      // and a stale list beside it would only invite a second confirmation.
      delete interview.slots;
      delete interview.proposedAt;
      logEvent(candidate, { type: 'interview', date: slot.date, start: slot.start });
      await persist('interviews', 'candidates');
      notify();
      return interview;
    },

    /** Scorecards written for this interview survive; they lose the link only. */
    async deleteInterview(id) {
      if (!state.interviews.some((i) => i.id === id)) throw new Error('Interview not found.');
      state.interviews = state.interviews.filter((i) => i.id !== id);
      let scorecardsTouched = false;
      state.scorecards = state.scorecards.map((s) => {
        if (s.interviewId !== id) return s;
        scorecardsTouched = true;
        return { ...s, interviewId: null };
      });
      await persist('interviews', ...(scorecardsTouched ? ['scorecards'] : []));
      notify();
    },

    // ---- Scorecards -----------------------------------------------------

    async addScorecard({ candidateId, interviewId = null, author, ratings = {}, recommendation, notes = '', guideName = '', guideAnswers = null }) {
      const candidate = requireCandidate(candidateId);
      assertValid(validateScorecard({ author, recommendation, ratings }));
      // Snapshot the job's custom rubric so this feedback keeps rendering
      // with the dimensions it was written against, even after the job's
      // rubric changes. Absence means the default rubric.
      const job = state.jobs.find((j) => j.id === candidate.jobId);
      const fields = normalizeRatingFields(job?.ratingFields);
      const scorecard = {
        id: uid('sc'),
        candidateId,
        interviewId,
        jobId: candidate.jobId,
        author: String(author).trim(),
        ratings,
        recommendation,
        notes: String(notes).trim(),
        ...(fields ? { fields } : {}),
        // The guide's questions and what was answered, snapshotted the way
        // `fields` is: editing the guide later must not rewrite feedback.
        ...(normalizeGuideAnswers(guideAnswers) ? { guideAnswers: normalizeGuideAnswers(guideAnswers) } : {}),
        ...(String(guideName).trim() ? { guideName: String(guideName).trim().slice(0, 80) } : {}),
        createdAt: now(),
      };
      state.scorecards.push(scorecard);
      logEvent(candidate, { type: 'scorecard', author: scorecard.author, recommendation });
      await persist('scorecards', 'candidates');
      notify();
      return scorecard;
    },

    async updateScorecard(id, patch) {
      const scorecard = state.scorecards.find((s) => s.id === id);
      if (!scorecard) throw new Error('Scorecard not found.');
      const next = { ...scorecard, ...patch };
      assertValid(validateScorecard(next));
      if (patch.guideAnswers !== undefined) next.guideAnswers = normalizeGuideAnswers(patch.guideAnswers) ?? undefined;
      Object.assign(scorecard, next);
      await persist('scorecards');
      notify();
      return scorecard;
    },

    async deleteScorecard(id) {
      if (!state.scorecards.some((s) => s.id === id)) throw new Error('Scorecard not found.');
      state.scorecards = state.scorecards.filter((s) => s.id !== id);
      await persist('scorecards');
      notify();
    },

    // ---- Offers ---------------------------------------------------------

    async createOffer({ candidateId, salary, currency = 'USD', bonus = null, equity = '', startDate, expires = null, notes = '' }) {
      const candidate = requireActiveCandidate(candidateId, 'drafting an offer');
      if (state.offers.some((o) => o.candidateId === candidateId && isOpenOffer(o))) {
        throw new Error('This candidate already has an open offer.');
      }
      assertValid(validateOffer({ salary, startDate, expires, bonus }));
      const offer = {
        id: uid('off'),
        candidateId,
        jobId: candidate.jobId,
        salary: Number(salary),
        currency,
        bonus: bonus === null || bonus === '' ? null : Number(bonus),
        equity: String(equity).trim(),
        startDate,
        expires: expires || null,
        notes: String(notes).trim(),
        status: OFFER_STATUS.DRAFT,
        sentAt: null,
        signedAt: null,
        signerName: '',
        resolvedAt: null,
        createdAt: now(),
      };
      state.offers.push(offer);
      logEvent(candidate, { type: 'offer', action: 'created' });
      await persist('offers', 'candidates');
      notify();
      return offer;
    },

    /** Terms are editable while the offer is a draft; after that they are a record. */
    async updateOffer(id, patch) {
      const offer = requireOffer(id);
      if (offer.status !== OFFER_STATUS.DRAFT) {
        throw new Error('Only draft offers can be edited.');
      }
      const next = { ...offer, ...patch };
      assertValid(validateOffer(next));
      next.salary = Number(next.salary);
      next.bonus = next.bonus === null || next.bonus === '' ? null : Number(next.bonus);
      Object.assign(offer, next);
      await persist('offers');
      notify();
      return offer;
    },

    /** Sending pulls the candidate into the Offer stage when they are earlier. */
    async sendOffer(id) {
      const offer = requireOffer(id);
      if (!canTransition(offer.status, OFFER_STATUS.SENT)) {
        throw new Error(`A ${offer.status} offer cannot be sent.`);
      }
      const candidate = requireActiveCandidate(offer.candidateId, 'sending the offer');
      offer.status = OFFER_STATUS.SENT;
      offer.sentAt = now();
      logEvent(candidate, { type: 'offer', action: 'sent' });
      const touched = new Set(['offers', 'candidates']);
      // Pull forward only: a custom stage can sit between Offer and Hired,
      // and sending from there must not drag the candidate backwards.
      if (stageIndex(candidate.stage, state.settings) < stageIndex('offer', state.settings)) {
        for (const c of applyStageMove(candidate, 'offer')) touched.add(c);
      }
      await persist(...touched);
      notify();
      return offer;
    },

    /**
     * Records the electronic signature (typed full name) and moves the
     * candidate to Hired, which starts their onboarding plan.
     */
    async signOffer(id, signerName) {
      const offer = requireOffer(id);
      if (!canTransition(offer.status, OFFER_STATUS.SIGNED)) {
        throw new Error(`A ${offer.status} offer cannot be signed.`);
      }
      const name = String(signerName ?? '').trim();
      if (!name) throw new Error('Type the signer’s full name to record the signature.');
      const candidate = requireActiveCandidate(offer.candidateId, 'recording the signature');
      offer.status = OFFER_STATUS.SIGNED;
      offer.signedAt = now();
      offer.resolvedAt = offer.signedAt;
      offer.signerName = name;
      logEvent(candidate, { type: 'offer', action: 'signed' });
      const touched = new Set(['offers', 'candidates']);
      for (const c of applyStageMove(candidate, 'hired')) touched.add(c);
      await persist(...touched);
      notify();
      return offer;
    },

    async declineOffer(id) {
      return this._closeOffer(id, OFFER_STATUS.DECLINED);
    },

    async withdrawOffer(id) {
      return this._closeOffer(id, OFFER_STATUS.WITHDRAWN);
    },

    async _closeOffer(id, status) {
      const offer = requireOffer(id);
      if (!canTransition(offer.status, status)) {
        throw new Error(`A ${offer.status} offer cannot be marked ${status}.`);
      }
      const candidate = state.candidates.find((c) => c.id === offer.candidateId);
      offer.status = status;
      offer.resolvedAt = now();
      if (candidate) logEvent(candidate, { type: 'offer', action: status });
      await persist('offers', ...(candidate ? ['candidates'] : []));
      notify();
      return offer;
    },

    /** Drafts and closed-out offers can be deleted; sent and signed cannot. */
    async deleteOffer(id) {
      const offer = requireOffer(id);
      if (offer.status === OFFER_STATUS.SENT || offer.status === OFFER_STATUS.SIGNED) {
        throw new Error('Withdraw the offer before deleting it.');
      }
      state.offers = state.offers.filter((o) => o.id !== id);
      await persist('offers');
      notify();
    },

    // ---- Onboarding -----------------------------------------------------

    _requirePlan(candidateId) {
      const plan = state.onboarding[candidateId];
      if (!plan) throw new Error('No onboarding plan for this candidate.');
      return plan;
    },

    async toggleOnboardingTask(candidateId, taskId, done = undefined) {
      const plan = this._requirePlan(candidateId);
      const task = plan.tasks.find((t) => t.id === taskId);
      if (!task) throw new Error('Task not found.');
      task.done = done === undefined ? !task.done : Boolean(done);
      await persist('onboarding');
      notify();
      return task;
    },

    async addOnboardingTask(candidateId, title, category = 'Other') {
      const plan = this._requirePlan(candidateId);
      const trimmed = String(title ?? '').trim();
      if (!trimmed) throw new Error('A task needs a title.');
      const task = { id: uid('task'), title: trimmed, category, done: false };
      plan.tasks.push(task);
      await persist('onboarding');
      notify();
      return task;
    },

    async removeOnboardingTask(candidateId, taskId) {
      const plan = this._requirePlan(candidateId);
      plan.tasks = plan.tasks.filter((t) => t.id !== taskId);
      await persist('onboarding');
      notify();
    },

    // ---- Snapshots --------------------------------------------------------

    /** Take a snapshot now, whatever the last one's age. */
    async snapshot(reason = 'manual') {
      return writeSnapshot(reason);
    },

    /** Take one only if the newest is stale (or there is none at all). */
    async snapshotIfStale({ hours = undefined } = {}) {
      if (!snapshots || !backend.listDir) return null;
      const entries = await backend.listDir(SNAPSHOT_DIR);
      if (!snapshotDue(entries, { now: new Date(now()), ...(hours ? { hours } : {}) })) return null;
      return writeSnapshot('daily');
    },

    /**
     * Every snapshot on disk, newest first, with what the index knows
     * about it. The directory decides what exists; the index only adds
     * the record counts, so a lost index costs detail, not access.
     */
    async listSnapshots() {
      if (!backend.listDir) return [];
      const entries = await backend.listDir(SNAPSHOT_DIR);
      const index = new Map((await readIndex()).map((e) => [e?.name, e]));
      return sortSnapshots(entries).map((s) => ({
        ...s,
        bytes: s.bytes ?? index.get(s.name)?.bytes ?? null,
        counts: index.get(s.name)?.counts ?? null,
      }));
    },

    /** The parsed payload of one snapshot, ready for restoreBackup. */
    async readSnapshot(name) {
      if (!isSnapshotName(name)) throw new Error('That is not a snapshot this app wrote.');
      const blob = await backend.readFile(`${SNAPSHOT_DIR}/${name}`);
      return JSON.parse(typeof blob === 'string' ? blob : await blob.text());
    },

    async deleteSnapshot(name) {
      if (!isSnapshotName(name)) throw new Error('That is not a snapshot this app wrote.');
      try {
        await backend.deleteFile(`${SNAPSHOT_DIR}/${name}`);
      } catch (err) {
        if (!isMissingPathError(err)) throw err;
      }
      const index = (await readIndex()).filter((e) => e?.name !== name);
      await backend.writeFile(SNAPSHOT_INDEX, JSON.stringify({ snapshots: index })).catch(() => {});
    },

    // ---- Sample data ------------------------------------------------------

    /**
     * Installs a sample dataset and flags it, so the shell can show a
     * persistent "sample data" banner with a one-tap wipe. Also marks
     * onboarding as done.
     */
    async loadSampleData(dataset) {
      for (const c of DATA_COLLECTIONS) {
        if (dataset[c] !== undefined) state[c] = dataset[c];
      }
      state.settings = {
        ...state.settings,
        ...(dataset.settings ?? {}),
        sampleData: true,
        onboarded: true,
      };
      await persist(...COLLECTIONS);
      notify();
    },

    /** Removes every record so the user can start from scratch. */
    async wipeSampleData() {
      await guardSnapshot('wipe');
      state.jobs = [];
      state.candidates = [];
      state.interviews = [];
      state.scorecards = [];
      state.offers = [];
      state.onboarding = {};
      state.settings = { ...state.settings, sampleData: false, companyName: '' };
      await persist(...COLLECTIONS);
      // Files uploaded while exploring must not linger in the user's cloud
      // once no record points at them. Deleted only after the wipe is
      // saved, so a failed save cannot strand records without their files.
      await backend.deleteDir(ATTACHMENTS_DIR).catch(() => {});
      notify();
    },
  };
}
