import { FULL_CASE_FOLDS } from '../../vendor/unicode-case-folds.js';

/** Native comparisons fold compatible letter forms while preserving accents
 * and combining marks (including Greek iota subscripts). This differs from
 * both ordinary lowercasing and full case folding of the entire string.
 */
function foldText(text, form) {
  if (!/[^\x00-\x7f]/.test(text)) return text.toLowerCase();
  const normalized = (form === 'NFKD' ? text.replace(/\p{Zs}/gu, ' ') : text).normalize(form);
  return Array.from(normalized, ch => {
    if (/\p{Mark}/u.test(ch)) return ch;
    const cp = ch.codePointAt(0);
    return cp < 128 ? ch.toLowerCase() : FULL_CASE_FOLDS.get(cp) ?? ch;
  }).join('').normalize('NFD');
}

/** Canonical case-equivalent spellings share prefix exhaustion behavior.
 * Compatibility forms (width, circled letters, spacing forms) do not: they
 * can collate alike without behaving as the same prefix of a longer string.
 */
export const foldPrefixText = text => foldText(text, 'NFD');
export const foldComparisonText = text => foldText(text, 'NFKD');

let collator;
const PLAIN_TEXT = /^[ 0-9A-Za-z]*$/;

/** Broad linguistic ordering for an index of already folded text. Every
 * pairwise match belongs to one collation group, but prefix differences can
 * make members of that group unequal. Index callers must still test matches.
 */
export function compareFoldedText(x, y) {
  if (x === y) return 0;
  if (PLAIN_TEXT.test(x) && PLAIN_TEXT.test(y)) return x < y ? -1 : 1;
  collator ??= new Intl.Collator(undefined, { sensitivity: 'accent', ignorePunctuation: false });
  return collator.compare(x, y);
}

/** Text comparison orders exhausted common prefixes by length before applying
 * linguistic collation to other differences. Prefixes use canonical case
 * folding, before compatibility folding. Thus trailing ignorable text
 * differs from its prefix, although internal ignorable text can compare
 * equal. This is a pairwise comparison, not a transitive identity key.
 */
export function compareSpreadsheetText(a, b) {
  const x = foldPrefixText(a), y = foldPrefixText(b);
  if (x === y) return 0;
  if (x.startsWith(y)) return 1;
  if (y.startsWith(x)) return -1;
  if (PLAIN_TEXT.test(x) && PLAIN_TEXT.test(y)) return x < y ? -1 : 1;
  return compareFoldedText(foldComparisonText(a), foldComparisonText(b));
}

/** Fold fixed UTF-16 windows without normalizing a long overlapping substring
 * at every search position. Boundaries before a starter are independent under
 * NFD; combining sequences remain together. Only partial boundary sequences
 * need fresh folding, including a window that splits a surrogate pair.
 */
export function foldedTextWindows(text) {
  const starts = [0], canonicalOffsets = [0], broadOffsets = [0];
  const groups = new Int32Array(text.length);
  const canonical = [], broad = [];
  const characters = new Map();
  let units = 0, canonicalLength = 0, broadLength = 0, prefixParts = [], broadParts = [];
  const flush = () => {
    const prefix = prefixParts.length === 1 ? prefixParts[0] : prefixParts.join('').normalize('NFD');
    const comparison = broadParts.length === 1 ? broadParts[0] : broadParts.join('').normalize('NFD');
    canonical.push(prefix); broad.push(comparison);
    canonicalLength += prefix.length; broadLength += comparison.length;
    prefixParts = []; broadParts = [];
  };
  for (const ch of text) {
    let folded = characters.get(ch);
    if (!folded) { folded = [foldPrefixText(ch), foldComparisonText(ch)]; characters.set(ch, folded); }
    const [prefix, comparison] = folded;
    if (units && !/^\p{Mark}/u.test(prefix) && !/^\p{Mark}/u.test(comparison)) {
      flush(); starts.push(units);
      canonicalOffsets.push(canonicalLength); broadOffsets.push(broadLength);
    }
    groups.fill(starts.length - 1, units, units + ch.length);
    prefixParts.push(prefix); broadParts.push(comparison); units += ch.length;
  }
  flush(); starts.push(text.length);
  canonicalOffsets.push(canonicalLength); broadOffsets.push(broadLength);
  const prefixText = canonical.join(''), comparisonText = broad.join('');
  return (from, to) => {
    if (from === to) return ['', ''];
    const first = groups[from], last = groups[to - 1];
    const partialHead = from !== starts[first], partialTail = to !== starts[last + 1];
    if (first === last && (partialHead || partialTail)) {
      const raw = text.slice(from, to);
      return [foldPrefixText(raw), foldComparisonText(raw)];
    }
    const left = partialHead ? first + 1 : first, right = partialTail ? last : last + 1;
    let prefix = prefixText.slice(canonicalOffsets[left], canonicalOffsets[right]);
    let comparison = comparisonText.slice(broadOffsets[left], broadOffsets[right]);
    if (partialHead) {
      const raw = text.slice(from, starts[first + 1]);
      prefix = foldPrefixText(raw) + prefix; comparison = foldComparisonText(raw) + comparison;
    }
    if (partialTail) {
      const raw = text.slice(starts[last], to);
      prefix += foldPrefixText(raw); comparison += foldComparisonText(raw);
    }
    return [prefix, comparison];
  };
}
