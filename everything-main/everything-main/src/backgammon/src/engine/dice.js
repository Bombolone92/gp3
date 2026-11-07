/**
 * Dice: rolling them locally, and deriving them fairly between two peers.
 *
 * Backgammon is the one game in this family where the moves alone do not
 * decide the game — the dice do — so "who rolls" is a question chess and
 * checkers never had to answer. Offline it is simply this device. Online it
 * cannot be, because whoever generates a number gets to choose it, and a
 * player who can choose their own dice is not playing backgammon.
 *
 * So an online roll is a commitment scheme, run once per roll:
 *
 *   1. the side about to roll picks a secret nonce and sends only its hash
 *   2. the other side answers with a nonce of its own, in the clear
 *   3. the roller reveals its nonce; both sides check it against the hash
 *      and derive the same two dice from the pair
 *
 * Neither side can steer the result: the roller committed before seeing the
 * opponent's contribution, and the opponent answered without being able to
 * read the roller's. Everything in this module is pure and synchronous apart
 * from the hashing, which is WebCrypto.
 */

/** Bytes drawn from the platform CSPRNG, falling back to Math.random. */
function randomBytes(n) {
  const bytes = new Uint8Array(n);
  const webcrypto = globalThis.crypto;
  if (webcrypto?.getRandomValues) {
    webcrypto.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

const toHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Two dice from a byte stream, without the modulo bias a bare `byte % 6`
 * would carry: 256 is not a multiple of 6, so the four values 252-255 are
 * discarded and the next byte is used instead. With 32 bytes of digest to
 * draw from, running out is a 1-in-2^160 event; the last-resort branch keeps
 * the function total rather than leaving a hole nothing will ever fall into.
 */
export function diceFromBytes(bytes) {
  const dice = [];
  for (const byte of bytes) {
    if (dice.length === 2) break;
    if (byte >= 252) continue;
    dice.push((byte % 6) + 1);
  }
  while (dice.length < 2) dice.push((bytes[dice.length] % 6) + 1);
  return dice;
}

/** Roll two dice on this device. `rng` is injectable for tests. */
export function rollDice(rng = null) {
  if (rng) return [Math.floor(rng() * 6) + 1, Math.floor(rng() * 6) + 1];
  return diceFromBytes(randomBytes(8));
}

/** A fresh secret for one commit-reveal round: 16 bytes, as hex. */
export function randomNonce() {
  return toHex(randomBytes(16));
}

/** Is this something the other side could plausibly have sent as a nonce? */
export function isNonce(value) {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

/** SHA-256 of a nonce, as hex. Rejects if WebCrypto is unavailable. */
export async function hashNonce(nonce) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure hashing is unavailable in this browser.');
  const data = new TextEncoder().encode(nonce);
  return toHex(new Uint8Array(await subtle.digest('SHA-256', data)));
}

/** Is the fair-dice protocol available at all? (WebCrypto, secure context.) */
export function canDeriveFairly() {
  return !!globalThis.crypto?.subtle;
}

/**
 * The two dice a completed commit-reveal round produces. Both peers call
 * this with the same pair of nonces and get the same answer; the order of
 * the arguments is fixed (roller first) so they cannot disagree about it.
 */
export async function deriveDice(rollerNonce, replyNonce) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Secure hashing is unavailable in this browser.');
  const data = new TextEncoder().encode(`${rollerNonce}:${replyNonce}`);
  return diceFromBytes(new Uint8Array(await subtle.digest('SHA-256', data)));
}
