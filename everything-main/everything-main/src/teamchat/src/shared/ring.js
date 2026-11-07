/**
 * Change entries carried by events, shared by the worker (which seals them)
 * and the client (which opens them). Each conversation has a root key the
 * worker derives and hands only to people who can read it (the bootstrap's
 * `ring.ek`); from it come an opaque tag naming the conversation in a ring
 * entry and the AES-GCM key its payload is sealed with. Threads use their
 * parent's keys, tagged `{tag}t{seq}`.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Length of a conversation's tag: 22 base64url characters, 132 bits. */
export const RING_TAG_LEN = 22;

export function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

const keyCache = new Map();
const KEY_CACHE_MAX = 1000;

/** The tag and AES key a root key stands for, cached by the root. */
export async function ringKeysFrom(root) {
  const hit = keyCache.get(root);
  if (hit) return hit;
  const promise = (async () => {
    const rootBytes = b64urlDecode(root);
    const [tagBytes, encBytes] = await Promise.all([hmac(rootBytes, 'tag'), hmac(rootBytes, 'enc')]);
    const aes = await crypto.subtle.importKey('raw', encBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    return { tag: b64urlEncode(tagBytes).slice(0, RING_TAG_LEN), aes };
  })();
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.delete(keyCache.keys().next().value);
  keyCache.set(root, promise);
  promise.catch(() => keyCache.delete(root));
  return promise;
}

export function threadTag(tag, seq) {
  return `${tag}t${seq}`;
}

/** `{ tag, seq }` for a thread's tag, `{ tag, seq: null }` for a conversation's own, null for anything else. */
export function parseTag(g) {
  if (typeof g !== 'string' || g.length < RING_TAG_LEN) return null;
  const tag = g.slice(0, RING_TAG_LEN);
  if (g.length === RING_TAG_LEN) return { tag, seq: null };
  const m = /^t([1-9]\d*)$/.exec(g.slice(RING_TAG_LEN));
  return m ? { tag, seq: Number(m[1]) } : null;
}

/** `obj` sealed under `aes`, bound to the entry's tag: base64url of the IV followed by the ciphertext. */
export async function sealEntry(aes, g, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(g) }, aes, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64urlEncode(out);
}

/** The payload of a sealed entry, or null when it does not open under this key and tag. */
export async function openEntry(aes, g, d) {
  try {
    const bytes = b64urlDecode(d);
    if (bytes.length < 13) return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: enc.encode(g) }, aes, bytes.slice(12));
    return JSON.parse(dec.decode(plain));
  } catch {
    return null;
  }
}
