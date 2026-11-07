/**
 * Data retention for archived candidates. GDPR-style rules expect
 * applicant data to be erased after a defined period; the app surfaces
 * what is overdue and the user confirms every purge — nothing is ever
 * deleted silently.
 */

import { STATUS } from './pipeline.js';

/** Choices for settings.retentionMonths; empty means keep forever. */
export const RETENTION_OPTIONS = [
  { value: '', label: 'Forever (default)' },
  { value: '6', label: 'After 6 months' },
  { value: '12', label: 'After 12 months' },
  { value: '24', label: 'After 24 months' },
];

/** When the candidate was archived: the last archive event, best-effort. */
export function archivedAt(candidate) {
  const event = [...(candidate.history ?? [])]
    .reverse()
    .find((e) => e.type === STATUS.REJECTED || e.type === STATUS.WITHDRAWN);
  return event?.at ?? candidate.stageChangedAt ?? candidate.createdAt ?? null;
}

/**
 * Archived candidates past the configured retention window, oldest
 * first: [{ candidate, archivedAt }]. Talent-pool members are kept
 * deliberately, so they never come up for purging.
 */
export function retentionDue(state, now = new Date()) {
  const months = Number(state.settings?.retentionMonths ?? 0);
  if (!Number.isInteger(months) || months <= 0) return [];
  // Clamped to the target month's last day: a bare setMonth() overflows,
  // so six months before Aug 31 became "Feb 31" = Mar 3, and candidates
  // archived on Mar 1-2 were offered for purging days before the window.
  const cutoff = new Date(now);
  const day = cutoff.getDate();
  cutoff.setDate(1);
  cutoff.setMonth(cutoff.getMonth() - months);
  cutoff.setDate(Math.min(day, new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate()));
  const cutoffIso = cutoff.toISOString();
  return state.candidates
    .filter((c) => c.status !== STATUS.ACTIVE && !c.pool)
    .map((candidate) => ({ candidate, archivedAt: archivedAt(candidate) }))
    .filter((entry) => entry.archivedAt && entry.archivedAt < cutoffIso)
    .sort((a, b) => a.archivedAt.localeCompare(b.archivedAt));
}
