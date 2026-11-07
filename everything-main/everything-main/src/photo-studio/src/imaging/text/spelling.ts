// Spell checking against a bundled word list (public/dictionaries, see
// docs/third-party.md). The list is ordered from common to rare words, so a
// word's position doubles as its frequency rank for ranking suggestions.
//
// Checking accepts a lowercase dictionary word written Capitalized or in ALL
// CAPS, possessives of known words and curly apostrophes. Suggestions are the
// words within an optimal-string-alignment distance of 2 (insert, delete,
// substitute, swap neighbours), found by scanning the words of nearby lengths
// with a banded distance that stops early, plus splits of run-together words.

import { ungzip } from 'pako';

export type Misspelling = { start: number; end: number; word: string };

const normalizeApostrophes = (w: string) => w.replace(/[’ʼ]/g, "'");
const isLower = (w: string) => w === w.toLowerCase();
const isCapitalized = (w: string) => w.length > 1 && w[0] !== w[0].toLowerCase() && isLower(w.slice(1));
const isAllCaps = (w: string) => w === w.toUpperCase() && w !== w.toLowerCase();
const LATIN_WORD = /^[\p{Script=Latin}\p{M}']+$/u;

/** Optimal string alignment distance of `a` and `b`, or `max + 1` once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  if (!n || !m) return Math.max(n, m);
  let prev2 = new Array<number>(m + 1).fill(0);
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  let cur = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ai === bj ? 0 : 1));
      if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) d = Math.min(d, prev2[j - 2] + 1);
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return Math.min(prev[m], max + 1);
}

export class SpellChecker {
  // Exact spellings and their rank (position in the list).
  private exact = new Map<string, number>();
  // Lowercase form -> best rank among its spellings, and the preferred spelling.
  private folded = new Map<string, { rank: number; word: string }>();
  // Lowercase forms grouped by length, for the suggestion scan.
  private byLength: string[][] = [];
  private ignored = new Set<string>();
  private next = 0;

  constructor(words: string[] | string = []) {
    const list = typeof words === 'string' ? words.split(/\r?\n/) : words;
    for (const w of list) this.insert(w.trim());
  }
  get size() {
    return this.exact.size;
  }
  private insert(word: string) {
    if (!word || this.exact.has(word)) return;
    const w = normalizeApostrophes(word);
    const rank = this.next++;
    this.exact.set(w, rank);
    const low = w.toLowerCase();
    const f = this.folded.get(low);
    if (!f) {
      this.folded.set(low, { rank, word: w });
      (this.byLength[low.length] ??= []).push(low);
    }
  }
  /** Add a word for this session (a user dictionary entry). */
  add(word: string) {
    this.insert(normalizeApostrophes(word.trim()));
  }
  /** Accept this exact word everywhere until cleared. */
  ignore(word: string) {
    this.ignored.add(normalizeApostrophes(word));
  }
  clearIgnored() {
    this.ignored.clear();
  }

  /** True when the word is spelled correctly (or is not checkable). */
  check(word: string): boolean {
    const w = normalizeApostrophes(word).replace(/^'+|'+$/g, '');
    if (!w || this.ignored.has(w)) return true;
    if (/\d/.test(w) || !LATIN_WORD.test(w)) return true;
    if (this.known(w)) return true;
    // Possessives of known words.
    const m = /^(.+)'s$/i.exec(w);
    if (m && this.known(m[1])) return true;
    if (/s'$/i.test(w) && this.known(w.slice(0, -1))) return true;
    return false;
  }
  private known(w: string): boolean {
    if (this.exact.has(w)) return true;
    const low = w.toLowerCase();
    if (isLower(w)) return false;
    // A lowercase word may be Capitalized or written in capitals; proper names
    // may be written in capitals.
    if ((isCapitalized(w) || isAllCaps(w)) && this.exact.has(low)) return true;
    if (isAllCaps(w) && this.folded.has(low)) return true;
    return false;
  }

  /** Up to `max` corrections, best first, in the case pattern of `word`. */
  suggest(word: string, max = 8): string[] {
    const w = normalizeApostrophes(word);
    const low = w.toLowerCase();
    // Among equally distant words, prefer the same letters (a swap), then the
    // same first letter and length, then the more common word.
    const letters = (x: string) => [...x.toLowerCase()].sort().join('');
    const key = letters(low);
    type Hit = { word: string; dist: number; rank: number; first: boolean; same: boolean; len: boolean };
    const hits = new Map<string, Hit>();
    const consider = (cand: string, dist: number, rank: number) => {
      const prev = hits.get(cand);
      if (!prev || dist < prev.dist) hits.set(cand, { word: cand, dist, rank, first: cand[0]?.toLowerCase() === low[0], same: letters(cand) === key, len: cand.length === low.length });
    };
    for (let len = Math.max(1, low.length - 2); len <= low.length + 2; len++) {
      for (const cand of this.byLength[len] ?? []) {
        if (cand === low) continue;
        const d = editDistance(low, cand, 2);
        if (d <= 2) {
          const f = this.folded.get(cand)!;
          consider(f.word, d, f.rank);
        }
      }
    }
    // A missing space: "thisis" -> "this is".
    for (let i = 1; i < low.length; i++) {
      const a = this.folded.get(low.slice(0, i)), b = this.folded.get(low.slice(i));
      if (a && b && (i > 1 || a.word === 'a' || a.word === 'I') && (low.length - i > 1 || b.word === 'a' || b.word === 'I'))
        consider(`${a.word} ${b.word}`, 1, Math.max(a.rank, b.rank) + 1);
    }
    // Only the exact case differs (e.g. "english" -> "English").
    const f = this.folded.get(low);
    if (f && f.word !== w) consider(f.word, 0, f.rank);
    const ranked = [...hits.values()].sort((a, b) => a.dist - b.dist || Number(b.same) - Number(a.same) || Number(b.first) - Number(a.first) || Number(b.len) - Number(a.len) || a.rank - b.rank || a.word.localeCompare(b.word));
    const out: string[] = [];
    for (const h of ranked) {
      const cased = matchCase(w, h.word);
      if (!out.includes(cased)) out.push(cased);
      if (out.length >= max) break;
    }
    return out;
  }

  /** Words in `text` that fail `check`, with their UTF-16 ranges. Words in
   * URLs and e-mail addresses, and words joined to digits, are skipped. */
  misspellings(text: string): Misspelling[] {
    return tokenize(text).filter((t) => !this.check(t.word));
  }
}

/** Apply the case pattern of `model` (Capitalized or ALL CAPS) to `word`;
 * words with their own capitals (proper names) keep them. */
export function matchCase(model: string, word: string): string {
  if (!isLower(word)) return isAllCaps(model) && model.length > 1 ? word.toUpperCase() : word;
  if (isAllCaps(model) && model.length > 1) return word.toUpperCase();
  if (model[0] && model[0] !== model[0].toLowerCase()) return word[0].toUpperCase() + word.slice(1);
  return word;
}

/** Checkable words of `text` with their ranges. */
export function tokenize(text: string): Misspelling[] {
  const out: Misspelling[] = [];
  const chunk = /\S+/g;
  for (let c = chunk.exec(text); c; c = chunk.exec(text)) {
    const s = c[0];
    if (/:\/\/|^www\.|@|^[\w-]+\.(com|org|net|io|dev|app|edu|gov)\b/i.test(s)) continue;
    const word = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
    for (let m = word.exec(s); m; m = word.exec(s)) {
      const before = s[m.index - 1], after = s[m.index + m[0].length];
      if ((before && /\d/.test(before)) || (after && /\d/.test(after))) continue;
      out.push({ start: c.index + m.index, end: c.index + m.index + m[0].length, word: m[0] });
    }
  }
  return out;
}

/** Decode a word list file: plain UTF-8 text, or gzip-compressed (a server
 * may already have decompressed it). */
export function decodeWordList(bytes: Uint8Array): string[] {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? ungzip(bytes) : bytes;
  return new TextDecoder().decode(raw).split(/\r?\n/).filter(Boolean);
}

let shared: Promise<SpellChecker> | undefined;
/** The English checker, loaded once from `url` (relative to the app). */
export function englishChecker(url: string): Promise<SpellChecker> {
  shared ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`The dictionary could not be loaded (${r.status}).`);
      return r.arrayBuffer();
    })
    .then((b) => new SpellChecker(decodeWordList(new Uint8Array(b))))
    .catch((error) => {
      shared = undefined;
      throw error;
    });
  return shared;
}
