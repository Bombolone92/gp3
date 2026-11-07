// Line-break opportunities and English hyphenation for the text layout.
//
// Breaks follow a simplified Unicode Line Breaking Algorithm (UAX #14): after
// spaces, after hyphens and dashes between word characters, around CJK
// ideographs and kana (with a small kinsoku set so closing punctuation never
// starts a line and opening brackets never end one), after zero-width space
// and soft hyphen. Hyphenation is a rule-based English heuristic (no
// dictionary): it is a fallback for justified columns, not a typesetting
// authority, and it is deliberately conservative.

export const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '　' || ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ' || ch === ' ';
// No-break space separates but never breaks.
const breakingSpace = (ch: string) => isSpace(ch) && ch !== ' ';

export function isCJK(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x2e80 && c <= 0x2fdf) || // radicals
    (c >= 0x3040 && c <= 0x30ff) || // hiragana, katakana
    (c >= 0x3100 && c <= 0x312f) || // bopomofo
    (c >= 0x3130 && c <= 0x318f) || // hangul compatibility jamo
    (c >= 0x31f0 && c <= 0x31ff) ||
    (c >= 0x3400 && c <= 0x4dbf) || // CJK extension A
    (c >= 0x4e00 && c <= 0x9fff) || // CJK unified ideographs
    (c >= 0xac00 && c <= 0xd7af) || // hangul syllables
    (c >= 0xf900 && c <= 0xfaff) || // compatibility ideographs
    (c >= 0xff00 && c <= 0xffef) || // fullwidth forms
    (c >= 0x3000 && c <= 0x303f) || // CJK punctuation
    (c >= 0x20000 && c <= 0x2fa1f)
  );
}
// Kinsoku: characters that must not start a line / must not end one.
const NO_START = new Set([...'、。，．・：；？！ー゛゜ヽヾゝゞ々〻‐゠–〜～）〕］｝〉》」』】〙〗〟’”｠»ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ!),.:;?]}%']);
const NO_END = new Set([...'（〔［｛〈《「『【〘〖〝‘“｟«([{']);
const HYPHENS = new Set(['-', '‐', '‒', '–', '—']);
const wordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

// For clusters (grapheme strings) of one paragraph, true at i when a line may
// end after cluster i. The last cluster is left false (paragraph end).
export function breakOpportunities(clusters: string[]): boolean[] {
  const n = clusters.length;
  const out = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n - 1; i++) {
    const a = clusters[i], b = clusters[i + 1];
    const a0 = a[a.length - 1], b0 = b[0];
    if (breakingSpace(a0)) out[i] = !NO_START.has(b0) || breakingSpace(b0);
    else if (a0 === '​' || a0 === '­') out[i] = true;
    else if (HYPHENS.has(a0)) out[i] = wordChar(clusters[i - 1]?.slice(-1)) && wordChar(b0);
    else if ((isCJK(a0) || isCJK(b0)) && !isSpace(b0)) out[i] = !NO_START.has(b0) && !NO_END.has(a0);
  }
  return out;
}

// ---------------------------------------------------------------- hyphenation

const VOWELS = new Set([...'aeiouy']);
const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh', 'ck', 'qu']);
const BLENDS = new Set(['bl', 'br', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'sc', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'tr', 'tw', 'wr', 'th', 'ch', 'sh', 'ph']);
const SUFFIXES = ['tion', 'sion', 'ment', 'ness', 'less', 'able', 'ible', 'ful', 'ing'];
const PREFIXES = ['under', 'inter', 'trans', 'super', 'over', 'anti', 'dis', 'mis', 'non', 'out', 'un', 're'];

export type HyphenOptions = { minWord?: number; minBefore?: number; minAfter?: number; capitalized?: boolean };

// Offsets inside `word` where a hyphen may be inserted (sorted, unique).
export function hyphenationPoints(word: string, opts: HyphenOptions = {}): number[] {
  const minWord = opts.minWord ?? 6, minBefore = opts.minBefore ?? 2, minAfter = opts.minAfter ?? 3;
  if (word.length < minWord || !/^[A-Za-z]+$/.test(word)) return [];
  if (!opts.capitalized && /^[A-Z]/.test(word)) return [];
  const w = word.toLowerCase();
  const n = w.length;
  const points = new Set<number>();
  const hasVowel = (s: string) => /[aeiouy]/.test(s);
  const isVowel = (i: number) => VOWELS.has(w[i]) && !(w[i] === 'y' && i === 0) && !(w[i] === 'u' && w[i - 1] === 'q');

  for (const s of SUFFIXES) if (w.endsWith(s) && hasVowel(w.slice(0, n - s.length).replace(/^y/, ''))) points.add(n - s.length);
  for (const p of PREFIXES) {
    const rest = w.slice(p.length);
    // Short prefixes only count before a consonant ("un-happy", not "un-iform").
    if (w.startsWith(p) && rest.length >= 4 && hasVowel(rest) && (p.length > 3 || !VOWELS.has(rest[0]))) {
      points.add(p.length);
      break;
    }
  }

  // Syllable nuclei: vowel groups, ignoring silent endings.
  let end = n;
  // Consonant + "le(s)" at the end is its own syllable ("ta-ble", "ta-bles").
  const cle = /[^aeiouy]les?$/.test(w);
  const cleE = w.endsWith('s') ? n - 2 : n - 1;
  if (/[^aeiouy]e$/.test(w)) end = n - 1; // silent final e
  if (cle) end = cleE;
  if (/[^td]ed$/.test(w)) end = n - 2; // "jumped"
  if (/[^sxzh]es$/.test(w) && !/[^aeiouy]les$/.test(w)) end = n - 2;
  const groups: [number, number][] = [];
  for (let i = 0; i < end; ) {
    if (!isVowel(i)) { i++; continue; }
    let j = i;
    while (j < end && isVowel(j)) j++;
    groups.push([i, j]);
    i = j;
  }
  if (cle) groups.push([cleE, cleE + 1]);
  for (let g = 0; g + 1 < groups.length; g++) {
    const c0 = groups[g][1], c1 = groups[g + 1][0];
    const cons = w.slice(c0, c1);
    let at: number;
    if (cons.length === 0) continue;
    if (cle && g + 1 === groups.length - 1) at = c1 - 2; // before "Cle"
    else if (cons.length === 1) at = cons === 'x' ? c1 : c0; // V-CV, but ex-am
    else if (cons.length === 2) at = cons === 'ck' ? c1 : DIGRAPHS.has(cons) ? c0 : c0 + 1;
    else {
      const last2 = cons.slice(-2), first2 = cons.slice(0, 2);
      at = DIGRAPHS.has(first2) ? c0 + 2 : BLENDS.has(last2) ? c1 - 2 : c0 + 1;
    }
    points.add(at);
  }
  return [...points].filter((p) => p >= minBefore && n - p >= minAfter).sort((a, b) => a - b);
}
