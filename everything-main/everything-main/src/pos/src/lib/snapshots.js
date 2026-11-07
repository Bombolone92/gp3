/**
 * Automatic snapshots: a restore point the shop never has to remember to make.
 *
 * This app is the shop's book of record, and the failures that matter are not
 * the cloud losing data - they are human and local. A restore from the wrong
 * file, a sample dataset wiped over real sales, a catalog import that turns
 * out wrong, a mis-posted stocktake. Every one of those was one tap and
 * irreversible, and the newest backup a shop had was the last one somebody
 * thought to take. Shopkeepers do not think to take backups.
 *
 * So the app takes them: once a day, at day close, and before anything
 * destructive - written to the shop's own Puter storage with the exporter that
 * already exists, and restored through the same previewed, validated path a
 * file restore uses.
 *
 * This module is the pure part: names, retention, and the shape of an index
 * entry. The writing lives in the store, which owns the files.
 */

/** Why a snapshot was taken. The reason rides in its file name and its row. */
export const SNAPSHOT_REASONS = {
  daily: 'Daily',
  close: 'Day close',
  restore: 'Before a restore',
  wipe: 'Before wiping data',
  import: 'Before a catalog import',
  stocktake: 'Before posting a count',
  manual: 'Taken by hand',
};

/**
 * How many are kept.
 *
 * History is already one file per month precisely so an account doesn't fill
 * up; snapshots must not become the thing that fills it. The newest handful
 * are kept whatever they are, then one per week for a few weeks - which is
 * what somebody reaching for a restore point actually wants: fine detail
 * near today, and a way back to "before the month started".
 */
export const KEEP_RECENT = 8;
export const KEEP_WEEKS = 4;

/** Roughly a day. A boot inside this window of the last snapshot takes none. */
export const DAILY_INTERVAL_MS = 20 * 60 * 60 * 1000;

/**
 * Two snapshots a minute apart are one restore point. The floor keeps a shop
 * importing three spreadsheets in a row from writing three near-identical
 * copies of its whole dataset.
 */
export const MIN_GAP_MS = 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * The file a snapshot lives in:
 * `snapshot-2026-08-20-143205817-daily.json`.
 *
 * Built here from a timestamp and a known reason rather than from anything a
 * user typed - the name becomes a path segment, and this app only ever writes
 * paths it designed. Local time, because the shopkeeper reading the list
 * thinks in their own clock.
 *
 * The stamp carries milliseconds. At second resolution two snapshots taken in
 * the same second shared a name: the second overwrote the first on disk while
 * both stayed in the index, so the list showed restore points that were the
 * same file - and pruning one took the other's bytes with it.
 */
export function snapshotName(at, reason) {
  const d = new Date(at);
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
    + String(d.getMilliseconds()).padStart(3, '0');
  const slug = SNAPSHOT_REASONS[reason] ? reason : 'manual';
  return `snapshot-${stamp}-${slug}.json`;
}

/** A snapshot file this app wrote - anything else in the folder is not ours. */
export const SNAPSHOT_FILE = /^snapshot-\d{4}-\d{2}-\d{2}-\d{9}-[a-z]+\.json$/;

/**
 * Index entries, sanitized: a damaged index must not crash the list.
 *
 * One row per file, newest kept: two rows naming one file would show two
 * restore points that are the same bytes, and pruning either would empty
 * both.
 */
export function cleanSnapshots(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s.file === 'string' && SNAPSHOT_FILE.test(s.file))
    .map((s) => ({
      file: s.file,
      at: Number(s.at) || 0,
      reason: SNAPSHOT_REASONS[s.reason] ? s.reason : 'manual',
      bytes: Math.max(0, Math.round(Number(s.bytes) || 0)),
      products: Math.max(0, Math.round(Number(s.products) || 0)),
      receipts: Math.max(0, Math.round(Number(s.receipts) || 0)),
      customers: Math.max(0, Math.round(Number(s.customers) || 0)),
      months: Math.max(0, Math.round(Number(s.months) || 0)),
    }))
    .sort((a, b) => b.at - a.at)
    .filter((s) => {
      if (seen.has(s.file)) return false;
      seen.add(s.file);
      return true;
    });
}

/** The Monday-based week a timestamp falls in, as a sortable key. */
function weekKey(at) {
  const d = new Date(at);
  d.setHours(12, 0, 0, 0);
  // Monday as day 0, so a week doesn't split across a weekend.
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Which snapshots to keep and which to prune, newest first.
 *
 * The newest KEEP_RECENT survive whatever they are. Beyond them, the newest
 * of each week survives for KEEP_WEEKS weeks and the rest go. Pure, so the
 * figure Settings shows for storage is the figure the pruning produces.
 */
export function retentionPlan(list) {
  const entries = cleanSnapshots(list);
  const keep = [];
  const prune = [];
  const weeks = new Set();
  entries.forEach((entry, index) => {
    if (index < KEEP_RECENT) {
      keep.push(entry);
      return;
    }
    const week = weekKey(entry.at);
    if (!weeks.has(week) && weeks.size < KEEP_WEEKS) {
      weeks.add(week);
      keep.push(entry);
      return;
    }
    prune.push(entry);
  });
  return { keep, prune };
}

/** '48 KB' / '2.4 MB' - what a snapshot, or all of them, costs in storage. */
export function formatBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / 1024 / 1024) * 10) / 10} MB`;
}

/**
 * '312 products · 1,847 sales' - what a restore point holds, in one line.
 *
 * Two figures, not four: the row it sits in also carries the reason and the
 * size, and the point of the line is recognizing which restore point this is,
 * not inventorying it.
 */
export function snapshotHolds(entry) {
  return [
    `${entry.products.toLocaleString()} product${entry.products === 1 ? '' : 's'}`,
    `${entry.receipts.toLocaleString()} sale${entry.receipts === 1 ? '' : 's'}`,
  ].join(' · ');
}
