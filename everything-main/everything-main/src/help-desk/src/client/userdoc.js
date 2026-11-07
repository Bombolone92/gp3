/**
 * Each user's own record of the help desks they belong to, kept in their
 * own key-value store (`hdu:me`) so it follows them across devices:
 *
 *   desks:  { "<server>/<desk>": { server, desk, name, role, at } }
 *   server: the server this user deployed, if any { name, path, build }
 *   last:   the desk they used most recently
 */
import { sdk } from './puter.js';
import { USER_DOC_KEY } from '../shared/keys.js';

export const deskRef = (server, desk) => `${server}/${desk}`;

/** Path-safe key for a desk inside the document. */
const pathKey = (ref) => `["${ref.replace(/["\\]/g, '\\$&')}"]`;

export async function loadUserDoc() {
  const doc = (await sdk().kv.get(USER_DOC_KEY)) || {};
  return { desks: doc.desks || {}, server: doc.server || null, last: doc.last || null, prefs: doc.prefs || {} };
}

export async function rememberDesk(entry) {
  const ref = deskRef(entry.server, entry.desk);
  await sdk().kv.update(USER_DOC_KEY, {
    [`desks.${pathKey(ref)}`]: { server: entry.server, desk: entry.desk, name: entry.name, role: entry.role, at: Date.now() },
    last: ref,
  });
  return ref;
}

export async function forgetDesk(ref) {
  await sdk().kv.remove(USER_DOC_KEY, `desks.${pathKey(ref)}`);
}

export async function setLast(ref) {
  await sdk().kv.update(USER_DOC_KEY, { last: ref });
}

export async function saveServer(server) {
  await sdk().kv.update(USER_DOC_KEY, { server });
}

export async function savePref(name, value) {
  await sdk().kv.update(USER_DOC_KEY, { [`prefs.${name}`]: value });
}
