/**
 * Record ids: a base-36 millisecond timestamp followed by random characters.
 * They sort roughly by creation time and are safe inside a KV key (no ':').
 */
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(now = Date.now()) {
  const time = now.toString(36).padStart(9, '0');
  let rand = '';
  const bytes = new Uint8Array(8);
  (globalThis.crypto || { getRandomValues: (b) => b.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  for (const b of bytes) rand += ALPHABET[b % 36];
  return time + rand;
}
