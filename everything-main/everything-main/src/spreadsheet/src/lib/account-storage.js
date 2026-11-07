/** Local document data belongs to a Puter account, not to the browser origin. */
const anonymousScope = () => `session:${Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16).padStart(8, '0')).join('')}`;
let scope = anonymousScope();

export function setStorageUser(user) {
  // Puter UUIDs survive username changes. A failed identity lookup must not
  // fall back to a shared namespace or retain the previous account's data.
  scope = typeof user?.uuid === 'string' && user.uuid
    ? `uuid:${user.uuid}`
    : typeof user?.username === 'string' && user.username
      ? `username:${user.username}`
      : anonymousScope();
}

/** Nobody signed in: one stable scope, so a visitor's unsaved sheets survive a reload of this browser. */
export function setGuestStorage() {
  scope = 'guest';
}

export function storageScope() { return scope; }

/** A scope that names an account, as opposed to the guest scope or a throwaway one after a failed lookup. */
export function isAccountScope(s) { return /^(uuid|username):./.test(s); }

/** The guest scope, or the throwaway one used while a signed-in account's identity is unknown: records kept under it follow the account once it is known. */
export function isProvisionalScope(s) { return s === 'guest' || /^session:/.test(s); }

/** Records are spreadsheet:<kind>:account:<owner>:<path>; legacy records have no owner field. */
function belongsToScope(key, prefix) {
  if (!key?.startsWith('spreadsheet:')) return false;
  // Look immediately after the record kind, never farther into a document's title or path.
  const at = key.indexOf(':', 'spreadsheet:'.length);
  return at >= 0 && key.startsWith(prefix, at);
}

/**
 * Somebody signed in after working as a guest: the drafts, recents and
 * permissions this browser kept for the guest belong to that account now.
 * Returns how many records moved (an existing account record is kept).
 */
export function adoptGuestStorage(storage = null) {
  return adoptStorageFrom('guest', storage);
}

/** Records kept under `fromScope` (the guest scope, or a throwaway one while the account was unknown) belong to the current account now. */
export function adoptStorageFrom(fromScope, storage = null) {
  if (!isAccountScope(scope) || fromScope === scope) return 0;
  const store = storage || (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  if (!store) return 0;
  const from = accountStorageKey('', fromScope);
  const to = accountStorageKey('', scope);
  let moved = 0;
  try {
    const keys = [];
    for (let i = 0; i < store.length; i++) { const key = store.key(i); if (belongsToScope(key, from)) keys.push(key); }
    for (const key of keys) {
      const target = key.replace(from, to);
      if (store.getItem(target) == null) { store.setItem(target, store.getItem(key)); moved++; }
      store.removeItem(key);
    }
  } catch { /* storage refused */ }
  return moved;
}

/**
 * An account is being left (a sign-out): every record this browser kept for it goes, the mirror
 * image of adoptStorageFrom. Drafts hold whole spreadsheets, and the recent list holds names and
 * addresses from the drive, so on a shared computer signing out must leave none of it behind.
 * Only the named scope's records are swept: the guest's and any other account's stay, and so do
 * the records kept for this browser rather than for an account (the theme). Call it while that
 * scope is still the current one — signing out hands the app the guest scope. How many went.
 */
export function clearAccountStorage(owner = scope, storage = null) {
  const store = storage || (() => { try { return globalThis.localStorage || null; } catch { return null; } })();
  if (!store || !owner) return 0;
  // The trailing colon of the scope's own prefix keeps uuid:u-1 from matching uuid:u-10.
  const mine = accountStorageKey('', owner);
  let removed = 0;
  try {
    const keys = [];
    for (let i = 0; i < store.length; i++) { const key = store.key(i); if (belongsToScope(key, mine)) keys.push(key); }
    for (const key of keys) { store.removeItem(key); removed++; }
  } catch { /* storage refused */ }
  return removed;
}

export function accountStorageKey(key, owner = scope) {
  return `${key}:account:${encodeURIComponent(owner)}:`;
}
