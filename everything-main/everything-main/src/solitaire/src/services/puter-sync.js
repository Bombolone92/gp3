const KV_STATS_KEY = 'stats';
const KV_SAVE_KEY = 'savedGame';

export function puterAvailable() {
  return typeof puter !== 'undefined' && !!puter?.auth && !!puter?.kv;
}

// Never throws and never triggers the sign-in dialog. Everything else in this
// module is gated behind this returning true.
export async function isSignedIn() {
  if (!puterAvailable()) return false;
  try {
    return !!(await puter.auth.isSignedIn());
  } catch {
    return false;
  }
}

// Reports both whether the read succeeded and what it found, because a key
// that has never been written (value: null) is not the same situation as a
// read that failed (ok: false) — callers must not merge/push on the latter,
// or a transient fetch failure can clobber better remote data with stale
// local data that only looks newer because the remote was unreachable.
async function kvGet(key) {
  if (!await isSignedIn()) return { ok: false, value: null };
  try {
    const raw = await puter.kv.get(key);
    return { ok: true, value: raw ? JSON.parse(raw) : null };
  } catch {
    return { ok: false, value: null };
  }
}

async function kvSet(key, value) {
  if (!await isSignedIn()) return false;
  try {
    const payload = JSON.stringify(value);
    const limit = puter.kv.MAX_VALUE_SIZE;
    // The docs do not publish this as a number, so read it rather than assume.
    if (typeof limit === 'number' && payload.length > limit) return false;
    await puter.kv.set(key, payload);
    return true;
  } catch {
    return false;
  }
}

// pullStats/pullSave resolve to { ok, value }. ok is false when the fetch
// itself failed or the caller is signed out — callers must treat that as
// "unknown", not "empty", and must not merge or push on top of it. ok is
// true with value: null when the key legitimately has never been written.
export const pullStats = () => kvGet(KV_STATS_KEY);
export const pushStats = stats => kvSet(KV_STATS_KEY, stats);
export const pullSave = () => kvGet(KV_SAVE_KEY);
export const pushSave = save => kvSet(KV_SAVE_KEY, save);

export async function clearSave() {
  if (!await isSignedIn()) return;
  try {
    await puter.kv.del(KV_SAVE_KEY);
  } catch {
    // Ignore.
  }
}
