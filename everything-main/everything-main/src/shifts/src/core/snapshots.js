/**
 * Automatic restore points.
 *
 * Every collection lives under one namespace in one key-value store, and
 * several ordinary actions replace it wholesale: restoring a backup,
 * wiping sample data, importing in bulk. Undo covers exactly one action
 * and is deliberately cleared by those very operations, so until now the
 * only real safety net was a JSON file somebody remembered to download.
 *
 * A snapshot is the same payload buildBackup produces, written as a file
 * to the user's own storage rather than into the KV documents the app
 * loads on every start. The newest ten are kept and the rest pruned. An
 * index file holds each one's date, reason, and contents, so the restore
 * list can describe them without reading ten files.
 *
 * The whole thing is deliberately quiet: no badges, no nagging, and
 * nothing here ever blocks or fails the action it is protecting.
 */
import { buildBackup, backupCounts, validateBackup } from './backup.js';
import { isoDate, isoToday } from '../lib/time.js';

export const SNAPSHOT_DIR = 'shifts-snapshots';
export const SNAPSHOT_LIMIT = 10;
const INDEX_FILE = 'index.json';

/** Why a snapshot was taken, for the line the restore list shows. */
export const SNAPSHOT_REASONS = {
  daily: 'first change of the day',
  manual: 'taken by hand',
  import: 'before restoring a backup',
  restore: 'before restoring a snapshot',
  sample: 'before loading sample data',
  wipe: 'before wiping sample data',
};

export function describeReason(reason) {
  return SNAPSHOT_REASONS[reason] ?? 'automatic';
}

/** A file name that sorts by time and carries its own reason. */
export function snapshotName(at, reason) {
  const stamp = String(at).replace(/[:.]/g, '-');
  const safeReason = /^[a-z]+$/.test(String(reason)) ? reason : 'auto';
  return `snapshot-${stamp}-${safeReason}.json`;
}

export function parseSnapshotName(name) {
  const match = /^snapshot-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-([a-z]+)\.json$/.exec(
    String(name ?? '')
  );
  if (!match) return null;
  const [, date, h, m, s, ms, reason] = match;
  return { at: `${date}T${h}:${m}:${s}.${ms}Z`, date, reason };
}

/**
 * A snapshot store over a small filesystem adapter:
 *
 *   list()            -> Promise<string[]> of file names in the folder
 *   read(name)         -> Promise<string> file contents
 *   write(name, text)  -> Promise<void>
 *   remove(name)       -> Promise<void>
 *
 * `now` and `online` are injected so the whole thing is testable and so
 * a snapshot never queues a write while the network is down: skipping is
 * the right answer there, and the caller carries on regardless.
 */
