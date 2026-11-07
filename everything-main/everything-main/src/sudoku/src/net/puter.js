/**
 * The Puter account, and the cloud storage that comes with it.
 *
 * Puter is optional here by design: the whole game runs from localStorage, and
 * signing in adds carrying your times and your unfinished puzzle between
 * devices. So every function in this module answers rather than throws, and
 * nothing waits on the network before the board is playable.
 *
 * Two rules the rest of the app depends on:
 *
 *   * A read reports whether it *worked*, separately from what it found. A key
 *     that was never written (`value: null`) is not the same as a key that
 *     could not be reached (`ok: false`), and treating a dropped connection as
 *     "you have no saved games" is how sync destroys data.
 *   * Nothing calls `signIn` on its own. The dialog appears when the player
 *     asks for it, never because the app wanted to check something.
 *
 * @see https://docs.puter.com/
 */

const KEY_STATS = 'sudoku:stats';
const KEY_SAVE = 'sudoku:save';

/** The global puter.js exposes, or null when the script never loaded. */
export const getPuter = () => globalThis.puter ?? null;

/** Whether puter.js is present with the pieces this app uses. */
export function isAvailable() {
  const p = getPuter();
  return !!(p && p.auth && p.kv);
}

/**
 * Where this copy of the app is running: 'app' inside a Puter app window,
 * 'gui' on the Puter desktop, 'web' on an ordinary web page.
 * @see https://docs.puter.com/Utils/env/
 */
export const environment = () => getPuter()?.env ?? 'web';

/**
 * Whether the account is managed by the Puter shell around us.
 *
 * When it is, the session is not this app's to end (the player signs out of
 * Puter itself), so the app must not offer a sign-out button that would strand
 * them in a window they cannot sign back into.
 */
export const isHostedSession = () => environment() === 'app' || environment() === 'gui';

/** Signed in? Never opens a dialog, never throws. */
export async function isSignedIn() {
  if (!isAvailable()) return false;
  try {
    return !!(await getPuter().auth.isSignedIn());
  } catch {
    return false;
  }
}

/**
 * Open Puter's sign-in dialog. Only ever called from a player's click.
 * @returns {Promise<boolean>} Whether a session now exists.
 */
export async function signIn() {
  if (!isAvailable()) return false;
  try {
    await getPuter().auth.signIn();
    return await isSignedIn();
  } catch {
    return false; // dismissed, or the popup never opened
  }
}

/** End the session. A no-op where the session is the shell's (see above). */
export async function signOut() {
  if (!isAvailable() || isHostedSession()) return;
  try {
    await getPuter().auth.signOut();
  } catch {
    /* already gone, or offline; either way there is nothing to report */
  }
}

/** The signed-in user, or null. */
export async function getUser() {
  if (!(await isSignedIn())) return null;
  try {
    return (await getPuter().auth.getUser()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Read one JSON value from the account's key-value store.
 * @returns {Promise<{ok: boolean, value: unknown}>} See the module note on why
 *   these are two separate facts.
 */
async function kvGet(key) {
  if (!(await isSignedIn())) return { ok: false, value: null };
  try {
    const raw = await getPuter().kv.get(key);
    if (raw === null || raw === undefined) return { ok: true, value: null };
    return { ok: true, value: typeof raw === 'string' ? JSON.parse(raw) : raw };
  } catch {
    return { ok: false, value: null };
  }
}

/** Write one JSON value. Resolves false when it did not land. */
async function kvSet(key, value) {
  if (!(await isSignedIn())) return false;
  try {
    const payload = JSON.stringify(value);
    // The docs expose the ceiling as a property rather than a documented
    // number, so read it instead of hard-coding a guess.
    const limit = getPuter().kv.MAX_VALUE_SIZE;
    if (typeof limit === 'number' && payload.length > limit) return false;
    await getPuter().kv.set(key, payload);
    return true;
  } catch {
    return false;
  }
}

async function kvDel(key) {
  if (!(await isSignedIn())) return false;
  try {
    await getPuter().kv.del(key);
    return true;
  } catch {
    return false;
  }
}

export const pullStats = () => kvGet(KEY_STATS);
export const pushStats = (stats) => kvSet(KEY_STATS, stats);
export const pullSave = () => kvGet(KEY_SAVE);
export const pushSave = (save) => kvSet(KEY_SAVE, save);
export const clearCloudSave = () => kvDel(KEY_SAVE);
