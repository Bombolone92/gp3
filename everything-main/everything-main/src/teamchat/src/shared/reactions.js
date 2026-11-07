/**
 * Reaction keys, validated the same way in the worker and the client. A key
 * is stored as a path segment in a block's overlay (`x.s42.r.{key}.{uuid}`),
 * so it must be one of a known set rather than any string: a legacy icon
 * name, or an emoji :shortcode: optionally followed by a skin tone suffix
 * (`-tone2` .. `-tone6`) when that emoji takes one.
 */
import { EMOJI_CODES, EMOJI_TONED } from './emoji-codes.js';

/** The original eight reactions, stored on older messages as Lucide icon names. */
export const LEGACY_REACTION_KEYS = new Set(['thumbs-up', 'heart', 'laugh', 'party-popper', 'eye', 'check', 'rocket', 'flame']);

/** Distinct reactions one message may carry. */
export const REACTIONS_PER_MESSAGE = 24;
/**
 * Reactions one message may carry in all, counting each person under each
 * key. The distinct-key cap bounds nothing per person: every reactor adds an
 * entry (and a notice counter) to the message's overlay, and a block holding
 * a few much-reacted messages could outgrow what the store takes, after which
 * no message could be posted into it. A thousand is far past any real
 * message and far short of the store's limit.
 */
export const REACTORS_PER_MESSAGE = 1000;

const KEY_RE = /^[a-z0-9_+-]{1,48}$/;
const TONE_RE = /-tone([2-6])$/;

export function isReactionKey(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return false;
  if (LEGACY_REACTION_KEYS.has(key)) return true;
  const m = TONE_RE.exec(key);
  if (!m) return EMOJI_CODES.has(key);
  const base = key.slice(0, m.index);
  return EMOJI_TONED.has(base);
}
