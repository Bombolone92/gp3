/**
 * Credentials for collaboration requests. A document's server belongs to
 * its owner, so the browser never sends its own Puter session to it.
 * Instead it sends a restricted Puter access token that can only read a
 * small identity file holding a public key, and signs each request (the
 * server address, that file and the body digest) with the private key.
 * The server checks the token with Puter, reads the key and verifies the
 * signature, which proves who is asking without granting it anything.
 *
 * Credentials last a day and are kept in this account's app storage so
 * reloads do not mint new tokens (a rate-limited operation).
 */
import { hash, keyPair, sign } from './protocol.js';

const credentials = new WeakMap();
const LIFETIME = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/** Claims of a Puter token (metadata only: the server validates the token with Puter). */
export function tokenClaims(token) {
  try {
    const claims = JSON.parse(atob(String(token).split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return {};
    if ((claims.t !== undefined && claims.type !== undefined) || (claims.uu !== undefined && claims.user_uid !== undefined)) return {};
    // Puter compresses auth types on the wire.
    const type = claims.t === undefined ? claims.type : { t: 'access-token', au: 'app-under-user', s: 'session' }[claims.t];
    const subject = claims.uu ?? claims.user_uid;
    let user_uid;
    if (typeof subject === 'string') {
      if (UUID.test(subject)) user_uid = subject.toLowerCase();
      else if (claims.uu !== undefined) {
        const packed = atob(subject.replaceAll('-', '+').replaceAll('_', '/'));
        if (packed.length === 16) {
          const hex = [...packed].map((b) => b.charCodeAt(0).toString(16).padStart(2, '0')).join('');
          user_uid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
      }
    }
    return { ...claims, type, user_uid };
  } catch {
    return {};
  }
}

async function loadCredential(puter, parent, refused) {
  const context = (await hash(parent)).slice(0, 32);
  const key = `vector-studio-collab-auth-v1:${context}`;
  const saved = await puter.kv.get(key);
  if (saved?.expires > Date.now() + 60_000 && (!refused || saved.token !== refused.token)) return saved;
  const keys = saved?.keys || (await keyPair());
  const fingerprint = (await hash(JSON.stringify(keys.publicKey))).slice(0, 32);
  const file = await puter.fs.write(`collab/identity/${context}-${fingerprint}.json`, JSON.stringify({ version: 1, publicKey: keys.publicKey }), { overwrite: true, dedupeName: false, createMissingParents: true });
  const issued = Date.now();
  const url = new URL(await puter.fs.getReadURL(file.path, '24h'));
  const token = url.searchParams.get('token');
  const claims = tokenClaims(token);
  if (url.pathname !== '/token-read' || !token || token === parent || claims.type !== 'access-token' || claims.full_access || !Number.isFinite(claims.exp)) {
    throw new Error('Could not create a restricted collaboration credential.');
  }
  const credential = { keys, path: file.path, token, expires: Math.min(issued + LIFETIME, claims.exp * 1000) };
  if (puter.authToken !== parent) throw new Error('Your Puter account changed. Open the shared document again.');
  await puter.kv.set(key, credential, { disableSharing: true });
  return credential;
}

/**
 * A credential the server refused before it expired (its identity file was
 * removed, or the token revoked) is replaced, at most once a minute.
 * Returns whether the request should be sent again.
 */
const replaced = new WeakMap();
export function refuseCredential(puter, headers) {
  const entry = credentials.get(puter);
  const value = entry?.value;
  if (entry && (entry.stale || !value || value.token !== headers?.['puter-auth'])) return true;
  if (!value) return false;
  if (Date.now() - (replaced.get(puter) || 0) < 60_000) return false;
  replaced.set(puter, Date.now());
  credentials.set(puter, { parent: entry.parent, stale: true, refused: value });
  return true;
}

/** Headers for one request to `server` with `body` (JSON text). */
export async function authorize(puter, server, body) {
  const parent = puter.authToken;
  if (!parent) throw new Error('Sign in with Puter to continue.');
  let entry = credentials.get(puter);
  if (entry?.parent !== parent || entry.stale || (entry.value && entry.value.expires <= Date.now() + 60_000)) {
    const refused = entry?.stale && entry.parent === parent && entry.refused;
    entry = { parent };
    credentials.set(puter, entry);
    entry.pending = loadCredential(puter, parent, refused).then(
      (value) => (entry.value = value),
      (error) => {
        if (credentials.get(puter) === entry) credentials.delete(puter);
        throw error;
      },
    );
  }
  const credential = await entry.pending;
  const signature = await sign(credential.keys.privateKey, [server, credential.path, await hash(body)]);
  if (puter.authToken !== parent) throw new Error('Your Puter account changed. Open the shared document again.');
  return {
    'puter-auth': credential.token,
    'x-vector-studio-proof': JSON.stringify({ version: 1, path: credential.path, signature }),
  };
}
