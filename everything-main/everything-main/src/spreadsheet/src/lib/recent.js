/**
 * Recently opened spreadsheets, kept on this device so files opened from
 * elsewhere on the Puter drive (not in the app folder) can be found again.
 * Each record keeps the file's id as well as its address: a file keeps its id
 * when it is moved or renamed (here, on the desktop or by another app), so the
 * record follows it there rather than pointing at where it used to be.
 */

import { accountStorageKey } from './account-storage.js';
import { inAppFolder, inTrash, statByUid } from './puter.js';

const KEY = 'spreadsheet:recent';
const LIMIT = 8;

function browserStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function read(storage) {
  try {
    const list = JSON.parse(storage.getItem(accountStorageKey(KEY)) || '[]');
    return Array.isArray(list) ? list.filter((x) => x && typeof x.path === 'string') : [];
  } catch { return []; }
}

function write(storage, list) {
  try { storage.setItem(accountStorageKey(KEY), JSON.stringify(list.slice(0, LIMIT))); } catch { /* no storage */ }
}

const fileName = (path) => path.split('/').pop();

/** The list, newest first. */
export function recentFiles(storage = browserStorage()) {
  if (!storage) return [];
  return read(storage);
}

/**
 * Note that a file was opened (moving it to the front). `file` is its address, or
 * { path, uid } when its id on the drive is known.
 */
export function rememberRecent(file, name, storage = browserStorage()) {
  const { path, uid = null } = typeof file === 'string' ? { path: file } : (file || {});
  if (!storage || !path) return;
  // The same file under an older address is the same entry.
  const others = read(storage).filter((x) => x.path !== path && !(uid && x.uid === uid));
  // Files in the app folder are always in the list on the home screen; only those opened
  // from elsewhere need remembering, and they must not be pushed out by ordinary opens.
  if (inAppFolder(path)) {
    if (uid && others.length !== read(storage).length) write(storage, others); // moved into the app folder: listed there now
    return;
  }
  write(storage, [{ path, name: name || fileName(path), ...(uid ? { uid } : {}), at: Date.now() }, ...others]);
}

/** Drop a file that no longer opens. */
export function forgetRecent(path, storage = browserStorage()) {
  if (!storage) return;
  write(storage, read(storage).filter((x) => x.path !== path));
}

/**
 * Look each remembered file up by its id and bring its record up to date: a file moved or
 * renamed is listed where it is now, and one deleted (or in the trash) is dropped. A file
 * moved into the app folder is dropped too, as the home screen lists it there. A look-up
 * that fails for another reason (offline, say) is no answer about the file and leaves its
 * record as it was; so does a record from before ids were kept. Resolves to the list.
 */
export async function refreshRecent(storage = browserStorage()) {
  if (!storage) return [];
  const before = read(storage);
  const found = await Promise.all(before.map(async (r) => {
    if (!r.uid) return r;
    let st;
    try { st = await statByUid(r.uid); } catch { return r; }
    if (!st?.path || st.is_dir || inTrash(st.path) || inAppFolder(st.path)) return null;
    return st.path === r.path ? r : { ...r, path: st.path, name: st.name || fileName(st.path) };
  }));
  // The list may have changed while the drive was asked: entries added meanwhile stay, and
  // only the records looked up are replaced (or dropped).
  const key = (r) => `${r.path}\n${r.uid || ''}\n${r.at}`;
  const looked = new Map(before.map((r, i) => [key(r), found[i]]));
  const now = read(storage);
  const next = [];
  const seen = new Set();
  for (const r of now) {
    const updated = looked.has(key(r)) ? looked.get(key(r)) : r;
    if (!updated || seen.has(updated.path)) continue;
    seen.add(updated.path);
    next.push(updated);
  }
  if (JSON.stringify(next) !== JSON.stringify(now)) write(storage, next);
  return next;
}
