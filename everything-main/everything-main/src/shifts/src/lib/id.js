/**
 * Short, collision-resistant id for client-side records.
 *
 * randomUUID() is the cleanest source but is defined only in a secure
 * context, and the app is served over plain HTTP on any static host
 * (see README), where it is simply missing. getRandomValues() carries
 * no such restriction, so it covers that case before Math.random is
 * reached. That last resort is worth avoiding beyond collisions: the
 * published share link's suffix is its only access control, and
 * Math.random is predictable once a few of its outputs are seen.
 */
function randomToken(chars = 12) {
  const source = globalThis.crypto;
  if (source?.randomUUID) return source.randomUUID().replaceAll('-', '').slice(0, chars);
  if (source?.getRandomValues) {
    return [...source.getRandomValues(new Uint8Array(Math.ceil(chars / 2)))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, chars);
  }
  return Math.random().toString(36).slice(2, 2 + chars).padEnd(chars, '0');
}

export function uid(prefix = '') {
  const rand = randomToken();
  return prefix ? `${prefix}_${rand}` : rand;
}
