/**
 * Short random ids. Base36 from crypto randomness; never contain dots, so
 * they are safe as segments of KV dot-paths ("channels.{id}.topic").
 */
export function uid(len = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Invite codes: 12 symbols from an unambiguous 32-letter alphabet (2^60
 * possibilities), grouped for reading: XXXX-XXXX-XXXX.
 */
export const INVITE_CODE_LENGTH = 12;

export function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(INVITE_CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i && i % 4 === 0) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/**
 * Normalize typed or pasted input to the canonical grouped form, or null
 * when it cannot be a code. Codes issued before the length change were 9
 * symbols in groups of 3; they stay valid until rotated. Full-width letters
 * and digits (what a Japanese or Chinese keyboard produces until switched
 * to half-width) are folded to their plain forms first: kept only where
 * ASCII, a code typed wide came up short and was refused as no code at all.
 */
export function normalizeInviteCode(input) {
  const raw = String(input || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length === 12) return raw.match(/.{4}/g).join('-');
  if (raw.length === 9) return raw.match(/.{3}/g).join('-');
  return null;
}

/**
 * Deterministic DM conversation id: the same set of people always maps to
 * the same conversation, which is what makes "message this person" idempotent
 * with no lookup table. FNV-1a over the sorted uuids, twice with different
 * seeds, keeps the id short while making accidental collisions negligible.
 *
 * Scoped to a workspace when one is given: conversation keys carry no
 * workspace of their own, so without it the same two people in two
 * workspaces on one worker would share a history. Ids minted before the
 * scope existed (no wsId) are still found through the member documents.
 */
export function dmConvId(uuids, wsId = null) {
  const key = `${wsId ? `${wsId}|` : ''}${[...new Set(uuids)].sort().join('|')}`;
  return `dm_${fnv1a(key, 0x811c9dc5)}${fnv1a(key, 0x01000193)}`;
}

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Stable 1..8 slot from any string, for avatar colors. */
export function colorSlot(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return (h % 8) + 1;
}
