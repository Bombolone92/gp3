import { hash, verify } from "../src/collaboration/protocol.js";
import { tokenClaims } from "../src/collaboration/auth.js";

const proofs = new Map();
const denied = () =>
  Object.assign(Error("Could not verify this collaboration request."), {
    status: 401,
  });

async function publicKey(puter, file) {
  const proof = JSON.parse(await (await puter.fs.read(file.path)).text());
  if (proof.version !== 1 || !proof.publicKey || proof.publicKey.d)
    throw denied();
  return proof.publicKey;
}

export async function authenticate(request, puter, input) {
  const token = request.headers.get("puter-auth");
  // Keep already-open clients compatible. A restricted bearer token must never
  // be allowed through this legacy path by dropping its proof header.
  const claims = tokenClaims(token);
  if (claims.type === "session" || claims.type === "app-under-user")
    return puter.auth.getUser();
  if (claims.type !== "access-token" || !claims.user_uid) throw denied();
  try {
    const header = request.headers.get("x-whiteboard-proof");
    if (!header || header.length > 4096) throw denied();
    const proof = JSON.parse(header);
    if (
      proof.version !== 1 ||
      typeof proof.path !== "string" ||
      !proof.path ||
      proof.path.length > 2048
    )
      throw denied();
    // /whoami rejects scoped access tokens. A strong stat validates the exact
    // token with Puter on every request, including expiry and revocation.
    // Puter reports is_shared:null for a file the authenticated caller does
    // not own. Requiring an unshared owned file also prevents substituting
    // an attacker's public key through a publicly readable file.
    const file = await puter.fs.stat(proof.path, { consistency: "strong" });
    if (
      file.is_shared !== false ||
      typeof file.owner?.username !== "string" ||
      !file.owner.username ||
      file.is_dir ||
      !Number.isFinite(file.size) ||
      file.size < 0 ||
      file.size > 4096
    )
      throw denied();
    // Only trust decoded identity claims after Puter accepts the credential.
    const identity = { uuid: claims.user_uid, username: file.owner.username };
    const key = `${token}|${proof.path}|${identity.uuid}`;
    let cached = proofs.get(key);
    if (!cached || cached.expires <= Date.now()) {
      if (proofs.size >= 256) proofs.delete(proofs.keys().next().value);
      cached = {
        expires: Date.now() + 5 * 60_000,
        pending: publicKey(puter, file),
      };
      proofs.set(key, cached);
      cached.pending.catch(() => {
        if (proofs.get(key) === cached) proofs.delete(key);
      });
    }
    if (
      !(await verify(
        await cached.pending,
        [
          new URL(request.url).origin,
          proof.path,
          await hash(JSON.stringify(input)),
        ],
        proof.signature,
      ))
    )
      throw denied();
    return identity;
  } catch {
    throw denied();
  }
}
