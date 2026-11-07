/**
 * Shared channels between workspaces, the part two workers need to agree
 * on: a signed attestation.
 *
 * A shared channel lives on its host workspace's worker; members of a
 * partner workspace take part as `external` members of the host, seeing
 * only that channel. The host cannot ask the partner's worker who its
 * members are (workers have no session for each other), so the partner
 * vouches for its own people: when the two workspaces are connected they
 * come to share a secret, and the partner's worker signs a short-lived
 * token naming one of its members. The host checks the signature against
 * the connection's secret and the named uuid against the Puter identity
 * of whoever presents the token, so a token is only ever good for the
 * person it names, and only for a few minutes.
 *
 *   token = base64url(JSON payload) "." hex(HMAC-SHA256(secret, payload))
 *   payload = { c: connectionId, u: memberUuid, k: 'join' | 'disconnect' | 'revoke', exp, iat }
 *
 * A `join` or `disconnect` token is presented by the person it names, and
 * is good for them alone. A `revoke` token names someone else: the partner
 * has taken a member out of its workspace (or made them a guest), and says
 * so to the host, which lets go of that person's seat at once rather than
 * a day later when their standing would have run out. It is signed on the
 * partner's worker when the admin acts, and carried to the host by the
 * admin's app, as every other word between the two workers is carried.
 */
import { timingSafeEqual } from './lib.js';

/** How long an attestation is good for. Long enough for a round trip, short enough to be worthless later. */
export const ATTEST_TTL_MS = 10 * 60_000;
/**
 * How long an external member stays a member of the host without a fresh
 * attestation. Their client re-attests silently (its own worker signs for
 * it while it is still a member there), so someone removed from the partner
 * workspace loses the shared channel within a day even if their app never
 * says goodbye.
 */
export const EXTERNAL_TTL_MS = 24 * 3600_000;

const KINDS = ['join', 'disconnect', 'revoke'];

function b64url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sign an attestation for one member of the partner workspace. */
export async function signAttestation(secret, { conn, uuid, kind, now = Date.now() }) {
  if (!KINDS.includes(kind)) throw new Error('Unknown attestation kind');
  const payload = JSON.stringify({ c: conn, u: uuid, k: kind, iat: now, exp: now + ATTEST_TTL_MS });
  return `${b64url(payload)}.${await hmac(secret, payload)}`;
}

/**
 * Check a token against a connection's secret. Returns the payload when it
 * is genuine, unexpired, of the expected kind, for the expected connection,
 * and names `uuid`; null otherwise. Every failure looks the same to the
 * caller. With no `uuid` given (a revocation, which names the person it is
 * about rather than the one presenting it), the token is good for whoever
 * it names, and the caller reads that from the payload.
 */
export async function verifyAttestation(secret, token, { conn, uuid, kind, now = Date.now() }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  let text;
  let payload;
  try {
    text = unb64url(parts[0]);
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!timingSafeEqual(await hmac(secret, text), parts[1])) return null;
  if (payload.c !== conn || payload.k !== kind) return null;
  if (typeof payload.u !== 'string' || !payload.u || (uuid !== undefined && payload.u !== uuid)) return null;
  if (!Number.isFinite(payload.exp) || payload.exp < now || !Number.isFinite(payload.iat) || payload.iat > now + 60_000) return null;
  // The expiry is the signer's word too, and only the lifetime this module
  // gives is honoured: a partner's worker of its own making could otherwise
  // sign a token good for years, and someone that workspace removed the next
  // day would hold the shared channel here until it ran out, with nobody
  // vouching for them, since renewing is what a fresh token is for.
  if (payload.exp - payload.iat > ATTEST_TTL_MS) return null;
  return payload;
}

/** Shape checks shared by the routes on both sides. */
export const CONN_ID_RE = /^[a-z0-9]{10}$/;
export const SECRET_RE = /^[a-z0-9]{32}$/;
/** A workspace reference as the client writes it: `{wsId}@{server}`. */
export const REF_RE = /^[a-z0-9]{6,20}@[a-z0-9][a-z0-9._:-]{0,120}$/;
