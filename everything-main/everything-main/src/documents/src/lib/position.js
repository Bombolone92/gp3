/**
 * Where you left off: the caret's block and offset per document, kept in
 * localStorage so reopening a long document goes back to the same place.
 * Positions are keyed by file path, follow renames, and the list is trimmed
 * to the most recent documents.
 */

import { localStore as store } from './storage.js';
import { documentPathKey, migrateDocumentMap } from './document-paths.js';
import { accountKey } from './account-key.js';

const KEY = 'documents:positions';
export const MAX_POSITIONS = 60;

function read(storage) {
  try {
    const key = accountKey(KEY, storage);
    const parsed = JSON.parse(storage.getItem(key) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? migrateDocumentMap(storage, key, parsed, { timestamps: true }) : {};
  } catch {
    return {};
  }
}

function write(storage, map) {
  try { storage.setItem(accountKey(KEY, storage), JSON.stringify(map)); } catch { /* storage full or unavailable */ }
}

/** Keep the caret's place for a document. Nothing is stored for the very start. */
export function rememberPosition(path, { blockId, offset = 0 } = {}, { storage = store(), now = Date.now() } = {}) {
  path = documentPathKey(path);
  if (!path || !blockId || !storage) return;
  const map = read(storage);
  map[path] = { blockId, offset: Math.max(0, Number(offset) || 0), at: now };
  // A foreign or damaged entry has no timestamp; it must not throw here on every caret move.
  const keys = Object.keys(map).sort((a, b) => (Number(map[b]?.at) || 0) - (Number(map[a]?.at) || 0));
  for (const k of keys.slice(MAX_POSITIONS)) delete map[k];
  write(storage, map);
}

/** The stored place for a document, or null. */
export function recallPosition(path, { storage = store() } = {}) {
  path = documentPathKey(path);
  if (!path || !storage) return null;
  const p = read(storage)[path];
  return p && typeof p.blockId === 'string' ? { blockId: p.blockId, offset: Math.max(0, Number(p.offset) || 0), at: p.at || 0 } : null;
}

export function forgetPosition(path, { storage = store() } = {}) {
  path = documentPathKey(path);
  if (!path || !storage) return;
  const map = read(storage);
  if (!(path in map)) return;
  delete map[path];
  write(storage, map);
}

/** A renamed or copied document keeps its place; copies retain the source entry. */
export function movePosition(from, to, { storage = store(), copy = false } = {}) {
  from = documentPathKey(from); to = documentPathKey(to);
  if (!from || !to || from === to || !storage) return;
  const map = read(storage);
  if (!map[from]) return;
  map[to] = map[from];
  if (!copy) delete map[from];
  write(storage, map);
}
