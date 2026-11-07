/**
 * Pipeline stages and candidate status — the shape of the hiring funnel.
 *
 * The stage list is configurable (settings.stages), with three invariants
 * the rest of the app relies on: 'applied' is always first, 'hired' is
 * always last, and 'offer' always exists (sending an offer moves the
 * candidate there; signing auto-hires). Stage keys are stable ids, so
 * history events survive renames; settings.retiredStages keeps the labels
 * of removed stages so old history still reads correctly.
 */

import { daysSince } from '../lib/dates.js';
import { isSafeId } from '../lib/id.js';

export const DEFAULT_STAGES = [
  { key: 'applied', label: 'Applied', icon: 'inbox', color: 'var(--stage-applied)' },
  { key: 'screen', label: 'Screening', icon: 'phone-call', color: 'var(--stage-screen)' },
  { key: 'interview', label: 'Interview', icon: 'users', color: 'var(--stage-interview)' },
  { key: 'offer', label: 'Offer', icon: 'file-text', color: 'var(--stage-offer)' },
  { key: 'hired', label: 'Hired', icon: 'badge-check', color: 'var(--stage-hired)' },
];

/** Legacy alias — new code should derive the list from settings via stagesFrom. */
export const STAGES = DEFAULT_STAGES;

/** Stages whose position or presence the app depends on. */
export const ANCHOR_STAGES = ['applied', 'hired'];

/** How many --stage-custom-N color variables the stylesheet defines. */
const CUSTOM_STAGE_COLORS = 6;

export const STATUS = {
  ACTIVE: 'active',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
};

/* Normalizing runs on every render helper; cache per settings.stages array
   (settings objects are replaced wholesale on every update, so reference
   equality is a safe key). */
let cachedSource = null;
let cachedList = DEFAULT_STAGES;

/**
 * The configured stage list: [{ key, label, icon, color }]. Absent or
 * malformed settings mean the five defaults. Whatever is stored, the
 * result always starts with 'applied', ends with 'hired', and contains
 * 'offer' — a hand-edited backup cannot break those invariants.
 */
export function stagesFrom(settings) {
  const raw = settings?.stages;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_STAGES;
  if (raw === cachedSource) return cachedList;

  const seen = new Set(ANCHOR_STAGES);
  const middle = [];
  for (const entry of raw) {
    const key = String(entry?.key ?? '');
    const label = String(entry?.label ?? '').trim();
    if (!isSafeId(key) || !label || seen.has(key)) continue;
    seen.add(key);
    middle.push({ key, label });
  }
  if (!middle.some((s) => s.key === 'offer')) {
    middle.push({ key: 'offer', label: 'Offer' });
  }

  let customCount = 0;
  const list = [
    DEFAULT_STAGES[0],
    ...middle.map(({ key, label }) => {
      const base = DEFAULT_STAGES.find((s) => s.key === key);
      if (base) return { ...base, label };
      customCount += 1;
      return {
        key,
        label,
        icon: 'milestone',
        color: `var(--stage-custom-${((customCount - 1) % CUSTOM_STAGE_COLORS) + 1})`,
      };
    }),
    DEFAULT_STAGES.at(-1),
  ];
  cachedSource = raw;
  cachedList = list;
  return list;
}

export function isValidStage(key, settings) {
  return stagesFrom(settings).some((s) => s.key === key);
}

export function stageIndex(key, settings) {
  return stagesFrom(settings).findIndex((s) => s.key === key);
}

/** Label for a stage key: configured list, then retired stages, then defaults. */
export function stageLabel(key, settings) {
  return (
    stagesFrom(settings).find((s) => s.key === key)?.label ??
    settings?.retiredStages?.[key] ??
    DEFAULT_STAGES.find((s) => s.key === key)?.label ??
    key
  );
}

/** The stage after `key`, or null at the end of the pipeline. */
export function nextStage(key, settings) {
  const stages = stagesFrom(settings);
  const i = stages.findIndex((s) => s.key === key);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1].key : null;
}

export function isHired(candidate) {
  return candidate.status === STATUS.ACTIVE && candidate.stage === 'hired';
}

export function isActive(candidate) {
  return candidate.status === STATUS.ACTIVE;
}

/** Candidates on the board (active, any stage), optionally for one job. */
export function activeCandidates(candidates, jobId = null) {
  return candidates.filter((c) => isActive(c) && (jobId === null || c.jobId === jobId));
}

/**
 * Of the records hanging off a candidate (interviews, offers), the ones
 * whose candidate is still on the board. An archived candidate's records
 * are kept for the books and for cleanup, but they are nobody's live work,
 * so counts that promise work coming up must leave them out. A record
 * whose candidate is gone entirely is kept: it is orphaned, not archived,
 * and the views still list it.
 */
export function onActiveCandidates(records, candidates) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return records.filter((r) => {
    const candidate = byId.get(r.candidateId);
    return !candidate || isActive(candidate);
  });
}

/** Stage -> count of active candidates. Every stage is present, even at 0. */
export function funnelCounts(candidates, jobId = null, settings = null) {
  const counts = Object.fromEntries(stagesFrom(settings).map((s) => [s.key, 0]));
  for (const c of activeCandidates(candidates, jobId)) {
    if (c.stage in counts) counts[c.stage] += 1;
  }
  return counts;
}

/** Whole days a candidate has been in their current stage. */
export function daysInStage(candidate, now = new Date()) {
  return daysSince(candidate.stageChangedAt ?? candidate.createdAt, now);
}

/** Active, not yet hired, and sitting in a stage longer than `thresholdDays`. */
export function staleCandidates(candidates, { thresholdDays = 14, now = new Date() } = {}) {
  return candidates
    .filter((c) => isActive(c) && c.stage !== 'hired' && daysInStage(c, now) >= thresholdDays)
    .sort((a, b) => daysInStage(b, now) - daysInStage(a, now));
}
