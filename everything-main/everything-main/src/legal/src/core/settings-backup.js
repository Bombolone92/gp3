/**
 * Full JSON backups of a firm: every collection plus settings. Document
 * files are not included (only their references), which the backup says.
 */
import { COLLECTIONS } from './store.js';
import { defaultSettings } from './settings.js';

export const BACKUP_APP = 'legal';
export const BACKUP_VERSION = 1;

export function buildBackup({ collections, settings, exportedAt = new Date().toISOString() }) {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt,
    note: 'Document files are not included in this backup; only their names and locations are.',
    settings,
    collections: Object.fromEntries(COLLECTIONS.map((c) => [c, collections[c] || []])),
  };
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const kindOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/**
 * Settings from a file, keeping only values of the type the app expects.
 * Restored settings sync to every device, so a damaged value (a list that is
 * null, a number that is text) would otherwise break screens everywhere.
 * Unknown keys are kept as they are; lists keep only items of the right kind.
 */
function cleanSettings(raw, base) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === '__proto__') continue;
    const d = base[k];
    if (d === undefined) {
      out[k] = v;
      continue;
    }
    const kind = kindOf(d);
    if (kindOf(v) !== kind) continue;
    if (kind === 'object') out[k] = cleanSettings(v, d);
    else if (kind === 'array') {
      const item = d.length ? kindOf(d[0]) : 'object';
      out[k] = v.filter((x) => kindOf(x) === item);
    } else out[k] = v;
  }
  return out;
}

/**
 * Validate a backup file's text. Returns { settings, collections, counts }
 * or throws an Error with a readable message. Unknown collections and
 * records without a usable id are dropped.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP) throw new Error('This file is not a backup from this app.');
  if (Number(data.version) > BACKUP_VERSION) throw new Error('This backup was made by a newer version of the app.');
  const collections = {};
  const counts = {};
  for (const c of COLLECTIONS) {
    const list = Array.isArray(data.collections?.[c]) ? data.collections[c] : [];
    collections[c] = list.filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && ID_RE.test(r.id));
    counts[c] = collections[c].length;
  }
  const settings = kindOf(data.settings) === 'object' ? cleanSettings(data.settings, defaultSettings()) : null;
  // Every amount is formatted in the firm's currency: keep the current one
  // rather than take something that is not a currency code.
  if (settings && 'currency' in settings && !/^[A-Z]{3}$/.test(settings.currency)) delete settings.currency;
  return { settings, collections, counts, exportedAt: data.exportedAt || '' };
}

/** True when the firm has no records that matter (users and accounts alone do not count). */
export function isFirmEmpty(all) {
  return ['matters', 'contacts', 'activities', 'bills', 'transactions'].every((c) => !(all(c) || []).length);
}
