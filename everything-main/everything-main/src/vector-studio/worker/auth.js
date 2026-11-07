/**
 * Who is calling: validates the restricted Puter token a browser sends
 * (see src/features/collab/auth.js) and the request signature made with
 * the key in the caller's identity file.
 */
import { hash, verify } from '../src/features/collab/protocol.js';
import { tokenClaims } from '../src/features/collab/auth.js';

const proofs = new Map();
// How long Puter's validation of a token is reused; revocation applies within it.
const VALIDATED = 30_000;
const denied = () => Object.assign(new Error('Could not verify this collaboration request.'), { status: 401 });

async function publicKey(puter, file) {
  const proof = JSON.parse(await (await puter.fs.read(file.path)).text());
  if (proof.version !== 1 || !proof.publicKey || proof.publicKey.d) throw denied();
  return proof.publicKey;
}

/** { uuid, username } of the caller, or throws a 401 error. */
export async function authenticate(request, puter, input, now = Date.now) {
  const token = request.headers.get('puter-auth');
  const claims = tokenClaims(token);
  if (claims.type !== 'access-token' || !claims.user_uid) throw denied();
  try {
    const header = request.headers.get('x-vector-studio-proof');
    if (!header || header.length > 4096) throw denied();
    const proof = JSON.parse(header);
    if (proof.version !== 1 || typeof proof.path !== 'string' || !proof.path || proof.path.length > 2048) throw denied();
    if (Number.isFinite(claims.exp) && claims.exp * 1000 <= now()) throw denied();
    const key = `${token}|${proof.path}|${claims.user_uid}`;
    let cached = proofs.get(key);
    if (!cached || cached.expires <= now() || cached.checked + VALIDATED <= now()) {
      // A strong stat validates the exact token with Puter (expiry, revocation);
      // the file must be the caller's own, unshared and small.
      const file = await puter.fs.stat(proof.path, { consistency: 'strong' });
      if (file.is_shared !== false || typeof file.owner?.username !== 'string' || !file.owner.username || file.is_dir || !Number.isFinite(file.size) || file.size < 0 || file.size > 4096) throw denied();
      if (cached && cached.expires > now()) {
        cached.checked = now();
        cached.username = file.owner.username;
      } else {
        if (proofs.size >= 2048) proofs.delete(proofs.keys().next().value);
        cached = { expires: now() + 5 * 60_000, checked: now(), username: file.owner.username, pending: publicKey(puter, file) };
        proofs.set(key, cached);
        const entry = cached;
        entry.pending.catch(() => {
          if (proofs.get(key) === entry) proofs.delete(key);
        });
      }
    }
    const identity = { uuid: claims.user_uid, username: cached.username };
    if (!(await verify(await cached.pending, [new URL(request.url).origin, proof.path, await hash(JSON.stringify(input))], proof.signature))) throw denied();
    return identity;
  } catch {
    throw denied();
  }
}
