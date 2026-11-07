/**
 * Emoji for the client: the :shortcode: table, search, skin tones, and the
 * recently used list. The table (src/lib/emoji-data.js, ~85 KB) is loaded on
 * demand with a dynamic import; main.js kicks that off right after the shell
 * mounts, so by the time a workspace has loaded it is there. Until then,
 * lookups answer null and the renderer shows the shortcode itself.
 *
 * Reaction keys are shortcodes, optionally with a skin tone suffix
 * (`wave-tone3`), and stay KV-path safe: [a-z0-9_+-] only, no dots.
 */

const TONES = ['', '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const TONE_RE = /-tone([2-6])$/;
const RECENT_KEY = 'teamchat:emoji:recent';
const TONE_KEY = 'teamchat:emoji:tone';
const RECENT_MAX = 24;

/** The eight quick reactions, the same set the icon-only picker used to offer. */
export const QUICK_REACTIONS = ['+1', 'heart', 'joy', 'tada', 'eyes', 'white_check_mark', 'rocket', 'fire'];

/**
 * The original eight reactions were stored as Lucide icon names; older
 * messages still carry those keys. Each is an alias for the emoji it drew,
 * so it renders and labels as that emoji everywhere.
 */
export const LEGACY_REACTIONS = {
  'thumbs-up': '+1', heart: 'heart', laugh: 'joy', 'party-popper': 'tada',
  eye: 'eyes', check: 'white_check_mark', rocket: 'rocket', flame: 'fire',
};

let table = null; // [{ char, codes: [], code, cat, keywords, toned }]
let byCode = new Map();
let categories = [];
let loading = null;

/** Load the table once; resolves when lookups work. Safe to call often. */
export function loadEmoji() {
  if (table) return Promise.resolve(table);
  if (!loading) {
    loading = import('./emoji-data.js').then((mod) => {
      categories = mod.CATEGORIES;
      table = mod.default.map(([char, aliases, cat, keywords, toned]) => {
        const codes = aliases.split(' ');
        return { char, codes, code: codes[0], cat, keywords, toned: !!toned };
      });
      byCode = new Map();
      for (const e of table) for (const c of e.codes) byCode.set(c, e);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('teamchat:emoji'));
      return table;
    });
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export const emojiReady = () => !!table;

/** Split a reaction key into its shortcode and tone (1 = none); a legacy icon name reads as its emoji's shortcode. */
export function parseKey(key) {
  if (LEGACY_REACTIONS[key]) return { code: LEGACY_REACTIONS[key], tone: 1 };
  const m = TONE_RE.exec(key);
  return m ? { code: key.slice(0, m.index), tone: Number(m[1]) } : { code: key, tone: 1 };
}

/** The shortcode a reaction key stands for: legacy icon names become their emoji; anything else is unchanged. */
export function canonicalKey(key) {
  return LEGACY_REACTIONS[key] || key;
}

/** The entry for a shortcode (tone suffix allowed), or null. */
export function emojiEntry(key) {
  return byCode.get(parseKey(String(key || '')).code) || null;
}

/** Apply a skin tone (2..6) to an emoji that takes one. */
export function withTone(entry, tone) {
  if (!entry || !entry.toned || !tone || tone < 2 || tone > 6) return entry?.char || '';
  // The modifier follows the first code point; a following VS16 goes away
  // (a toned emoji is always presented as emoji).
  const cps = [...entry.char];
  const rest = cps.slice(1).filter((c, i) => !(i === 0 && c === '\uFE0F'));
  return cps[0] + TONES[tone - 1] + rest.join('');
}

/** The character for a reaction key or shortcode; null when unknown. */
export function emojiFor(key) {
  const { code, tone } = parseKey(String(key || ''));
  const e = byCode.get(code);
  if (!e) return null;
  return tone > 1 ? withTone(e, tone) : e.char;
}

/** Human label for a reaction key: "thumbs up" style. */
export function emojiLabel(key) {
  const e = emojiEntry(key);
  return e ? e.code.replace(/[_-]+/g, ' ') : String(key || '');
}

/** Reaction key for an entry with the given tone. */
export function keyFor(entry, tone = 1) {
  return entry.toned && tone > 1 ? `${entry.code}-tone${tone}` : entry.code;
}

/**
 * Entries matching a query, by shortcode prefix first, then by keyword;
 * a query with no letters returns nothing.
 */
export function searchEmoji(query, limit = 48) {
  const q = String(query || '').toLowerCase().replace(/[^a-z0-9_+-\s]/g, '').trim();
  if (!q || !table) return [];
  const words = q.split(/\s+/);
  const starts = [];
  const contains = [];
  for (const e of table) {
    if (e.codes.some((c) => c.startsWith(q))) starts.push(e);
    else if (words.every((w) => e.codes.some((c) => c.includes(w)) || e.keywords.includes(w))) contains.push(e);
    if (starts.length >= limit) break;
  }
  return starts.concat(contains).slice(0, limit);
}

export function emojiCategories() {
  return categories.map((name, i) => ({ id: i, name, items: table ? table.filter((e) => e.cat === i) : [] }));
}

/* ---- preferences kept in this browser -------------------------------- */

export function recentEmoji() {
  let list = [];
  try {
    list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  const out = [];
  for (const k of list.concat(QUICK_REACTIONS)) if (typeof k === 'string' && !out.includes(k)) out.push(k);
  return out.slice(0, RECENT_MAX);
}

/**
 * The three reactions one click away on a message: what this person has
 * actually used lately, filled up with the defaults (done, seen, thanks)
 * until they have.
 */
export const DEFAULT_QUICK = ['white_check_mark', 'eyes', 'raised_hands'];
export function quickReactions(n = 3) {
  let used = [];
  try {
    used = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    used = [];
  }
  if (!Array.isArray(used)) used = [];
  const out = [];
  for (const k of used.concat(DEFAULT_QUICK)) if (typeof k === 'string' && !out.includes(k)) out.push(k);
  return out.slice(0, n);
}

export function noteEmojiUse(key) {
  try {
    // What was actually used, not the padded list the readers hand out: the
    // picker's defaults must not be written down as if they had been chosen,
    // or the quick-reaction bar would fill with them after the first use.
    let used = [];
    try {
      used = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
      used = [];
    }
    const cur = (Array.isArray(used) ? used : []).filter((k) => typeof k === 'string' && k !== key);
    localStorage.setItem(RECENT_KEY, JSON.stringify([key, ...cur].slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable */
  }
}

export function preferredTone() {
  try {
    const t = Number(localStorage.getItem(TONE_KEY));
    return t >= 2 && t <= 6 ? t : 1;
  } catch {
    return 1;
  }
}

export function setPreferredTone(tone) {
  try {
    if (tone >= 2 && tone <= 6) localStorage.setItem(TONE_KEY, String(tone));
    else localStorage.removeItem(TONE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/* ---- text ------------------------------------------------------------- */

// A code begins where a word does not: one letter or digit before the
// opening colon and the colons are the text's own (a ratio "a:b:c", a key
// "type:x:1", a clock "10:30:00"), not a shortcode.
// Read with a lookbehind rather than a lead that is taken, so that two
// codes written one after the other (":+1::-1:") both turn.
const SHORTCODE_RE = /(?<![a-zA-Z0-9]):([a-z0-9_+-]{1,40}):/g;

/**
 * Replace known :shortcodes: in plain text with their emoji. Unknown codes
 * (and anything while the table is still loading) stay as typed, and so
 * does a code-shaped run inside a word (see SHORTCODE_RE).
 */
export function replaceShortcodes(text) {
  if (!table) return text;
  return String(text).replace(SHORTCODE_RE, (m, code) => {
    const e = byCode.get(code);
    return e ? e.char : m;
  });
}

/** A message made of nothing but a few emoji renders larger. */
const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}|\u200D\p{Extended_Pictographic}|[\u{E0020}-\u{E007F}])*|\p{Regional_Indicator}{2}|\s)+$/u;

export function isEmojiOnly(text) {
  const s = String(text || '').trim();
  if (!s || !EMOJI_ONLY_RE.test(s)) return false;
  return [...s.replace(/\s+/g, '')].filter((c) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(c)).length <= 12;
}
