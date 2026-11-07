/**
 * Automatic backup snapshots: the safety net under the app's one-way doors.
 *
 * Every record lives in one account's KV store, and the only net was a JSON
 * file the user remembered to download. "Wipe everything", a restore from a
 * month-old file, deleting a job with its candidates, the retention purge —
 * each is final, and the advice ("download a backup first") is exactly the
 * step people skip. So the app takes snapshots itself, into the user's own
 * drive: one a day at most, and always one immediately before something
 * irreversible.
 *
 * Pure helpers here; the reading and writing lives in the store, which is
 * the only thing that holds a backend.
 */

/** Where snapshots live in the user's own Puter drive. */
export const SNAPSHOT_DIR = 'hiring-backups';

/** The metadata sidecar, so a list does not have to read every snapshot. */
export const SNAPSHOT_INDEX = `${SNAPSHOT_DIR}/index.json`;

/** How many ordinary snapshots are kept before the oldest is pruned. */
export const KEEP_SNAPSHOTS = 10;

/** A new automatic snapshot is due once the last one is this old. */
export const SNAPSHOT_STALE_HOURS = 20;

/**
 * Why a snapshot was taken. Everything but `daily` was taken because the
 * user was about to do something that cannot be undone, which is what
 * makes those worth keeping past the usual cap.
 */
export const SNAPSHOT_REASONS = {
  daily: 'Automatic',
  manual: 'Taken by hand',
  restore: 'Before a restore',
  wipe: 'Before wiping everything',
  purge: 'Before deleting records',
};

export const isDestructiveReason = (reason) => reason !== 'daily' && reason in SNAPSHOT_REASONS && reason !== 'manual';

const REASONS = Object.keys(SNAPSHOT_REASONS);
const NAME_RE = /^hiring-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})Z-([a-z]+)\.json$/;

/** 'hiring-2026-08-21T06-11-35Z-daily.json' */
export function snapshotName(at, reason = 'daily') {
  const stamp = new Date(at).toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-');
  return `hiring-${stamp}Z-${REASONS.includes(reason) ? reason : 'manual'}.json`;
}

/** The timestamp and reason a name encodes, or null when it is not ours. */
export function parseSnapshotName(name) {
  const match = NAME_RE.exec(String(name ?? ''));
  if (!match) return null;
  // 2026-08-21T06-11-35 -> 2026-08-21T06:11:35Z (colons are not file names)
  const iso = `${match[1].slice(0, 10)}T${match[1].slice(11).replace(/-/g, ':')}Z`;
  if (Number.isNaN(new Date(iso).getTime())) return null;
  return { name: String(name), at: iso, reason: REASONS.includes(match[2]) ? match[2] : 'manual' };
}

export const isSnapshotName = (name) => parseSnapshotName(name) !== null;

/**
 * Snapshots newest first, from raw directory entries. Deduped by name: a
 * caller merging a fresh entry into a listing that already holds it would
 * otherwise spend one of the kept slots twice, quietly pruning one more
 * snapshot than the cap allows.
 */
export function sortSnapshots(entries) {
  const byName = new Map();
  for (const entry of entries ?? []) {
    const parsed = parseSnapshotName(entry?.name ?? entry);
    if (!parsed || byName.has(parsed.name)) continue;
    byName.set(parsed.name, { ...parsed, bytes: Number(entry?.size) || null });
  }
  return [...byName.values()].sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Which snapshots to delete: everything past the newest `keep`, except the
 * most recent pre-destructive one — the whole point of that one is to
 * outlive the routine ones taken after the damage.
 */
export function prunable(snapshots, { keep = KEEP_SNAPSHOTS } = {}) {
  const sorted = sortSnapshots(snapshots);
  const kept = new Set(sorted.slice(0, keep).map((s) => s.name));
  const lastGuard = sorted.find((s) => isDestructiveReason(s.reason));
  if (lastGuard) kept.add(lastGuard.name);
  return sorted.filter((s) => !kept.has(s.name)).map((s) => s.name);
}

/** How many records a payload holds, for the list and the restore prompt. */
export function snapshotCounts(payload) {
  const data = payload?.data ?? {};
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs.length : 0,
    candidates: Array.isArray(data.candidates) ? data.candidates.length : 0,
    interviews: Array.isArray(data.interviews) ? data.interviews.length : 0,
    scorecards: Array.isArray(data.scorecards) ? data.scorecards.length : 0,
    offers: Array.isArray(data.offers) ? data.offers.length : 0,
  };
}

/** "12 candidates · 4 jobs · 9 interviews" — only what there is. */
export function countsText(counts) {
  if (!counts) return '';
  const parts = [
    [counts.candidates, 'candidate'],
    [counts.jobs, 'job'],
    [counts.interviews, 'interview'],
    [counts.offers, 'offer'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'Empty';
}

/** Is the newest snapshot old enough that a new one is due? */
export function snapshotDue(snapshots, { now = new Date(), hours = SNAPSHOT_STALE_HOURS } = {}) {
  const newest = sortSnapshots(snapshots)[0];
  if (!newest) return true;
  return now.getTime() - new Date(newest.at).getTime() >= hours * 3600 * 1000;
}
