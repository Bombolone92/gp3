/**
 * Everything that touches Puter directly (besides KV inside the backend):
 * auth, environment, profile pictures.
 */
const PIC_KEY = 'legal.profilePicture';
const USER_KEY = 'legal.user';

export function puterAvailable() {
  return typeof globalThis.puter !== 'undefined';
}

export function puterEnv() {
  try {
    return globalThis.puter?.env || 'web';
  } catch {
    return 'web';
  }
}

/** Inside the Puter desktop ('app' env) the person is always signed in and cannot sign out. */
export function canSignOut() {
  return puterEnv() !== 'app';
}

export async function isSignedIn() {
  if (!puterAvailable()) return false;
  try {
    return (await Promise.resolve(puter.auth.isSignedIn())) === true;
  } catch {
    return false;
  }
}

export async function signIn() {
  await puter.auth.signIn();
}

export function signOut() {
  try {
    localStorage.removeItem(USER_KEY);
    // The firm list kept for opening offline names firms and their servers.
    for (const k of Object.keys(localStorage)) if (k.startsWith('legal.workspaces.')) localStorage.removeItem(k);
  } catch {}
  try {
    puter.auth.signOut();
  } catch {}
}

/**
 * The signed-in account. Offline, the account last seen on this device, so
 * the app can open from its local copy and sync once the connection returns.
 */
export async function getUser() {
  try {
    const user = await puter.auth.getUser();
    try {
      localStorage.setItem(USER_KEY, JSON.stringify({ username: user.username, uuid: user.uuid }));
    } catch {}
    return user;
  } catch (err) {
    if (globalThis.navigator?.onLine === false) {
      try {
        const cached = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
        if (cached?.uuid && cached?.username) return cached;
      } catch {}
    }
    throw err;
  }
}

/**
 * Profile picture as a data URL, cached per user so the avatar appears
 * instantly on the next visit. Only data: images are accepted.
 */
export function cachedProfilePicture(username) {
  try {
    const raw = JSON.parse(localStorage.getItem(PIC_KEY) || 'null');
    return raw && raw.user === username ? raw.url : null;
  } catch {
    return null;
  }
}

export async function fetchProfilePicture(username) {
  try {
    const url = await puter.auth.getProfilePicture?.();
    if (typeof url === 'string' && url.startsWith('data:image/') && url.length < 2_000_000) {
      try {
        localStorage.setItem(PIC_KEY, JSON.stringify({ user: username, url }));
      } catch {}
      return url;
    }
  } catch {}
  return null;
}
