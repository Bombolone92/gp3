/** Physical layout of number-format literals. Measurement stays with the host
 * so the same runs work at grid zoom, in print, and during column auto-fit. */
import { formatCodeParts, formatTextParts } from './numfmt.js';
import { normalizeRichText } from './rich-text.js';
import { MAX_TEXT } from './cell.js';
import { cellLayoutText, wrapLines } from './textfit.js';

export function numberFormatParts(value, style, richText = null) {
  const rich = richText && normalizeRichText(richText, value);
  let parts = rich ? style?.fmt === 'custom' ? formatTextParts(value, style.code) : [{ type: 'text', text: value, value: true }]
    : style?.fmt === 'custom' ? formatCodeParts(value, style.code) : null;
  if (rich) parts = parts.flatMap(part => part.value ? rich.map(run => ({ type: 'text', text: run.text, s: run.s, rich: true })) : [{ ...part, rich: true }]);
  return parts?.flatMap(part => part.type !== 'text' ? [part] : cellLayoutText(part.text, style?.wrap).split('\n').flatMap((text, i) => [...(i ? [{ type: 'break', ...(part.rich ? { rich: true, s: part.s } : {}) }] : []), { ...part, text }]));
}

export function measureFormatParts(parts, measure) {
  let width = 0, maximum = 0;
  for (const part of parts) {
    if (part.type === 'break') { maximum = Math.max(maximum, width); width = 0; }
    else if (part.type !== 'fill') width += measure(part.type === 'pad' ? part.char : part.text, part);
  }
  return Math.max(maximum, width);
}

/** Rotated fill is bounded by the row, not by the column. Solve the turned
 * line box's vertical extent for its unrotated length (also works at 90°). */
export function rotatedFormatWidth(height, lineHeight, angle) {
  const radians = Math.abs(angle) * Math.PI / 180;
  return Math.max(0, (height - lineHeight * Math.cos(radians)) / Math.sin(radians));
}

/** Keep padding as an indivisible measured box while using the ordinary text
 * wrapping rules. Private placeholders exist only during this measurement. */
export function wrappedFormatLineCount(parts, width, measure) {
  if (parts.some(part => part.rich)) return wrappedRichFormatLines(parts, width, measure).length;
  const source = parts.filter(p => p.type === 'text').map(p => p.text).join('');
  const pads = new Map();
  let next = 0xf0000;
  const text = parts.map(part => {
    if (part.type === 'text') return part.text;
    if (part.type === 'break') return '\n';
    if (part.type === 'fill') return '';
    while (source.includes(String.fromCodePoint(next))) next++;
    const marker = String.fromCodePoint(next++);
    pads.set(marker, measure(part.char));
    return marker;
  }).join('');
  if (!pads.size) return wrapLines(text, width, measure).length;
  const pattern = new RegExp('(' + [...pads.keys()].join('|') + ')', 'u');
  return wrapLines(text, width, text => text.split(pattern).reduce((sum, run) => sum + (pads.has(run) ? pads.get(run) : measure(run)), 0)).length;
}

/** Measure ranges by their positions, not by searching their text: repeated
 * words may have different fonts. Prefix widths and binary searches avoid
 * rescanning every character run for each attempted line break. */
export function wrappedRichFormatLines(parts, width, measure, baseSize = 13) {
  const source = parts.filter(part => part.type === 'text').map(part => part.text).join('');
  let text = '', marker = 0xf0000;
  const spans = [], prefix = [0];
  for (const part of parts) {
    if (part.type === 'fill') continue;
    let content = part.type === 'break' ? '\n' : part.text;
    if (part.type === 'pad') {
      while (source.includes(String.fromCodePoint(marker))) marker++;
      content = String.fromCodePoint(marker++);
    }
    if (!content) continue;
    const start = text.length;
    text += content;
    spans.push({ part, start, end: text.length });
    prefix.push(prefix.at(-1) + (part.type === 'break' ? 0 : measure(part.type === 'pad' ? part.char : content, part)));
  }
  const at = offset => {
    let lo = 0, hi = spans.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (spans[mid].end <= offset) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const partial = (i, start, end) => {
    const span = spans[i];
    if (!span || span.part.type === 'break') return 0;
    if (span.part.type === 'pad') return prefix[i + 1] - prefix[i];
    return measure(text.slice(Math.max(start, span.start), Math.min(end, span.end)), span.part);
  };
  const rangeWidth = (value, start) => {
    if (!value) return 0;
    const end = start + value.length, first = at(start), last = at(end - 1);
    return first === last ? partial(first, start, end)
      : partial(first, start, end) + prefix[last] - prefix[first + 1] + partial(last, start, end);
  };
  const lines = [];
  wrapLines(text, width, rangeWidth, (value, start) => {
    let size = baseSize;
    for (let i = at(start); i < spans.length && spans[i].start < start + Math.max(1, value.length); i++) size = Math.max(size, spans[i].part.s?.size || baseSize);
    lines.push({ text: value, start, size });
  });
  return lines;
}

export function layoutFormatParts(parts, width, measure) {
  // Fill is one operation for the complete formatted value, even when its
  // painted text contains explicit line breaks. Those breaks are budgeted as
  // spaces and only the last fill is used. A zero-advance fill has no layout role.
  const candidate = parts.findLast(part => part.type === 'fill');
  const advance = candidate ? measure(candidate.char, candidate) : 0;
  const fill = advance > 0 && Number.isFinite(advance) ? candidate : null;
  let naturalWidth = measureFormatParts(parts, measure), requiresFit = false;
  if (fill) {
    naturalWidth = 0;
    for (const part of parts) {
      // A leading fill can yield to text wrapping/spill. Once any content or
      // padding precedes it, the formatted value must fit the horizontal budget.
      if (part === fill) requiresFit = naturalWidth > 0;
      if (part.type !== 'fill') naturalWidth += measure(part.type === 'break' ? ' ' : part.type === 'pad' ? part.char : part.text, part);
    }
  }
  const room = Math.max(0, width - naturalWidth);
  const runs = parts.map(part => {
    if (part.type === 'break') return part;
    if (part.type === 'text') return { ...part, width: measure(part.text, part) };
    if (part.type === 'pad') return { ...part, width: measure(part.char, part) };
    const available = part === fill ? room : 0;
    if (part !== fill) return { ...part, text: '', width: 0 };
    // Measure the complete repeated run: kerning need not be additive. Bound
    // malformed/tiny-advance fonts by the same resource budget as cell text.
    const limit = Math.floor(MAX_TEXT / part.char.length);
    let low = 0, high = Math.min(limit, Math.ceil(available / advance) + 1);
    while (high < limit && measure(part.char.repeat(high), part) <= available) high = Math.min(limit, high * 2);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (measure(part.char.repeat(mid), part) <= available) low = mid; else high = mid - 1;
    }
    const text = part.char.repeat(low);
    return { ...part, text, width: measure(text, part) };
  });
  let lineWidth = 0, paintedWidth = 0;
  for (const run of runs) {
    if (run.type === 'break') { paintedWidth = Math.max(paintedWidth, lineWidth); lineWidth = 0; }
    else lineWidth += run.width;
  }
  return { runs, naturalWidth, requiresFit, width: Math.max(paintedWidth, lineWidth), availableWidth: Math.max(naturalWidth, width) };
}
