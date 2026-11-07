/**
 * Collaboration protocol pieces shared by the browser and the worker:
 * roles, identifiers, hashing and ECDSA signing, server addresses and
 * share links.
 */
export const PROTOCOL = 1;
/** How long a presence entry (and the peer ticket it carries) lasts without a check-in. */
export const SESSION_TTL = 60_000;
export const ID = /^[A-Za-z0-9_-]{1,100}$/;
export const enc = new TextEncoder();

/** Roles, most capable first. Commenters discuss but do not edit; viewers only look. */
export const ROLES = ['owner', 'editor', 'commenter', 'viewer'];
export const INVITE_ROLES = ['editor', 'commenter', 'viewer'];
export const canEdit = (role) => role === 'owner' || role === 'editor';
export const canComment = (role) => canEdit(role) || role === 'commenter';
export const canManage = (role) => role === 'owner';
export const ROLE_LABELS = { owner: 'Owner', editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' };

/** Participant colors: distinct hues that read on light and dark canvases. */
export const PARTICIPANT_COLORS = ['#d9480f', '#1971c2', '#2b8a3e', '#ae3ec9', '#e8590c', '#0c8599', '#c2255c', '#5f3dc4', '#5c940d', '#1864ab'];

export function colorFor(key) {
  let h = 2166136261;
  for (const ch of String(key || '')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return PARTICIPANT_COLORS[Math.abs(h) % PARTICIPANT_COLORS.length];
}

export function initials(name) {
  const s = String(name || '?').trim();
  return (s.match(/[A-Za-z0-9]/)?.[0] || s[0] || '?').toUpperCase();
}

export function encode(bytes) {
  let text = '';
  for (let n = 0; n < bytes.length; n += 8192) text += String.fromCharCode(...bytes.subarray(n, n + 8192));
  return btoa(text);
}

export function decode(value, max = Infinity) {
  if (typeof value !== 'string' || value.length > max || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid collaboration data.');
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? enc.encode(value) : value);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export async function keyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
  };
}

// Imported keys by JWK: peers sign and verify many packets with the same few keys.
const imported = new Map();
function importKey(jwk, usage) {
  const id = usage + JSON.stringify(jwk);
  let key = imported.get(id);
  if (!key) {
    if (imported.size >= 512) imported.delete(imported.keys().next().value);
    key = crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [usage]);
    imported.set(id, key);
    key.catch(() => {
      if (imported.get(id) === key) imported.delete(id);
    });
  }
  return key;
}

export async function sign(key, value) {
  const k = await importKey(key, 'sign');
  return encode(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(JSON.stringify(value)))));
}

export async function verify(key, value, signature) {
  try {
    const k = await importKey(key, 'verify');
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k, decode(signature, 200), enc.encode(JSON.stringify(value)));
  } catch {
    return false;
  }
}

/** A collaboration server address: an https *.puter.work origin. */
export function workerURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.puter\.work$/.test(url.hostname) || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid collaboration server address.');
  }
  return url.origin;
}

/** Link to a shared document; `invite` grants access to people who are not members yet. */
export function shareLink(server, room, invite = null, base = typeof location !== 'undefined' ? location.href : 'https://vector-studio.puter.site/') {
  const url = new URL(base);
  url.hash = new URLSearchParams({ server: new URL(workerURL(server)).hostname, doc: room, ...(invite ? { invite } : {}) }).toString();
  return url.href;
}

/** { server, room, invite } from a share link (or its hash), or null when it is not one. */
export function parseShareLink(value, base = typeof location !== 'undefined' ? location.href : 'https://vector-studio.puter.site/') {
  try {
    const url = new URL(value, base);
    const p = new URLSearchParams(url.hash.slice(1));
    const room = p.get('doc');
    const host = p.get('server');
    if (!room || !host || !ID.test(room)) return null;
    return { server: workerURL(`https://${host}`), room, invite: p.get('invite') || null };
  } catch {
    return null;
  }
}
