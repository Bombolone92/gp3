/**
 * Bulk staffing: proposals for every open shift in a stretch of days.
 *
 * The ranking itself is suggestAssignees, one shift at a time. What this
 * adds is the part a loop of independent calls gets wrong: each accepted
 * proposal is written into a working copy of the shift list before the
 * next shift is ranked, so nobody is proposed for two overlapping shifts
 * and nobody is walked past their weekly maximum by assignments made
 * moments earlier in the same pass.
 */
import { toMinutes } from '../lib/time.js';
import { suggestAssignees } from './scheduling.js';

/**
 * One entry per open shift on `dates`, in the order they are worked:
 *
 *   { shift, candidates, proposal, skipped, stale, pinned }
 *
 * `proposal` is the candidate to assign (the top-ranked one, or the
 * pinned pick) or null when nobody is a clean fit. `candidates` is what
 * the picker offers for that row. `choices` maps a shift id to an
 * employee id to pin that row, or to null to leave the shift open;
 * rows nobody has touched keep re-deriving, so overriding one row is
 * reflected in every proposal after it. `stale` flags a pinned pick that
 * an earlier override has since made impossible.
 */
export function planFill(
  { shifts, employees, availability, settings },
  dates,
  { limit = 4, choices = {} } = {}
) {
  const rules = settings?.rules ?? null;
  const days = new Set(dates);
  const open = shifts
    .filter((s) => !s.assigneeId && days.has(s.date))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0) ||
        a.id.localeCompare(b.id)
    );

  let working = shifts;
  const plan = [];
  for (const shift of open) {
    const candidates = suggestAssignees(shift, { employees, shifts: working, availability, rules }, limit);
    const pinned = Object.hasOwn(choices, shift.id) ? choices[shift.id] : undefined;
    let proposal = null;
    let stale = false;
    if (pinned === undefined) {
      proposal = candidates[0] ?? null;
    } else if (pinned !== null) {
      proposal = candidates.find((c) => c.employee.id === pinned) ?? null;
      stale = proposal === null;
    }
    plan.push({
      shift,
      candidates,
      proposal,
      skipped: pinned === null,
      stale,
      pinned: pinned !== undefined,
    });
    if (proposal) {
      working = working.map((s) =>
        s.id === shift.id ? { ...s, assigneeId: proposal.employee.id } : s
      );
    }
  }
  return plan;
}

/** Counts behind the plan's summary line and the outcome report. */
export function fillSummary(plan) {
  return {
    total: plan.length,
    filling: plan.filter((p) => p.proposal).length,
    skipped: plan.filter((p) => p.skipped).length,
    nobody: plan.filter((p) => !p.proposal && !p.skipped).length,
  };
}

/** The { shiftId, assigneeId } pairs a plan would write. */
export function fillAssignments(plan) {
  return plan
    .filter((p) => p.proposal)
    .map((p) => ({ shiftId: p.shift.id, assigneeId: p.proposal.employee.id }));
}
