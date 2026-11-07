/**
 * Message search, the parts the worker and the client share.
 *
 * The index is an inverted index in month buckets, each bucket sharded by
 * token: `tc:ws:{ws}:idx:m{yyyymm}:{n}` holds `{ [token]: [posting, ...] }`
 * for every token whose hash lands in shard n, for messages whose timestamp
 * falls in that month. A posting names one message, `{conv}:{seq}:{ts36}`,
 * so a query reads one shard per query word from the newest month, then
 * the month before, until its page is full, intersects the lists, and only
 * then fetches the messages it is about to return. Nothing is ever listed.
 *
 * Bucketing by month is what bounds cost: the store bills a write by the
 * size of the whole document it lands in, so appending to a shard that
 * holds a workspace's entire history costs its entire history every time.
 * A month's shard holds a month.
 *
 * Postings reach the shards through a small log: a message appends one
 * entry to the current log segment (one small write), and every
 * SEARCH_FOLD_EVERY-th message folds a completed segment into the shards,
 * so each shard is written once per segment rather than once per message.
 * A query reads the unfolded segments too, so a message is found the
 * moment it is posted. Edits append their new words; deletes append
 * nothing. Both leave stale postings behind, and the query path drops them
 * when it reads the message and finds the words gone. Each token's list is
 * capped at the newest SEARCH_POSTINGS_PER_TOKEN entries per month, so a
 * shard stays under the store's value limit whatever a month brings.
 */
import { parentOfThread } from './blocks.js';
import { linkableText } from './limits.js';

/**
 * Bump when the layout changes: a workspace whose index is older is read as
 * the layout before (see `legacy` in the search route) until an admin
 * rebuilds. A tokenizer change that only adds words (scripts that yielded
 * none before) needs no bump: every posting written so far stays right, and
 * the history gains the new words when the index is next rebuilt.
 */
export const SEARCH_VERSION = 3;
export const SEARCH_SHARDS = 64;
/** Distinct words indexed per message, in order of appearance. */
export const SEARCH_TOKENS_PER_MESSAGE = 200;
/** Postings kept per token in one month's shard; a month is what bounds it. */
export const SEARCH_POSTINGS_PER_TOKEN = 2000;
export const SEARCH_QUERY_TOKENS = 6;
export const SEARCH_PAGE = 20;
export const SEARCH_TOKEN_MIN = 2;
export const SEARCH_TOKEN_MAX = 24;
/** Messages per log segment; the segment is folded into the shards once complete. */
export const SEARCH_FOLD_EVERY = 50;
/** Unfolded segments a query reads, newest first: what was posted since the last fold. */
export const SEARCH_LOG_TAIL = 4;

/** Pseudo-tokens for `has:` filters; a letter-only tokenizer can never produce them. */
export const TOKEN_FILE = '_file';
export const TOKEN_LINK = '_link';
/** The author's pseudo-token, so "everything I sent" is one posting list. */
export const TOKEN_BY = '_by:';
export const authorToken = (uuid) => `${TOKEN_BY}${uuid}`;

/**
 * A pseudo-token scoped to one conversation (`_file@{conv}`), so "files in
 * #general" reads a list that is about #general alone instead of filtering
 * the workspace's list down to it. Threads count under their parent, as
 * `in:` does.
 */
export const scopedToken = (token, conv) => `${token}@${parentOfThread(conv)?.conv || conv}`;
/** The workspace-wide token a scoped one stands for, for indexes built before scoping existed. */
export const legacyTerm = (token) => (token.startsWith('_') && token.includes('@') ? token.slice(0, token.indexOf('@')) : token);

/** The month bucket a message's timestamp falls in, `yyyymm` in UTC. */
export function bucketOf(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return '000000';
  const d = new Date(n);
  // A moment past what a Date can hold (±8.64e15 ms) is no month either:
  // read off the invalid Date, as it used to be, it was "NaNNaN", a bucket
  // the index lists by shape and so never read again nor taken down.
  if (Number.isNaN(d.getTime())) return '000000';
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const isBucket = (b) => /^\d{6}$/.test(String(b));

const STOPWORDS = new Set(('a an and are as at be but by for from has have he her his i if in is it its me my not of on or ' +
  'our she so that the their them then there these they this to us was we were what when where which who will with you your').split(' '));

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/i;

/**
 * Words in a text, normalized: lowercase, accents stripped, letters and
 * digits only, distinct, in order of first appearance. Stopwords and very
 * short or long words are dropped; the cap on distinct words is applied by
 * the caller so this can also normalize a query.
 */
export function tokenize(text) {
  return words(text).filter((w) => !STOPWORDS.has(w));
}

/** Like tokenize, but keeps stopwords: what a query means, before indexing rules apply. */
export function words(text) {
  const out = [];
  const seen = new Set();
  const add = (w) => {
    if (w.length < SEARCH_TOKEN_MIN || w.length > SEARCH_TOKEN_MAX || seen.has(w)) return;
    seen.add(w);
    out.push(w);
  };
  // A combining mark (a vowel sign in Devanagari, a Thai vowel, a nukta) is
  // part of its word: split on, it left हिन्दी as single letters too short
  // to keep, and a message in such a script had no words at all.
  for (const raw of normalize(text).split(/[^\p{L}\p{N}\p{M}]+/u)) {
    // Chinese and Japanese are written without spaces, so a run of
    // ideographs or kana is a clause, not a word: taken as one token, a
    // message was found by its exact clause and by nothing in it, and a
    // clause past the token length was not indexed at all. A run yields its
    // overlapping pairs of characters instead (a character with its
    // combining marks counting as one, so a voiced kana pairs whole), the
    // way search engines index these scripts; a query goes through the same
    // function, so a word of two or more characters is found wherever it
    // occurs, and the clause itself is not a term no message would hold.
    // What stands beside a run in the same word (a product name, a number)
    // is a word of its own. Korean is written with spaces and is left to
    // the split.
    const rest = raw.replace(CJK_RUN, (run) => {
      const units = run.match(CJK_UNIT) || [];
      for (let i = 0; i + 1 < units.length; i++) add(units[i] + units[i + 1]);
      return ' ';
    });
    for (const w of rest.split(' ')) add(w);
  }
  return out;
}

// By script extensions, not script: the prolonged sound mark ー and the
// iteration marks (々, ヽ) belong to no script of their own, and by script
// alone a katakana run was cut at every ー, so コーヒー yielded nothing and
// サーバー was lost from サーバーが落ちた.
// Exported for the search snippet (lib/format.js highlightSnippet), which
// marks a run by the same pairs.
export const CJK_RUN = /(?:[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]\p{M}*)+/gu;
export const CJK_UNIT = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}]\p{M}*/gu;

