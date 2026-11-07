/**
 * A word count goal per document ("1,204 / 2,000 words"), kept in
 * localStorage by file path so it is there the next time the document opens.
 */

import { localStore as store } from './storage.js';
import { documentPathKey, migrateDocumentMap } from './document-paths.js';
import { accountKey } from './account-key.js';

const KEY = 'documents:goals';
export const GOAL_MAX = 10000000;

function read(storage) {
  try {
    const key = accountKey(KEY, storage);
    const parsed = JSON.parse(storage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? migrateDocumentMap(storage, key, parsed) : {};
  } catch {
    return {};
  }
}

function write(storage, map) {
  try { storage.setItem(accountKey(KEY, storage), JSON.stringify(map)); } catch { /* storage unavailable */ }
}

/** A typed goal -> a whole number of words, or null to clear (nothing typed, or 0), or NaN when it is not a count. */
export function parseGoal(value) {
  const raw = String(value ?? '').trim().replace(/[,\s]/g, '');
  if (!raw) return null;
  // A count of words: digits only, not "1e3" or "0x10".
  if (!/^\d+$/.test(raw)) return NaN;
  const n = Number(raw);
  if (n === 0) return null;
  return n <= GOAL_MAX ? n : NaN;
}

export function recallGoal(path, { storage = store() } = {}) {
  path = documentPathKey(path);
  if (!path || !storage) return null;
  const n = read(storage)[path];
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Set (a positive number) or clear (null) the goal for a document. */
export function rememberGoal(path, goal, { storage = store() } = {}) {
  path = documentPathKey(path);
  if (!path || !storage) return;
  const map = read(storage);
  if (goal == null) delete map[path];
  else map[path] = goal;
  write(storage, map);
}

export function moveGoal(from, to, { storage = store(), copy = false } = {}) {
  from = documentPathKey(from); to = documentPathKey(to);
  if (!from || !to || from === to || !storage) return;
  const map = read(storage);
  if (!(from in map)) return;
  map[to] = map[from];
  if (!copy) delete map[from];
  write(storage, map);
}

/** "1,204 / 2,000 words" for the status bar, and the share done (0 to 1, capped). */
export function describeGoal(words, goal) {
  const done = goal > 0 ? Math.min(1, words / goal) : 0;
  return { label: `${words.toLocaleString()} / ${goal.toLocaleString()} words`, done, reached: goal > 0 && words >= goal };
}
