// Every search folds text alike: case and accents are ignored, characters
// read the same however they are encoded (full-width letters, ligatures
// such as "ﬁ"), and typed and curly apostrophes and the œ and æ ligatures
// match, as French text uses them. So "l'equipe" finds "L’équipe" and
// "coeur" finds "Cœur" in the library, the organization's directory, the
// command palette, and on a board. Plain ASCII, most text, is only
// lowercased.
export function fold(value) {
  const text = String(value);
  return /[^\x00-\x7f]/.test(text)
    ? text
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/[‘’ʼ]/g, "'")
        .replace(/œ/gi, "oe")
        .replace(/æ/gi, "ae")
        .toLocaleLowerCase()
    : text.toLocaleLowerCase();
}
// The words of a search, folded: each must be found, in any order, so
// extra spaces, line breaks and a space left by autocomplete do not count.
export const searchTerms = (query) => fold(query).split(/\s+/).filter(Boolean);
// How long each character is once folded, kept as texts are traced, so
// a long text in a script whose letters fold to several (Hangul syllables
// fold to their parts) costs a lookup a character.
const foldedLengths = new Map();
function foldedLength(ch) {
  let n = foldedLengths.get(ch);
  if (n === undefined) {
    if (foldedLengths.size >= 20_000) foldedLengths.clear();
    foldedLengths.set(ch, (n = fold(ch).length));
  }
  return n;
}
// Where a folded word first appears in a text as written, as [start, end),
// or null. Folding can change lengths (œ is "oe", a separate accent mark
// goes), so the text is traced from its start to the word's place in the
// folded text: `near`, when the caller has folded the text already.
export function foldedRange(text, word, near) {
  if (!/[^\x00-\x7f]/.test(text)) {
    const at = text.toLocaleLowerCase().indexOf(word);
    return at < 0 ? null : [at, at + word.length];
  }
  const at = near ?? fold(text).indexOf(word);
  if (at < 0) return null;
  let folded = 0,
    start = -1,
    index = 0;
  for (const ch of text) {
    const n = foldedLength(ch);
    // Accent marks folded away stay with the letter before them.
    if (start >= 0 && folded >= at + word.length && n) return [start, index];
    if (start < 0 && folded + n > at) start = index;
    folded += n;
    index += ch.length;
  }
  return start < 0 ? null : [start, index];
}
// The words around a folded word in a text: a few before it, cut at a word
// break, the word as written, and what follows, with an ellipsis where the
// text goes on. Null when the word is not there.
export function wordContext(text, word, near) {
  const range = foldedRange(text, word, near);
  if (!range) return null;
  const [start, end] = range;
  let from = Math.max(0, start - 40);
  if (from) {
    const space = text.indexOf(" ", from);
    if (space >= 0 && space < start) from = space + 1;
    else if (/[\udc00-\udfff]/.test(text[from])) from++;
  }
  let to = Math.min(text.length, end + 120);
  if (to < text.length && /[\ud800-\udbff]/.test(text[to - 1])) to--;
  return {
    before: (from ? "…" : "") + text.slice(from, start),
    hit: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? "…" : ""),
  };
}