/**
 * Lowercase with accents stripped, the form every comparison runs on. The
 * optional pointing of Arabic and Hebrew (harakat and tatweel, niqqud and
 * cantillation) goes the way Latin accents do: text is mostly written
 * without it, and a search for the bare word must find the pointed one.
 */
export function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, '');
}

export function isStopword(word) {
  return STOPWORDS.has(word);
}

/**
 * What gets indexed for one message: its words, `has:` pseudo-tokens, and
 * who wrote it; with `conv`, each pseudo-token also scoped to that
 * conversation.
 */
export function indexTokens(text, { attachments = 0, author = null, conv = null } = {}) {
  const tokens = tokenize(text).slice(0, SEARCH_TOKENS_PER_MESSAGE);
  const pseudo = [];
  if (attachments > 0) pseudo.push(TOKEN_FILE);
  if (hasLink(text)) pseudo.push(TOKEN_LINK);
  if (author) pseudo.push(authorToken(String(author)));
  tokens.push(...pseudo);
  if (conv) tokens.push(...pseudo.map((t) => scopedToken(t, conv)));
  return tokens;
}

export function hasLink(text) {
  return URL_RE.test(linkableText(text));
}

/** Which shard a token lives in (FNV-1a, stable across runtimes). */
export function shardOf(token) {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SEARCH_SHARDS;
}

export function encodePosting(conv, seq, ts) {
  return `${conv}:${seq}:${Number(ts).toString(36)}`;
}

export function decodePosting(p) {
  const parts = String(p).split(':');
  if (parts.length !== 3) return null;
  const seq = Number(parts[1]);
  const ts = parseInt(parts[2], 36);
  if (!parts[0] || !Number.isInteger(seq) || seq < 1 || !Number.isFinite(ts)) return null;
  return { conv: parts[0], seq, ts };
}

/**
 * Split a search box string into words and filters:
 *   in:#channel   in:@person    from:@person    has:file    has:link
 *   before:2026-03-01   after:2026-03-01
 * Names are left as typed; the client resolves them against the workspace.
 * Returns { text, words, in, from, has, before, after, bad } with `before`
 * and `after` as local-midnight epoch ms (the end of the day for `before`),
 * `words` every normalized word of the text (stopwords included, for
 * verification), and `bad` the filters that could not be read.
 */
export function parseQuery(input) {
  const out = { text: '', words: [], in: null, from: null, has: [], before: null, after: null, bad: [] };
  const rest = [];
  for (const part of String(input || '').trim().split(/\s+/).filter(Boolean)) {
    const m = /^(in|from|has|before|after):(.+)$/i.exec(part);
    if (!m) {
      rest.push(part);
      continue;
    }
    const key = m[1].toLowerCase();
    const val = m[2];
    if (key === 'in') out.in = val.replace(/^#/, '');
    else if (key === 'from') out.from = val.replace(/^@/, '').toLowerCase();
    else if (key === 'has') {
      const v = val.toLowerCase();
      if (v === 'file' || v === 'files' || v === 'attachment') out.has.push('file');
      else if (v === 'link' || v === 'links' || v === 'url') out.has.push('link');
      else out.bad.push(part);
    } else {
      const d = parseDate(val);
      if (!d) out.bad.push(part);
      else if (key === 'before') out.before = d.end;
      else out.after = d.start;
    }
  }
  out.text = rest.join(' ');
  out.words = words(out.text);
  out.has = [...new Set(out.has)];
  return out;
}

/** YYYY-MM-DD, YYYY-MM, or YYYY in local time: { start, end } of that span. */
function parseDate(s) {
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : 0;
  const d = m[3] ? Number(m[3]) : 1;
  const start = new Date(y, mo, d);
  if (Number.isNaN(start.getTime()) || start.getMonth() !== mo || start.getDate() !== d) return null;
  const end = m[3] ? new Date(y, mo, d + 1) : m[2] ? new Date(y, mo + 1, 1) : new Date(y + 1, 0, 1);
  return { start: start.getTime(), end: end.getTime() - 1 };
}

/**
 * Does a message contain every word of the query? Runs on the current
 * text at query time, so edits and deletes never return stale hits, and
 * checks stopwords too, which the index itself never stored.
 */
export function matchesWords(text, query) {
  if (!query.length) return true;
  const have = new Set(words(text));
  return query.every((w) => have.has(w));
}
