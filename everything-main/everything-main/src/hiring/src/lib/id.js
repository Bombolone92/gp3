/**
 * Record ids double as cloud file-system path segments and public URL
 * segments, so only inert ones are acceptable. Matches every id `uid`
 * mints and every id the seed data uses.
 */
export function isSafeId(value) {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(value ?? ''));
}

/** Short, collision-resistant id for client-side records. */
export function uid(prefix = '') {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replaceAll('-', '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return prefix ? `${prefix}_${rand}` : rand;
}
