/** Short random ids for projects, tracks and clips. */
export function uid(prefix = '') {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += (b % 36).toString(36);
  return prefix + s;
}

/** SHA-256 hex digest of a Blob or ArrayBuffer, used to dedupe imported media. */
export async function sha256(data) {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Fast content fingerprint for large files: hashes the size plus the first,
 * middle and last megabyte instead of the whole file.
 */
export async function fingerprint(blob) {
  const MB = 1 << 20;
  if (blob.size <= 3 * MB) return sha256(blob);
  const mid = Math.floor(blob.size / 2);
  const parts = [blob.slice(0, MB), blob.slice(mid, mid + MB), blob.slice(blob.size - MB)];
  const head = new TextEncoder().encode(`${blob.size}:`);
  const joined = new Blob([head, ...parts]);
  return sha256(joined);
}
