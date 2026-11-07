/**
 * Backups: settings plus every record, as one JSON document.
 *
 * Collections are written under their physical names (the ledger as
 * monthly 'tx.YYYY-MM' collections), which keeps a backup a faithful copy
 * of what is stored. Restoring accepts physical or logical names.
 */
import { COLLECTIONS, logicalName } from './store.js';

// Record ids the store and the team server accept, and a real calendar date.
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE = /^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const BACKUP_FORMAT = 'property-management-backup';
export const BACKUP_VERSION = 1;

export function exportBackup(store, { now = new Date().toISOString() } = {}) {
  const collections = {};
  for (const phys of store.physicalCollections()) {
    const records = store.physicalRecords(phys);
    if (records.length) collections[phys] = records;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now, settings: store.state.settings, collections };
}

/**
 * Check a parsed backup. Returns { ok, error?, count, byCollection } where
 * byCollection maps logical collection -> records.
 */
export function validateBackup(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'That file is not a backup.' };
  if (data.format !== BACKUP_FORMAT) return { ok: false, error: 'That file is not a Property Management backup.' };
  if (Number(data.version) > BACKUP_VERSION) return { ok: false, error: 'This backup was made by a newer version of the app.' };
  if (!data.collections || typeof data.collections !== 'object') return { ok: false, error: 'The backup has no records.' };
  const byCollection = {};
  let count = 0;
  for (const [name, records] of Object.entries(data.collections)) {
    const coll = COLLECTIONS.includes(name) ? name : logicalName(name);
    if (!coll || !COLLECTIONS.includes(coll)) continue;
    if (!Array.isArray(records)) return { ok: false, error: `The "${name}" section of the backup is damaged.` };
    const good = records.filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id);
    // Everything is checked before anything is replaced: a record the store
    // or the team server would refuse must not stop a restore halfway.
    const badId = good.find((r) => !ID.test(r.id));
    if (badId) return { ok: false, error: `The backup has a record this app cannot store (id "${badId.id.slice(0, 40)}").` };
    if (coll === 'transactions' && good.some((t) => !Array.isArray(t.lines) || !DATE.test(String(t.date || '').slice(0, 10)))) {
      return { ok: false, error: 'Some transactions in the backup are damaged.' };
    }
    (byCollection[coll] ||= []).push(...good);
    count += good.length;
  }
  return { ok: true, count, byCollection, settings: data.settings && typeof data.settings === 'object' ? data.settings : null };
}

/**
 * Restore a backup. mode 'replace' removes every current record first;
 * 'merge' adds the backup's records and overwrites ones with the same id.
 * Returns { count }.
 */
export function importBackup(store, data, { mode = 'replace' } = {}) {
  const v = validateBackup(data);
  if (!v.ok) throw new Error(v.error);
  if (mode === 'replace') {
    for (const c of COLLECTIONS) {
      const ids = store.all(c).map((r) => r.id);
      if (ids.length) store.bulkRemove(c, ids);
    }
  }
  for (const [c, records] of Object.entries(v.byCollection)) if (records.length) store.bulkPut(c, records);
  if (v.settings && mode === 'replace') store.saveSettings({ ...v.settings, onboarded: true });
  return { count: v.count };
}

/** Record counts per logical collection. */
export function recordCounts(store) {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, store.all(c).length]));
}
