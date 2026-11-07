import { foldPrefixText, foldComparisonText, compareFoldedText, foldedTextWindows } from './text-comparison.js';

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fixed-width literal runs compare linguistically; ? consumes one UTF-16
 * unit. Stars separate pieces searched only forwards, without backtracking
 * between pieces. Escapes are parsed before comparison/compatibility folding.
 */
export function wildcardMatcher(pattern) {
  const parts = [{ length: 0, chunks: [], source: '' }];
  let literal = '';
  const flush = () => {
    if (!literal) return;
    const part = parts[parts.length - 1];
    part.chunks.push({ text: literal, at: part.length, prefix: foldPrefixText(literal), broad: foldComparisonText(literal) });
    part.length += literal.length; part.source += escapeRegex(literal); literal = '';
  };
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~') { if (i + 1 < pattern.length) literal += pattern[++i]; continue; }
    if (ch === '*') {
      flush();
      if (parts.length === 1 || parts[parts.length - 1].length) parts.push({ length: 0, chunks: [], source: '' });
    } else if (ch === '?') {
      flush(); const part = parts[parts.length - 1]; part.length++; part.source += '.';
    } else literal += ch;
  }
  flush();
  const asciiPattern = PRINTABLE_ASCII.test(pattern);
  if (asciiPattern) for (const part of parts) {
    part.re = new RegExp(part.source, 'isy'); part.search = new RegExp(part.source, 'isg');
  }
  const first = parts[0], last = parts[parts.length - 1];

  const reader = text => {
    const ascii = asciiPattern && PRINTABLE_ASCII.test(text);
    let windows;
    // Repeated identical windows (including a long run of combining marks)
    // need no new normalization. Keep only one result per literal chunk.
    const recent = new Map();
    const at = (part, start) => {
      if (start < 0 || start + part.length > text.length) return false;
      if (ascii) { part.re.lastIndex = start; return part.re.test(text); }
      for (const chunk of part.chunks) {
        const from = start + chunk.at, to = from + chunk.text.length, raw = text.slice(from, to);
        if (raw === chunk.text) continue;
        const cached = recent.get(chunk);
        if (cached?.raw === raw) { if (!cached.equal) return false; continue; }
        windows ??= foldedTextWindows(text);
        const [prefix, broad] = windows(from, to);
        const equal = prefix === chunk.prefix || (!prefix.startsWith(chunk.prefix) && !chunk.prefix.startsWith(prefix)
          && compareFoldedText(broad, chunk.broad) === 0);
        recent.set(chunk, { raw, equal });
        if (!equal) return false;
      }
      return true;
    };
    const find = (part, start, end = text.length - part.length, unicodePositions = false) => {
      if (ascii) {
        part.search.lastIndex = start;
        const match = part.search.exec(text);
        return match && match.index <= end ? match.index : -1;
      }
      for (let i = start; i <= end; i += unicodePositions && text.codePointAt(i) > 0xffff ? 2 : 1) {
        if (at(part, i)) return i;
      }
      return -1;
    };
    return { at, find };
  };

  const whole = text => {
    const { at, find } = reader(text);
    if (!at(first, 0)) return false;
    if (parts.length === 1) return first.length === text.length;
    const end = text.length - last.length;
    let cursor = first.length;
    if (cursor > end || !at(last, end)) return false;
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i];
      const position = find(part, cursor, end - part.length);
      if (position < 0) return false;
      cursor = position + part.length;
    }
    return true;
  };
  whole.searchFrom = (text, from, unicodePositions) => {
    const { find } = reader(text);
    const start = find(first, from, undefined, unicodePositions);
    if (start < 0) return -1;
    let need = start + first.length;
    // SEARCH permits any suffix. The earliest match of each fixed piece
    // leaves the most room for the next; no earlier piece needs retrying.
    for (const part of parts.slice(1)) {
      const position = find(part, need);
      if (position < 0) return -1;
      need = position + part.length;
    }
    return start;
  };
  return whole;
}
