/**
 * The manager PIN: a counter-height barrier, not a vault.
 *
 * It keeps whoever is standing at an unattended register out of the money-
 * sensitive actions (refunds, voids, drawer, exports, Settings). The Puter
 * account is the real authority: signing out and back in removes the PIN.
 *
 * Stored as a salted, PBKDF2-stretched hash in settings kv - never
 * plaintext. A 4-6 digit keyspace is small, so the stretching is what makes
 * a kv dump annoying to search rather than instant; records from before the
 * stretching (no `iterations` field) still verify.
 */

/** How long a successful entry holds, so closing the day isn't four prompts. */
export const PIN_GRACE_MS = 5 * 60 * 1000;

/** 4-6 digits: typeable on a tablet in a second, like any till code. */
export function validPin(pin) {
  return /^\d{4,6}$/.test(String(pin ?? ''));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function newSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

/** OWASP's floor for PBKDF2-SHA-256; entry is rare (5-minute grace). */
export const PIN_ITERATIONS = 600_000;

/** Legacy scheme - records without `iterations`: one bare SHA-256. */
export async function hashPin(pin, salt) {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

async function stretchPin(pin, salt, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations,
    salt: new TextEncoder().encode(String(salt)),
  }, key, 256);
  return hex(new Uint8Array(bits));
}

/** The record settings stores: { salt, iterations, hash }. */
export async function makePinRecord(pin, iterations = PIN_ITERATIONS) {
  const salt = newSalt();
  return { salt, iterations, hash: await stretchPin(pin, salt, iterations) };
}

export async function verifyPin(pin, record) {
  if (!record?.salt || !record?.hash) return false;
  const iterations = Number(record.iterations);
  const computed = Number.isInteger(iterations) && iterations > 0
    ? await stretchPin(pin, record.salt, iterations)
    : await hashPin(pin, record.salt);   // records from before the stretching
  return computed === record.hash;
}

/**
 * True for a record written under a weaker scheme than today's - one bare
 * SHA-256, or fewer iterations than the current floor. A kv dump of such a
 * record gives up a 4-6 digit code in moments, and it stays that way for
 * ever unless rewritten: a correct entry is the one moment the code itself
 * is in hand, so that's when the gate upgrades it.
 */
export function needsRehash(record) {
  const iterations = Number(record?.iterations);
  return !(Number.isInteger(iterations) && iterations >= PIN_ITERATIONS);
}

/**
 * Increasing delay between attempts: two free tries (typos happen with a
 * customer waiting), then 5 s doubling to a minute cap - enough to make
 * guessing pointless without locking the owner out of their own till.
 */
export function lockDelayMs(failures) {
  if (failures < 3) return 0;
  return Math.min(60_000, 5_000 * 2 ** (failures - 3));
}
