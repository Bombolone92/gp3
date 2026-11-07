/**
 * Workspace references. A workspace lives on its owner's worker, so the app
 * names it by both: `{wsId}@{server}` where `server` is the worker's name on
 * puter.work (teamchat-x7k2q9pw1a) or, for a worker elsewhere, its host. The
 * reference is what routes, invite links, and the user's workspace list
 * carry, so a link is enough to find a workspace without any lookup.
 *
 *   #/ws/abc123def0@teamchat-x7k2q9pw1a/c/...
 *   #/join/teamchat-x7k2q9pw1a/XXXX-XXXX-XXXX
 *
 * Every call to a worker goes through puter.workers.exec(), which attaches
 * the signed-in user's Puter token to the request whatever the host is. A
 * link therefore decides where that token is sent, so the hosts a reference
 * may name are limited: a puter.work worker (any name; that is the design,
 * a workspace's members talk to its owner's worker), or a host the app was
 * explicitly told about (the configured shared worker, the user's own
 * worker as Puter reports it). A reference to any other host does not parse.
 *
 * Shared with the dev harness; no browser globals here.
 */

const PUTER_WORK = '.puter.work';

/** Hosts outside puter.work the app may call (see trustServer). */
const trusted = new Set();

/** Compact server token for a worker URL: its puter.work name, or its host. */
export function serverKeyOf(url) {
  // The scheme in any case: a URL typed or pasted as HTTPS:// is the same
  // address, and left on, "https:" was the key (trustServer strips it in any
  // case already).
  const host = String(url || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!host) return null;
  return host.endsWith(PUTER_WORK) ? host.slice(0, -PUTER_WORK.length) : host;
}

/**
 * Allow a host outside puter.work: the configured shared worker, or the
 * user's own worker as Puter reports it. Takes a URL or a server key.
 */
export function trustServer(urlOrKey) {
  const s = String(urlOrKey || '');
  const key = /^https?:\/\//i.test(s) ? serverKeyOf(s) : s.toLowerCase();
  if (key && isServerKey(key)) trusted.add(key);
  return key;
}

/** Is this a server the app may send the user's session to? */
export function isTrustedServer(key) {
  const k = String(key || '').toLowerCase();
  if (!isServerKey(k)) return false;
  // A bare name is a puter.work worker; anything with a dot or a port is a
  // host of its own and needs to have been trusted explicitly.
  return !(k.includes('.') || k.includes(':')) || trusted.has(k);
}

/** Worker URL for a server token (inverse of serverKeyOf); null when the server may not be called. */
export function serverUrl(key) {
  let k = String(key || '').toLowerCase();
  if (k.endsWith(PUTER_WORK)) k = k.slice(0, -PUTER_WORK.length);
  if (!k || !isTrustedServer(k)) return null;
  return k.includes('.') || k.includes(':') ? `https://${k}` : `https://${k}${PUTER_WORK}`;
}

export function isServerKey(key) {
  return /^[a-z0-9][a-z0-9._:-]{0,120}$/.test(String(key || ''));
}

export function makeRef(wsId, server) {
  return `${wsId}@${server}`;
}

/**
 * One spelling of a reference, the one the workers' answers are filed under
 * (see parseRef): the server in lower case and by its short name. A link
 * typed or pasted the long way (`…@teamchat-x.puter.work`) or with capitals
 * names the same workspace, and compared as a string it did not read as
 * the one on the list. Null for what is not a reference at all.
 */
export function canonicalRef(ref) {
  const r = parseRef(ref);
  return r ? makeRef(r.id, r.server) : null;
}

/** Split a reference into { id, server, url }; null when malformed or when the server may not be called. */
export function parseRef(ref) {
  const s = String(ref || '');
  const at = s.lastIndexOf('@');
  if (at <= 0) return null;
  const id = s.slice(0, at);
  // One spelling per worker: `teamchat-abc` and `teamchat-abc.puter.work`
  // are the same server, and a reference typed the long way must compare
  // equal to the one the worker's own answer is filed under.
  let server = s.slice(at + 1).toLowerCase();
  if (server.endsWith(PUTER_WORK)) server = server.slice(0, -PUTER_WORK.length);
  if (!/^[a-z0-9]{6,20}$/.test(id) || !isServerKey(server)) return null;
  const url = serverUrl(server);
  if (!url) return null;
  return { id, server, url };
}

/** Invite token: `CODE@server`, what the invite dialog shows as the code. */
export function makeInviteToken(code, server) {
  return `${code}@${server}`;
}
