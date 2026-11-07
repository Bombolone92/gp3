/**
 * Stars, word goals and reading positions are kept on the device by file
 * path. Two people sharing a device must not see, or prune, each other's:
 * each signed-in account gets keys of its own, and whoever is signed out
 * uses the plain key. The first account to sign in on a device takes over
 * what the device kept before accounts were told apart.
 */

import { session } from './session.js';

/** The storage key for `base` under the signed-in account, or `base` itself when nobody is. */
export function accountKey(base, storage = globalThis.localStorage) {
  const user = session.user;
  const id = user && (user.uuid || user.username);
  if (!id) return base;
  const key = `${base}:${String(id)}`;
  try {
    if (storage && storage.getItem(key) == null) {
      const inherited = storage.getItem(base);
      if (inherited != null) { storage.setItem(key, inherited); storage.removeItem?.(base); }
    }
  } catch { /* storage unavailable */ }
  return key;
}
