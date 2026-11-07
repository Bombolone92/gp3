/**
 * Hiring analytics, computed entirely from data the app already records.
 * Candidate history events carry timestamps for every stage transition, so
 * everything here is a pure function over state: no new bookkeeping.
 */

import { stagesFrom, STATUS } from './pipeline.js';

const DAY = 86400000;
const ms = (iso) => new Date(iso).getTime();

/**
 * Days between two recorded timestamps, or null when either cannot be
 * read. Every timestamp the app writes is an ISO string, but a restored
 * backup is only checked for structure — and one unreadable `at` used to
 * spread a NaN through everything downstream: "NaNd" in Compare's days in
 * process, and a whole stage's average in Reports reading NaN because one
 * candidate's history had a hand-typed date in it.
 */
function spanDays(from, to) {
  const days = (ms(to) - ms(from)) / DAY;
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Scope candidates to a job and/or a created-after ISO timestamp. */
export function scopeCandidates(candidates, { jobId = null, since = null } = {}) {
  return candidates.filter(
    (c) => (!jobId || c.jobId === jobId) && (!since || c.createdAt >= since)
  );
}

/**
 * Reconstruct the stages a candidate has occupied, with entry/exit times.
 * Archive events (rejected/withdrawn) close the open visit — a dead
 * record must not keep accruing stage time forever — and restore or
 * re-engage events reopen the clock, so time spent in the archive never
 * counts toward any stage. The open-ended current visit has `to: null`
 * and closes at `nowIso` for duration math.
 */
export function stageVisits(candidate, nowIso) {
  const visits = [];
  let stage = null;
  let since = null;
  const close = (at) => {
    if (stage !== null && since !== null) {
      // A visit whose length cannot be worked out is left out rather than
      // called zero days: an unknown duration must not drag an average
      // down, and it must not become a NaN either.
      const days = spanDays(since, at);
      if (days !== null) visits.push({ stage, from: since, to: at, days });
    }
    since = null;
  };
  for (const event of candidate.history ?? []) {
    switch (event.type) {
      case 'created':
        stage = event.stage ?? 'applied';
        since = event.at;
        break;
      case 'stage':
        close(event.at);
        stage = event.to;
        since = event.at;
        break;
      case STATUS.REJECTED:
      case STATUS.WITHDRAWN:
        close(event.at);
        break;
      case 'restored':
        // Back on the board in the same stage; the clock restarts here.
        since = since ?? event.at;
        break;
      case 'reengaged':
        close(event.at);
        stage = 'applied';
        since = event.at;
        break;
    }
  }
  if (stage !== null && since !== null) {
    // Still open. An archived candidate without an archive event in its
    // history (imported data) degrades to closing at `nowIso`.
    const open = candidate.status === STATUS.ACTIVE;
    const days = spanDays(since, nowIso);
    if (days !== null) visits.push({ stage, from: since, to: open ? null : nowIso, days });
  }
  return visits;
}

/**
 * Every stage the candidate has occupied in their current candidacy,
 * including the one they are in. Re-engagement starts a fresh candidacy
 * on 'applied' (matching stageVisits): the stages reached for a previous
 * job must not count toward the job the record is scoped to now.
 */
export function reachedStages(candidate) {
  let reached = new Set();
  for (const event of candidate.history ?? []) {
    if (event.type === 'created') reached.add(event.stage ?? 'applied');
    else if (event.type === 'stage') {
      reached.add(event.from);
      reached.add(event.to);
    } else if (event.type === 'reengaged') {
      reached = new Set(['applied']);
    }
  }
  reached.add(candidate.stage);
  return reached;
}

/**
 * For each stage transition: how many candidates ever reached the stage,
 * and how many of those went on to any later stage. Skipping a stage
 * still counts as advancing past it.
 */
export function stageConversion(candidates, settings = null) {
  const stages = stagesFrom(settings);
  return stages.slice(0, -1).map((stage, i) => {
    const laterKeys = stages.slice(i + 1).map((s) => s.key);
    let reached = 0;
    let advanced = 0;
    for (const candidate of candidates) {
      const visited = reachedStages(candidate);
      if (!visited.has(stage.key)) continue;
      reached += 1;
      if (laterKeys.some((key) => visited.has(key))) advanced += 1;
    }
    return {
      stage: stage.key,
      next: stages[i + 1].key,
      reached,
      advanced,
      rate: reached > 0 ? advanced / reached : null,
    };
  });
}

/**
 * Days from application to the recorded move into Hired. `since` scopes
 * by when the hire happened — "hires in the last 30 days" must include a
 * candidate added months ago and hired yesterday.
 */
export function timeToHire(candidates, { since = null } = {}) {
  const values = [];
  for (const candidate of candidates) {
    const history = candidate.history ?? [];
    // The current candidacy starts at the last re-engagement: an earlier
    // hire belonged to a previous job (whose records were re-pointed at
    // the new one), and the archive gap between the two candidacies is
    // not pipeline time.
    let start = candidate.createdAt;
    for (const event of history) {
      if (event.type === 'reengaged') start = event.at;
    }
    // A candidate can be created directly in Hired (the editor's starting
    // stage includes it); that is a hire on day zero, and reachedStages /
    // the Sources table already count it as one. The `at >= start` guard
    // keeps a previous candidacy's created event from leaking past a
    // re-engagement, mirroring the stage-event rule.
    const hired = history.find(
      (e) =>
        (e.type === 'stage' && e.to === 'hired' && e.at >= start) ||
        (e.type === 'created' && e.stage === 'hired' && e.at >= start)
    );
    if (!hired || (since && hired.at < since)) continue;
    // Same guard as stageVisits: one unreadable timestamp must not make
    // the median time to hire NaN for every hire in the scope.
    const days = spanDays(start, hired.at);
    if (days !== null) values.push(days);
  }
  return { count: values.length, median: median(values) };
}

/** Average days spent per stage across all visits (hired excluded by callers). */
export function averageDaysInStage(candidates, nowIso, settings = null) {
  const stages = stagesFrom(settings);
  const acc = Object.fromEntries(stages.map((s) => [s.key, { days: 0, visits: 0 }]));
  for (const candidate of candidates) {
    for (const visit of stageVisits(candidate, nowIso)) {
      if (!(visit.stage in acc)) continue;
      acc[visit.stage].days += visit.days;
      acc[visit.stage].visits += 1;
    }
  }
  return stages.map((s) => ({
    stage: s.key,
    average: acc[s.key].visits > 0 ? acc[s.key].days / acc[s.key].visits : null,
  }));
}

/** Candidates and eventual hires per source, busiest sources first. */
export function sourceBreakdown(candidates) {
  const map = new Map();
  for (const candidate of candidates) {
    const key = String(candidate.source ?? '').trim() || 'Unknown';
    if (!map.has(key)) map.set(key, { source: key, total: 0, hired: 0 });
    const row = map.get(key);
    row.total += 1;
    if (reachedStages(candidate).has('hired')) row.hired += 1;
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
}

/**
 * Offer outcomes for a set of candidates (or every offer when unscoped).
 *
 * `since` scopes by when each thing happened, the way timeToHire does:
 * an offer counts as sent in the period if it was sent then, and as
 * signed or declined if it was resolved then. Scoping these by the
 * candidate's application date instead put the same screen at odds with
 * itself — a hire recorded this month, from an offer signed a week ago
 * to someone who applied in the spring, was counted under "Hires" while
 * "Offer acceptance" reported that no offer had been sent at all.
 */
export function offerOutcomes(offers, candidateIds = null, { since = null } = {}) {
  const within = (at) => !since || (Boolean(at) && String(at) >= since);
  const scoped = offers.filter((o) => !candidateIds || candidateIds.has(o.candidateId));
  const sent = scoped.filter((o) => o.sentAt && within(o.sentAt)).length;
  const resolved = (o) => o.resolvedAt ?? o.signedAt ?? null;
  const signed = scoped.filter((o) => o.status === 'signed' && within(resolved(o))).length;
  const declined = scoped.filter((o) => o.status === 'declined' && within(resolved(o))).length;
  return {
    sent,
    signed,
    declined,
    acceptance: signed + declined > 0 ? signed / (signed + declined) : null,
  };
}
