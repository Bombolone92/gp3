/**
 * Restricted credentials for talking to review workers (yours or someone
 * else's). Instead of the Puter session, each request carries:
 *   - an access token that can only read one small file in your own drive,
 *     holding this device's public key (made with puter.fs.getReadURL), and
 *   - a proof header: the private key's signature over [worker origin, that
 *     file's path, SHA-256 of the request body].
 * The worker learns who you are from the file's owner and nothing more.
 *
 * Minting tokens is rate limited by Puter, so a credential is kept in your
 * private app KV and reused for up to a day; one the worker refuses is
 * replaced at most once a minute.
 */
import { hash, keyPair, sign, tokenClaims } from './protocol.js';

export const PROOF_HEADER = 'x-video-review-proof';
const KV_PREFIX = 'video-studio-review-auth-v1';
const LIFETIME = 24 * 60 * 60 * 1000;

const credentials = new WeakMap();
const replaced = new WeakMap();

async function loadCredential(puter, parent, refused) {
  const context = (await hash(parent)).slice(0, 32);
  const key = `${KV_PREFIX}:${context}`;
  const saved = await puter.kv.get(key);
  if (saved?.expires > Date.now() + 60_000 && (!refused || saved.token !== refused.token)) return saved;
  const keys = saved?.keys || (await keyPair());
  // Each key pair gets its own file, so two tabs starting at once never overwrite each other's proof.
  const fingerprint = (await hash(JSON.stringify(keys.publicKey))).slice(0, 32);
  const file = await puter.fs.write(`video-studio/review-identity/${context}-${fingerprint}.json`, JSON.stringify({ version: 1, publicKey: keys.publicKey }), { overwrite: true, dedupeName: false, createMissingParents: true });
  const issued = Date.now();
  const url = new URL(await puter.fs.getReadURL(file.path, '24h'));
  const token = url.searchParams.get('token');
  const claims = tokenClaims(token);
  if (url.origin !== new URL(puter.APIOrigin).origin || url.pathname !== '/token-read' || !token || token === parent || claims.type !== 'access-token' || claims.full_access || !Number.isFinite(claims.exp)) {
    throw new Error('Could not create a review credential.');
  }
  const credential = { keys, path: file.path, token, expires: Math.min(issued + LIFETIME, claims.exp * 1000) };
  if (puter.authToken !== parent) throw new Error('Your Puter account changed. Reload the page.');
  await puter.kv.set(key, credential);
  return credential;
}

/**
 * Note that a worker refused a credential. Returns true when it is worth
 * sending the request again with a fresh one.
 */
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

/** Headers that authenticate one request body to one worker. */
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
  if (puter.authToken !== parent) throw new Error('Your Puter account changed. Reload the page.');
  return {
    'puter-auth': credential.token,
    [PROOF_HEADER]: JSON.stringify({ version: 1, path: credential.path, signature }),
  };
}
