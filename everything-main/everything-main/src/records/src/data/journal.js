/**
 * A local journal of changes not yet saved to the cloud. Edits land here
 * within a fraction of a second, so closing the tab or losing the network
 * right after an edit loses nothing: the next time the base opens, the
 * journal is replayed over what was loaded.
 *
 * Entry per base: { v: 2, sessions: { sessionId: session } }, where each
 * open of the base (one per tab) keeps its own session, so tabs never
 * overwrite each other's unsaved changes:
 *
 *   { at, version, schema: doc | null, records: { tableId: { recordId: record | null } }, orders: { tableId: { recordId: order } }, edited: { tableId: { recordId: ms } } }
 *
 * version is the cloud copy of base.json the session was based on (known:
 * ids its schema has had, when it saved over another tab's copy); edited
 * tells when each record was changed (or deleted) here; orders holds
 * records that were only moved. Entries written before sessions existed
 * read as one session.
 */
import { openDb } from './backend.js';

/** The sessions of a base's entry: [{ id, ...session }]. */
export function journalSessions(entry) {
  if (!entry) return [];
  if (entry.sessions) return Object.entries(entry.sessions).map(([id, s]) => ({ ...s, id }));
  return [{ ...entry, id: '', legacy: true }];
}

/** An entry from a list of sessions, or null when none are left. */
export function journalEntry(sessions) {
  if (!sessions.length) return null;
  // One from before sessions stays marked so: it has no version.
  return { v: 2, sessions: Object.fromEntries(sessions.map(({ id, ...s }) => [id, s])) };
}

/**
 * The journal's database for an account. Offline the account may not be
 * known: the last one seen in this browser is used, so its unsaved changes
 * are found either way.
 */
export function journalName(user) {
  const key = 'records-journal-account';
  let id = user?.uuid;
  try {
    if (id) localStorage.setItem(key, id);
    else id = localStorage.getItem(key);
  } catch {
    /* storage blocked */
  }
  return `records-journal-${id || 'me'}`;
}

export async function indexedDbJournal(name = 'records-journal') {
  let db;
  try {
    db = await openDb(name, 'pending');
  } catch {
    return memoryJournal();
  }
  const tx = (mode, fn) =>
    new Promise((resolve, reject) => {
      const t = db.transaction('pending', mode);
      const req = fn(t.objectStore('pending'));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  return {
    get: (key) => tx('readonly', (s) => s.get(key)).catch(() => null),
    put: (key, value) => tx('readwrite', (s) => s.put(value, key)).catch(() => {}),
    del: (key) => tx('readwrite', (s) => s.delete(key)).catch(() => {}),
    /**
     * Read and rewrite an entry in one transaction, so tabs writing at the
     * same time never lose each other's sessions. fn gets the entry (or
     * null) and returns the new one, null to delete it or undefined to
     * leave it. The transaction starts synchronously, so a write started
     * as the page unloads still goes through.
     */
    update: (key, fn) =>
      tx('readwrite', (s) => {
        const req = s.get(key);
        req.onsuccess = () => {
          const next = fn(req.result ?? null);
          if (next === null) s.delete(key);
          else if (next !== undefined) s.put(next, key);
        };
        return null;
      }).catch(() => {}),
  };
}

export function memoryJournal() {
  const data = new Map();
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : null;
    },
    async put(key, value) {
      data.set(key, structuredClone(value));
    },
    async del(key) {
      data.delete(key);
    },
    async update(key, fn) {
      const next = fn(data.has(key) ? structuredClone(data.get(key)) : null);
      if (next === null) data.delete(key);
      else if (next !== undefined) data.set(key, structuredClone(next));
    },
  };
}
