import { breakAfter } from './intrinsic-widths.js';

// The modern line fitter compares shrinkage with expansion of the shorter
// line. Shrinkage has twice the cost, and an ordinary space loses at most 25%.
// The caller supplies natural advances; this never changes source formatting.
export function contractionLimit(full, previous, spaces, previousSpaces, right) {
  if (!spaces || full <= right) return 0;
  const loss = full - right;
  return loss <= spaces * .25 + 1e-6 &&
    (previousSpaces === 0 || 2 * loss / spaces <= (right - previous) / previousSpaces + 1e-6)
    ? loss / spaces : null;
}

export function contractionMetrics(measure) {
  const cache = new Map();
  return style => {
    const key = [style.fontFamily, style.fontSize, style.bold, style.italic, style.characterSpacing,
      style.textScale, style.capitalization, style.verticalAlign, style.baselineShift].join('/');
    let width = cache.get(key);
    if (width === undefined) {
      // Fixed-pitch faces retain their advances. Test geometry, not a font name.
      width = Math.abs(measure('i', style).width - measure('W', style).width) < 1e-6
        ? 0 : measure(' ', style).width;
      cache.set(key, width);
    }
    return width;
  };
}

// Invoked only on natural overflow. Look ahead no farther than the next word,
// and stop as soon as even the maximum contraction cannot fit its prefix.
export function fitContractedWord(chars, start, end, lastBreak, scanner, right, spaceWidth) {
  if (lastBreak <= start || scanner.fields.length !== 1 || chars[end].image || /\s/u.test(chars[end].text)) return null;
  let first = start;
  while (chars[first]?.text === ' ' || chars[first]?.ignoredCellBreak) first++;
  let previousEnd = lastBreak;
  while (previousEnd > start && (chars[previousEnd - 1].text === ' ' || chars[previousEnd - 1].ignoredCellBreak)) previousEnd--;
  if (previousEnd === start) return null;
  let spaces = 0, previousSpaces = 0;
  for (let i = first; i < end; i++) {
    if (chars[i].text === ' ') {
      const width = spaceWidth(chars[i].style);
      spaces += width;
      if (i < previousEnd) previousSpaces += width;
    }
  }
  const previous = scanner.field.origin + scanner.field.stops[previousEnd - start].x;
  let i = end;
  for (;;) {
    if (scanner.end - right > spaces * .25 + 1e-6) return null;
    i++;
    if (i === chars.length || breakAfter(chars[i - 1].text, chars[i - 1].image, chars[i - 1].noBreakHyphen, chars[i - 1].wordBreak) || /[\s\u000e]/u.test(chars[i].text) && breakAfter(chars[i].text, chars[i].image, chars[i].noBreakHyphen)) break;
    if (chars[i].image) return null;
    scanner.add(chars[i]);
  }
  // Discretionary hyphen alternatives need their visible hyphen advance and
  // a separate comparison with the unhyphenated word. Keep the existing fit.
  if (chars[i - 1].text === '\u00ad' || chars[lastBreak - 1].text === '\u00ad') return null;
  const fraction = contractionLimit(scanner.end, previous, spaces, previousSpaces, right);
  if (fraction === null || fraction === 0) return null;
  const contentEnd = i;
  if (!scanner.page.wrapTrailSpaces) while (chars[i]?.text === ' ' || chars[i]?.ignoredCellBreak) i++;
  return { end: i, first, contentEnd, fraction, spaces };
}
