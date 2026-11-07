/** Thin access to the Puter SDK, which index.html loads from js.puter.com. */

export function sdk() {
  return typeof window !== 'undefined' ? window.puter : undefined;
}

/** Wait for the deferred SDK script (it runs before modules, but be safe). */
export async function whenReady(timeout = 15000) {
  const start = Date.now();
  while (!sdk()) {
    if (window.__puterFailed || Date.now() - start > timeout) throw new Error('Could not load Puter. Check your connection and try again.');
    await new Promise((r) => setTimeout(r, 50));
  }
  return sdk();
}

/** Inside the Puter desktop the app is always signed in and must not offer sign-out. */
export function isPuterApp() {
  return sdk()?.env === 'app';
}

export async function currentUser() {
  const p = sdk();
  if (!p.auth.isSignedIn()) return null;
  try {
    return await p.auth.getUser();
  } catch {
    return null;
  }
}

export async function profilePicture() {
  try {
    return (await sdk()?.auth?.getProfilePicture?.()) || null;
  } catch {
    return null;
  }
}
