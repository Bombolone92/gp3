/**
 * Who is calling. Every request carries a restricted Puter credential: an
 * access token that can only read one small file in the caller's own drive
 * (their public key), plus a proof header signed with the matching private
 * key over [worker origin, that file's path, SHA-256 of the body]. Nobody
 * ever sends their full session to a worker, not even its owner.
 *
 * Puter validates the token (expiry, revocation) when the worker stats the
 * file with it; the file's owner is the caller's username. The file must be
 * unshared and owned by the caller, so nobody can point at someone else's
 * public key.
 */
import { hash, verify, tokenClaims } from '../src/review/protocol.js';

export const PROOF_HEADER = 'x-video-review-proof';
/** How long Puter's answer about a credential is reused; revoking it takes effect within this. */
export const VALIDATED_MS = 30_000;

const proofs = new Map();

const denied = () => Object.assign(new Error('Could not verify this request. Reload the page and try again.'), { status: 401 });

async function publicKey(puter, path) {
  const proof = JSON.parse(await (await puter.fs.read(path)).text());
  if (proof?.version !== 1 || !proof.publicKey || proof.publicKey.d) throw denied();
  return proof.publicKey;
}

/** Forget cached validations (tests). */
export function resetAuthCache() {
  proofs.clear();
}

/**
 * Resolve { uuid, username } for a request, or throw a 401 error.
 * callerPuter is the Puter client the runtime built from the request's
 * puter-auth header (user.puter in a worker route).
 */
export async function authenticate(request, callerPuter, bodyText, now = Date.now) {
  const token = request.headers.get('puter-auth');
  const claims = tokenClaims(token);
  // Sessions are never accepted: they would hand this worker the caller's whole account.
  if (claims.type !== 'access-token' || !claims.user_uid || !callerPuter) throw denied();
  try {
    const header = request.headers.get(PROOF_HEADER);
    if (!header || header.length > 4096) throw denied();
    const proof = JSON.parse(header);
    if (proof?.version !== 1 || typeof proof.path !== 'string' || !proof.path || proof.path.length > 1024 || typeof proof.signature !== 'string') throw denied();
    if (Number.isFinite(claims.exp) && claims.exp * 1000 <= now()) throw denied();
    const key = `${token}|${proof.path}|${claims.user_uid}`;
    let cached = proofs.get(key);
    if (!cached || cached.expires <= now() || cached.checked + VALIDATED_MS <= now()) {
      const file = await callerPuter.fs.stat(proof.path, { consistency: 'strong' });
      if (file.is_shared !== false || typeof file.owner?.username !== 'string' || !file.owner.username || file.is_dir || !Number.isFinite(file.size) || file.size < 0 || file.size > 4096) throw denied();
      if (cached && cached.expires > now()) {
        cached.checked = now();
        cached.username = file.owner.username;
      } else {
        if (proofs.size >= 2048) proofs.delete(proofs.keys().next().value);
        cached = { expires: now() + 5 * 60_000, checked: now(), username: file.owner.username, pending: publicKey(callerPuter, proof.path) };
        proofs.set(key, cached);
        const entry = cached;
        entry.pending.catch(() => {
          if (proofs.get(key) === entry) proofs.delete(key);
        });
      }
    }
    const signed = [new URL(request.url).origin, proof.path, await hash(bodyText)];
    if (!(await verify(await cached.pending, signed, proof.signature))) throw denied();
    return { uuid: claims.user_uid, username: cached.username };
  } catch {
    throw denied();
  }
}