export function createSnapshotStore(
  fs,
  { limit = SNAPSHOT_LIMIT, now = () => new Date().toISOString(), online = () => true } = {}
) {
  /** Cached across a session so the daily check costs one read, not one per change. */
  let cachedIndex = null;

  async function readIndex() {
    if (cachedIndex) return cachedIndex;
    let entries = [];
    try {
      const raw = await fs.read(INDEX_FILE);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) entries = parsed.filter((e) => e && typeof e.name === 'string');
    } catch {
      // No index yet, or one that cannot be read: rebuild what can be
      // known from the file names themselves, which carry date and reason.
      try {
        const names = await fs.list();
        // The name carries the UTC date; the daily check and save() both
        // work in the local day, so derive it from the timestamp instead.
        entries = names
          .filter((name) => parseSnapshotName(name))
          .map((name) => {
            const { at, reason } = parseSnapshotName(name);
            return { name, at, date: isoDate(new Date(at)), reason, counts: null };
          });
      } catch {
        entries = [];
      }
    }
    entries.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    cachedIndex = entries;
    return entries;
  }

  /** An entry's own local day, falling back to the timestamp it carries. */
  function localDate(entry) {
    if (entry?.date) return entry.date;
    try {
      return isoDate(new Date(entry.at));
    } catch {
      return String(entry?.at ?? '').slice(0, 10);
    }
  }

  async function writeIndex(entries) {
    cachedIndex = entries;
    await fs.write(INDEX_FILE, JSON.stringify(entries, null, 2));
  }

  return {
    /** Newest first: [{ name, at, date, reason, counts }]. */
    async list() {
      return [...(await readIndex())];
    },

    /** True when the day already has a snapshot, for the daily trigger. */
    async hasSnapshotOn(dateISO) {
      const entries = await readIndex();
      return entries.some((entry) => localDate(entry) === dateISO);
    },

    /**
     * Writes a snapshot of `state` and prunes the oldest beyond the
     * limit. Returns the new entry, or null when it was skipped (which
     * is what offline means here). Never throws for the caller's sake:
     * a failed restore point must not fail the action it protects.
     */
    async save(state, reason = 'manual') {
      if (!online()) return null;
      const at = now();
      const name = snapshotName(at, reason);
      const payload = buildBackup(state, { exportedAt: at });
      try {
        await fs.write(name, JSON.stringify(payload));
        const entry = {
          name,
          at,
          // The calendar day the person taking it would call it, not the
          // UTC one: at 23:30 those differ, and both the daily check and
          // the restore list would otherwise be a day out.
          date: isoDate(new Date(at)),
          reason,
          counts: backupCounts(payload),
        };
        const kept = [entry, ...(await readIndex()).filter((e) => e.name !== name)];
        const pruned = kept.slice(limit);
        await writeIndex(kept.slice(0, limit));
        // Pruning is bookkeeping: a file that refuses to go is not worth
        // failing a snapshot over, it just stops being listed.
        for (const old of pruned) {
          try {
            await fs.remove(old.name);
          } catch {
            /* left behind on purpose */
          }
        }
        return entry;
      } catch (err) {
        console.error('Snapshot failed', err);
        return null;
      }
    },

    /**
     * The backup document inside a snapshot, validated the same way an
     * imported file is. Throws with a readable message when the file is
     * missing or unusable.
     */
    async read(name) {
      let data;
      try {
        data = JSON.parse(await fs.read(name));
      } catch {
        throw new Error('That restore point could not be read.');
      }
      const errors = validateBackup(data);
      if (errors.length > 0) throw new Error(errors[0]);
      return data;
    },

    /** Forgets the cached index, so the next list re-reads storage. */
    invalidate() {
      cachedIndex = null;
    },
  };
}

/**
 * The light half of the schedule: one restore point on the first change
 * of a day. Subscribe after the store has loaded, so opening the app is
 * not itself a change, and it is attempted once per session, so a busy
 * day costs one read of the index rather than one per edit.
 *
 * Returns the unsubscribe function.
 */
export function watchForDailySnapshot(store, snapshots, { today = isoToday, online = () => true } = {}) {
  let attempted = false;
  return store.subscribe(() => {
    if (attempted || !online()) return;
    attempted = true;
    (async () => {
      if (await snapshots.hasSnapshotOn(today())) return;
      await snapshots.save(store.state, 'daily');
    })().catch((err) => console.error('Daily restore point failed', err));
  });
}

/**
 * Snapshot storage backed by Puter's filesystem, which the share
 * feature already depends on. Missing folders read as empty rather than
 * as an error: the first snapshot creates the folder on the way in.
 */
export function createPuterSnapshotFS(puterInstance) {
  const fs = () => {
    const p = puterInstance ?? globalThis.puter;
    if (!p?.fs) throw new Error('Puter storage is not available.');
    return p.fs;
  };
  /**
   * Names come from an index file, which is data rather than code: a
   * name carrying a slash or a parent reference would reach outside the
   * snapshot folder, so only plain file names are ever joined onto it.
   */
  const path = (name) => {
    if (!/^[A-Za-z0-9._-]+$/.test(String(name)) || name === '.' || name === '..') {
      throw new Error('Invalid snapshot name.');
    }
    return `${SNAPSHOT_DIR}/${name}`;
  };

  return {
    async list() {
      try {
        const items = await fs().readdir(SNAPSHOT_DIR);
        return (items ?? []).map((item) => item?.name ?? String(item)).filter(Boolean);
      } catch {
        return [];
      }
    },
    async read(name) {
      const blob = await fs().read(path(name));
      if (typeof blob === 'string') return blob;
      if (blob && typeof blob.text === 'function') return blob.text();
      throw new Error('Unreadable snapshot file.');
    },
    async write(name, text) {
      await fs().write(path(name), text, { createMissingParents: true, overwrite: true });
    },
    async remove(name) {
      await fs().delete(path(name));
    },
  };
}

/** In-memory snapshot storage, for tests. */
export function createMemorySnapshotFS(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      if (!files.has(name)) throw new Error(`No such file: ${name}`);
      return files.get(name);
    },
    async write(name, text) {
      files.set(name, text);
    },
    async remove(name) {
      files.delete(name);
    },
    /** Test helper. */
    peek() {
      return [...files.keys()];
    },
  };
}
