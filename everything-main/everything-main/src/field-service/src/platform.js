/**
 * Everything that touches Puter directly (besides KV inside the backend):
 * auth, environment, profile pictures.
 */
const PIC_KEY = 'fieldservice.profilePicture';

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

/** Inside the Puter desktop the user is always signed in and can't sign out. */
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
    puter.auth.signOut();
  } catch {}
}

export async function getUser() {
  return puter.auth.getUser();
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

export function clearProfilePicture() {
  try {
    localStorage.removeItem(PIC_KEY);
  } catch {}
}
