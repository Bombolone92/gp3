/**
 * Highlighted words in text clips: clip.marks lists word indexes (0-based,
 * words split on spaces, as the renderer counts them) drawn in the style's
 * highlightColor. pickKeywords chooses words worth highlighting without
 * AI: the longest words that are not common filler, about one per short
 * caption.
 */

/** Words of a text, split on spaces (the renderer counts words the same way). */
export function wordsOf(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

/** Valid, sorted, unique word indexes for a text. */
export function normalizeMarks(marks, text) {
  if (!Array.isArray(marks)) return [];
  const n = wordsOf(text).length;
  return [...new Set(marks.filter((i) => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b).slice(0, 200);
}

const FILLER = new Set(('a an the and or but so if then than that this these those there here to of in on at by for with from up down out over into onto about as is am are was were be been being do does did have has had i me my mine you your yours he him his she her hers it its we us our they them their what which who whom whose when where why how not no yes just really very like um uh oh okay ok well also too can could would should will shall may might must get got going gonna wanna let lets let\'s think know thing things something stuff kind sort actually basically literally right yeah mean im i\'m you\'re it\'s that\'s don\'t can\'t won\'t'.split(' ')));

/** The bare word for comparisons: lower case, no punctuation at the ends. */
export const bareWord = (w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');

/**
 * Word indexes to highlight in a caption: up to `max` (by default one per
 * five words, at least one) of the longest words that are not filler,
 * numbers count as key words too.
 */
export function pickKeywords(text, max = null) {
  const words = wordsOf(text);
  const n = max ?? Math.max(1, Math.round(words.length / 5));
  const scored = words
    .map((w, i) => {
      const b = bareWord(w);
      if (!b || FILLER.has(b)) return null;
      const num = /\d/.test(b) ? 4 : 0;
      return { i, score: b.length + num + (/^\p{Lu}/u.test(w) && i > 0 ? 2 : 0) };
    })
    .filter((x) => x && x.score >= 4)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, n).map((x) => x.i).sort((a, b) => a - b);
}

/**
 * Word indexes for keywords an AI named for a line: each named word (or
 * phrase) is matched against the line's own words, ignoring case and
 * punctuation; anything not in the line is dropped. At most max per line.
 */
export function marksForNamed(line, named, max = 3) {
  const words = wordsOf(line).map(bareWord);
  const out = new Set();
  for (const n of Array.isArray(named) ? named : []) {
    for (const part of wordsOf(String(n ?? ''))) {
      const b = bareWord(part);
      const i = b ? words.indexOf(b) : -1;
      if (i >= 0) out.add(i);
    }
    if (out.size >= max) break;
  }
  return [...out].slice(0, max).sort((a, b) => a - b);
}
