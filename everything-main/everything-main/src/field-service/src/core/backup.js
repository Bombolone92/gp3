/** Checks a backup file before a restore replaces anything. */
import { COLLECTIONS } from './store.js';
import { defaultSettings } from './settings.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const NAMED = { team: 'team member', products: 'product or service' };
// The ids the app makes, and the only ones a team server stores: a record
// with any other id would be refused when saved, after the restore had
// already replaced everything.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Returns a message describing the first problem, or null if the backup can be restored. */
export function validateBackup(data) {
  if (!isObj(data) || data.format !== 'field-service-backup' || !isObj(data.collections)) return 'That file is not a Field Service backup.';
  for (const c of COLLECTIONS) {
    const list = data.collections[c];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return `The backup's ${c} are not a list.`;
    for (const r of list) {
      if (!isObj(r) || (r.id !== undefined && (typeof r.id !== 'string' || !ID_RE.test(r.id)))) return `The backup has a damaged record in ${c}.`;
      if (NAMED[c] && typeof r.name !== 'string') return `The backup has a ${NAMED[c]} without a name.`;
    }
  }
  if (data.settings !== undefined && data.settings !== null) {
    if (!isObj(data.settings)) return "The backup's settings are damaged.";
    const defaults = defaultSettings();
    for (const [k, v] of Object.entries(defaults)) {
      const got = data.settings[k];
      if (got === undefined) continue;
      if ((isObj(v) && !isObj(got)) || (Array.isArray(v) && !Array.isArray(got))) return "The backup's settings are damaged.";
    }
  }
  return null;
}
