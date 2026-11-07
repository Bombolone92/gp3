/**
 * Whole-company backup as one JSON document, and restore from one. A backup
 * is validated completely before anything is written, so a damaged file
 * never leaves the books half-replaced.
 */
import { COLLECTIONS } from './store.js';
import { TXN_TYPES } from './txn.js';
import { ACCOUNT_TYPES } from './accounts.js';

export const BACKUP_FORMAT = 'puter-bookkeeping-backup';

export function exportBackup(store) {
  const collections = {};
  for (const name of Object.keys(COLLECTIONS)) collections[name] = [...store[name].values()];
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), settings: store.settings, collections };
}

/** Throws with a readable message when the backup cannot be restored. */
export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('This file is not a backup.');
  if (data.format !== BACKUP_FORMAT) throw new Error('This file is not an Accounting backup.');
  if (data.version !== 1) throw new Error(`Backup version ${data.version} is not supported.`);
  const c = data.collections || {};
  for (const name of Object.keys(c)) {
    if (!COLLECTIONS[name]) throw new Error(`Unknown section in backup: ${name}.`);
    if (!Array.isArray(c[name])) throw new Error(`The ${name} section is damaged.`);
    for (const r of c[name]) if (!r || typeof r.id !== 'string' || !r.id || r.id.includes(':')) throw new Error(`A record in ${name} has no valid id.`);
  }
  for (const a of c.accounts || []) if (!ACCOUNT_TYPES[a.type]) throw new Error(`Account ${a.name} has an unknown type.`);
  for (const t of c.txns || []) if (!TXN_TYPES[t.type]) throw new Error(`A transaction has an unknown type: ${t.type}.`);
  return true;
}

export function restoreBackup(store, data) {
  validateBackup(data);
  store.batch(({ put, remove }) => {
    for (const name of Object.keys(COLLECTIONS)) for (const id of [...store[name].keys()]) remove(name, id);
    for (const [name, list] of Object.entries(data.collections || {})) for (const r of list) put(name, r);
  });
  store.saveSettings(data.settings || {});
}

/** Remove every record (used by "Erase all data"). */
export function eraseAll(store) {
  store.batch(({ remove }) => {
    for (const name of Object.keys(COLLECTIONS)) for (const id of [...store[name].keys()]) remove(name, id);
  });
}
