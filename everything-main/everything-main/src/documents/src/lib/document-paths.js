/** Local settings use one key for the app-relative and verified absolute path. */
export const DOCUMENT_FOLDER = 'Documents';
const roots = new WeakMap();
const provider = () => globalThis.puter;
const validOwner = (owner) => owner && (typeof owner === 'object' || typeof owner === 'function');
const ordinary = (tail) => tail && tail.split('/').every((part) => part && part !== '.' && part !== '..');

export function documentRoot(owner = provider()) {
  return validOwner(owner) ? roots.get(owner) : undefined;
}

/** Only call with a directory path returned for the app's Documents request. */
export function rememberDocumentRoot(root, owner = provider()) {
  if (validOwner(owner) && typeof root === 'string' && root.startsWith('/') && root.length > 1) roots.set(owner, root.replace(/\/+$/, ''));
}

/** An accepted write or directory listing proves these two spellings refer to the same location. */
export function learnDocumentPath(relative, absolute, owner = provider()) {
  if (!relative?.startsWith(`${DOCUMENT_FOLDER}/`) || !absolute?.startsWith('/')) return;
  const tail = relative.slice(DOCUMENT_FOLDER.length + 1);
  if (!ordinary(tail) || !absolute.endsWith(`/${tail}`)) return;
  rememberDocumentRoot(absolute.slice(0, -tail.length - 1), owner);
}

export function documentPathKey(path) {
  const root = documentRoot();
  if (typeof path !== 'string' || !root || !path.startsWith(`${root}/`)) return path;
  const tail = path.slice(root.length + 1);
  return ordinary(tail) ? `${DOCUMENT_FOLDER}/${tail}` : path;
}

/** Migrate old absolute keys; explicit canonical values win ties, newer positions win by timestamp. */
export function migrateDocumentMap(storage, key, map, { timestamps = false } = {}) {
  const root = documentRoot();
  if (!root || !Object.keys(map).some((path) => path.startsWith(`${root}/`))) return map;
  const normalized = Object.create(null);
  let changed = false;
  for (const [path, value] of Object.entries(map)) {
    const target = documentPathKey(path);
    changed ||= target !== path;
    const have = Object.hasOwn(normalized, target);
    const newer = timestamps ? (Number(value?.at) || 0) - (Number(normalized[target]?.at) || 0) : 0;
    if (!have || newer > 0 || (newer === 0 && target === path)) normalized[target] = value;
  }
  if (changed) { try { storage.setItem(key, JSON.stringify(normalized)); } catch { /* storage unavailable */ } }
  return normalized;
}
