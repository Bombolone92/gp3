/**
 * Emoji: shortcode lookups, skin tones, the emoji-only rule, shortcode
 * rendering in messages, and reaction key validation shared with the worker.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  loadEmoji, emojiFor, emojiLabel, parseKey, keyFor, canonicalKey, emojiEntry, withTone, searchEmoji, isEmojiOnly, replaceShortcodes,
  QUICK_REACTIONS, LEGACY_REACTIONS,
} from '../src/lib/emoji.js';
import { isReactionKey, REACTIONS_PER_MESSAGE, LEGACY_REACTION_KEYS } from '../src/shared/reactions.js';
import { EMOJI_CODES, EMOJI_TONED } from '../src/shared/emoji-codes.js';
import { formatMessage } from '../src/lib/format.js';

beforeAll(() => loadEmoji());

describe('emoji table', () => {
  it('resolves shortcodes and aliases', () => {
    expect(emojiFor('tada')).toBe('🎉');
    expect(emojiFor('+1')).toBe('👍');
    expect(emojiFor('thumbsup')).toBe('👍');
    expect(emojiFor('nope_not_one')).toBeNull();
    expect(emojiLabel('white_check_mark')).toBe('white check mark');
    for (const k of QUICK_REACTIONS) expect(emojiFor(k), k).toBeTruthy();
  });

  it('draws the legacy icon names as the emoji they stood for', () => {
    // Older messages store the original eight reactions as Lucide icon names;
    // they render, label, and select as emoji so no pill is ever an icon.
    const drawn = { 'thumbs-up': '👍', heart: '❤️', laugh: '😂', 'party-popper': '🎉', eye: '👀', check: '✅', rocket: '🚀', flame: '🔥' };
    for (const [key, char] of Object.entries(drawn)) expect(emojiFor(key), key).toBe(char);
    expect(emojiLabel('thumbs-up')).toBe('+1');
    expect(emojiLabel('check')).toBe('white check mark');
    expect(parseKey('party-popper')).toEqual({ code: 'tada', tone: 1 });
    expect(canonicalKey('flame')).toBe('fire');
    expect(canonicalKey('fire')).toBe('fire');
    expect(canonicalKey('wave-tone3')).toBe('wave-tone3');
    for (const k of LEGACY_REACTION_KEYS) expect(Object.hasOwn(LEGACY_REACTIONS, k), k).toBe(true);
  });

  it('applies skin tones only where they belong', () => {
    expect(parseKey('wave-tone3')).toEqual({ code: 'wave', tone: 3 });
    expect(parseKey('wave')).toEqual({ code: 'wave', tone: 1 });
    expect(emojiFor('wave-tone3')).toBe('👋🏼'); // tone2 light … tone6 dark
    expect(emojiFor('wave-tone6')).toBe('👋🏿');
    expect(emojiFor('tada-tone3')).toBe('🎉'); // no tone on a party popper
    const wave = emojiEntry('wave');
    expect(keyFor(wave, 5)).toBe('wave-tone5');
    expect(keyFor(emojiEntry('tada'), 5)).toBe('tada');
    // A toned emoji drops the presentation selector that some bases carry.
    expect([...withTone(emojiEntry('point_up'), 2)]).not.toContain('️');
  });

  it('searches by shortcode prefix, then by keyword', () => {
    const hits = searchEmoji('tad');
    expect(hits[0].code).toBe('tada');
    expect(searchEmoji('hooray').some((e) => e.code === 'tada')).toBe(true);
    expect(searchEmoji('party popper')[0].code).toBe('tada');
    expect(searchEmoji('')).toEqual([]);
    expect(searchEmoji('zzzzqqq')).toEqual([]);
  });

  it('knows an emoji-only message when it sees one', () => {
    expect(isEmojiOnly('🎉')).toBe(true);
    expect(isEmojiOnly('👋🏽 🎉')).toBe(true);
    expect(isEmojiOnly('👨‍👩‍👧')).toBe(true);
    expect(isEmojiOnly('🇫🇷')).toBe(true);
    expect(isEmojiOnly('nice 🎉')).toBe(false);
    expect(isEmojiOnly('')).toBe(false);
    expect(isEmojiOnly('🎉'.repeat(13))).toBe(false);
  });
});

describe('shortcodes in messages', () => {
  it('renders known :shortcodes: as emoji, but not inside code', () => {
    expect(replaceShortcodes('ship it :rocket: :nope:')).toBe('ship it 🚀 :nope:');
    expect(formatMessage('done :white_check_mark:')).toBe('done ✅');
    expect(formatMessage('`:tada:` and ```\n:tada:\n```')).toBe('<code class="code-inline">:tada:</code> and <pre class="code-block"><code>:tada:</code></pre>');
    expect(formatMessage('time 10:30:45 ok')).toBe('time 10:30:45 ok');
  });
});

describe('reaction keys', () => {
  it('accepts emoji shortcodes, tones where allowed, and the legacy icons', () => {
    expect(isReactionKey('tada')).toBe(true);
    expect(isReactionKey('+1')).toBe(true);
    expect(isReactionKey('wave-tone2')).toBe(true);
    expect(isReactionKey('wave-tone7')).toBe(false);
    expect(isReactionKey('tada-tone2')).toBe(false);
    for (const k of LEGACY_REACTION_KEYS) expect(isReactionKey(k)).toBe(true);
    expect(isReactionKey('nope')).toBe(false);
    expect(isReactionKey('x.y')).toBe(false);
    expect(isReactionKey('__proto__')).toBe(false);
    expect(isReactionKey('')).toBe(false);
    expect(isReactionKey(42)).toBe(false);
    expect(REACTIONS_PER_MESSAGE).toBe(24);
  });

  it('generated tables are consistent', () => {
    expect(EMOJI_CODES.size).toBeGreaterThan(1800);
    for (const k of EMOJI_TONED) expect(EMOJI_CODES.has(k)).toBe(true);
    for (const k of EMOJI_CODES) expect(k).toMatch(/^[a-z0-9_+-]{1,40}$/);
  });
});
