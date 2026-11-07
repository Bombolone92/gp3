/**
 * Starred documents: the ones to keep at the top of the home screen. Stars
 * are remembered on this device by file path for the signed-in account,
 * follow a rename, and go away when the file is deleted.
 */

import { documentPathKey } from './document-paths.js';
import { accountKey } from './account-key.js';

const KEY = 'documents:starred';

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(accountKey(KEY)) || '[]');
    const paths = Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : [];
    const normalized = [...new Set(paths.map(documentPathKey))];
    if (normalized.length !== paths.length || normalized.some((path, i) => path !== paths[i])) write(normalized);
    return normalized;
  } catch {
    return [];
  }
}

function write(paths) {
  try { localStorage.setItem(accountKey(KEY), JSON.stringify([...new Set(paths)])); } catch { /* storage unavailable */ }
}

/** The starred paths, most recently starred last. */
export function starredPaths() {
  return read();
}

export function isStarred(path) {
  return !!path && read().includes(documentPathKey(path));
}

/** Star or unstar a path; resolves the new state. */
export function toggleStar(path) {
  path = documentPathKey(path);
  if (!path) return false;
  const paths = read();
  const on = !paths.includes(path);
  write(on ? [...paths, path] : paths.filter((p) => p !== path));
  return on;
}

/** A renamed or copied file keeps its star; copies also retain the source star. */
export function moveStar(from, to, { copy = false } = {}) {
  from = documentPathKey(from); to = documentPathKey(to);
  if (!from || !to || from === to) return;
  const paths = read();
  if (!paths.includes(from)) return;
  write(copy ? [...paths, to] : paths.map((p) => (p === from ? to : p)));
}

/** A deleted file loses its star. */
export function forgetStar(path) {
  path = documentPathKey(path);
  const paths = read();
  if (paths.includes(path)) write(paths.filter((p) => p !== path));
}

/** Drop stars whose files are gone, given the files that exist now. */
export function pruneStars(files) {
  const have = new Set((files || []).map((f) => documentPathKey(f.path)));
  const paths = read();
  const kept = paths.filter((p) => have.has(p));
  if (kept.length !== paths.length) write(kept);
  return kept;
}

/** Files in the given order, with the starred ones first (in that same order). */
export function starredFirst(files, starred = read()) {
  const set = new Set([...starred].map(documentPathKey));
  const top = [];
  const rest = [];
  for (const f of files) (set.has(documentPathKey(f.path)) ? top : rest).push(f);
  return [...top, ...rest];
}
