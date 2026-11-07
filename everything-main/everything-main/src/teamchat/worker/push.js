/**
 * Web Push from the worker: VAPID (RFC 8292) and payload encryption
 * (RFC 8291, aes128gcm), with WebCrypto only. Each owner's worker has its
 * own VAPID key pair, generated on first use and kept in the owner's KV
 * (tc:config.vapid), so pushes for a workspace are signed by its owner's
 * server and nothing runs under the app developer's account.
 */
import { kv, serverConfig, setServerConfig, resetServerConfigCache, CONFIG_KEY } from './lib.js';
import { allowedUrl } from './unfurl.js';

const subtle = crypto.subtle;
const enc = new TextEncoder();

export const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(s).length / 4) * 4, '=')), (c) => c.charCodeAt(0));

const soundKeys = (v) => !!(v && typeof v === 'object' && v.pub && v.jwk);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The worker's VAPID keys: { pub (raw, base64url), jwk (private) }, made
 * once. Two first callers at once (two devices turning notifications on
 * against a fresh worker, or one member's two workspaces here opening
 * together) each made a pair and each wrote it, the second over the first,
 * while the first had already handed its own public key to the browser:
 * that device subscribed under a key no push was ever signed with again,
 * and every push to it failed (not "gone", so it was never dropped) until
 * the app next opened and, finding the worker's key changed, subscribed
 * afresh. So the making is claimed first, with a count on the config
 * document that only the caller taking it from nothing to one wins (as a
 * delivery claims a scheduled entry); the others wait for the pair to
 * appear, briefly, and make their own only if it does not (a winner that
 * died). And every caller answers with the pair that stands after its
 * write, never the one it made.
 */
export async function vapidKeys() {
  const cfg = await serverConfig();
  if (soundKeys(cfg.vapid)) return cfg.vapid;
  let claimed = true;
  try {
    const res = await kv().incr(CONFIG_KEY, { vapidClaim: 1 });
    const n = res && typeof res === 'object' ? Number(res.vapidClaim) : Number(res);
    if (Number.isFinite(n) && n > 1) claimed = false;
  } catch {
    /* a store that refuses the count: made below, as before */
  }
  if (!claimed) {
    for (let i = 0; i < 6; i++) {
      await pause(150);
      resetServerConfigCache();
      const again = await serverConfig();
      if (soundKeys(again.vapid)) return again.vapid;
    }
  }
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapid = { pub: b64url(await subtle.exportKey('raw', pair.publicKey)), jwk: await subtle.exportKey('jwk', pair.privateKey), createdAt: Date.now() };
  const next = await setServerConfig({ vapid });
  return soundKeys(next.vapid) ? next.vapid : vapid;
}

/** A VAPID Authorization header for `endpoint`, valid twelve hours. */
export async function vapidAuth(endpoint, keys, subject = 'mailto:teamchat@puter.com') {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle.importKey('jwk', keys.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.pub}`;
}

async function hkdf(salt, ikm, info, length) {
  const key = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(new Uint8Array(p), o);
    o += p.byteLength;
  }
  return out;
};

/**
 * Encrypt `plaintext` for a subscription { endpoint, keys: { p256dh, auth } }
 * as one aes128gcm record. Returns the body to POST.
 */
export async function encryptPayload(sub, plaintext) {
  const uaPub = fromB64url(sub.keys.p256dh);
  const auth = fromB64url(sub.keys.auth);
  const local = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await subtle.exportKey('raw', local.publicKey));
  const uaKey = await subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(auth, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const data = concat(enc.encode(plaintext), new Uint8Array([2]));
  const aes = await subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPub.byteLength]), asPub, cipher);
}

/**
 * Send one push. Returns 'ok', 'gone' (the subscription should be dropped:
 * 404/410), or 'failed'. Never throws.
 */
export async function sendPush(sub, payload, { ttl = 3600, urgency = 'normal' } = {}) {
  try {
    const keys = await vapidKeys();
    const body = await encryptPayload(sub, JSON.stringify(payload));
    // The endpoint was checked when the device subscribed; checked again
    // here, and never followed through a redirect, so a push can only ever
    // go to a public https host.
    if (!allowedUrl(sub.endpoint) || !String(sub.endpoint).startsWith('https://')) return 'gone';
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: await vapidAuth(sub.endpoint, keys) },
      body,
      // Pushes are awaited by the post that causes them, ten at a time, and
      // a recipient chooses their own endpoints: a push service answers in
      // well under a second, so a longer wait only lets a slow endpoint hold
      // up everyone's post.
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok || res.status === 201 ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Is a push wanted right now by a subscription's owner? Quiet hours and a
 * pause travel with the subscription, in the device's own minutes-from-UTC,
 * so the worker can respect them while the app is closed.
 */
export function pushAllowed(prefs, now = Date.now()) {
  if (!prefs) return true;
  if (prefs.pauseUntil && prefs.pauseUntil > now) return false;
  const d = prefs.dnd;
  if (!d || !d.enabled || typeof d.from !== 'number' || typeof d.to !== 'number' || d.from === d.to) return true;
  const offset = Number(prefs.tzOffset) || 0; // minutes to add to UTC to get local
  const local = new Date(now + offset * 60_000);
  const cur = local.getUTCHours() * 60 + local.getUTCMinutes();
  const inWindow = d.from < d.to ? cur >= d.from && cur < d.to : cur >= d.from || cur < d.to;
  return !inWindow;
}
