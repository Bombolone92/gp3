/**
 * Identifiers. Random ids use an unambiguous lowercase alphabet so they are
 * safe inside KV keys (no ':'), URLs and file names.
 */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function randomId(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** A long random secret, for portal access links and invite codes. */
export function secret(length = 32) {
  return randomId(length);
}

/** Zero-pad so numeric ids sort correctly as KV key text. */
export function pad(n, width = 9) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(width, '0');
}

export function isId(value, min = 6, max = 40) {
  return typeof value === 'string' && value.length >= min && value.length <= max && /^[a-z0-9]+$/.test(value);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
