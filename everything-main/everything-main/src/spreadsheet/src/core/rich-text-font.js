import { fontStack } from './format.js';

/** The same effective font is used by canvas measurement and character spans. */
export function richTextFont(base, style, zoom = 1) {
  if (!style) return base;
  const match = /^(.*?)([\d.]+)px\s+(.+)$/.exec(base);
  if (!match) return base;
  const italic = style.italic ?? /\b(?:italic|oblique)\b/.test(match[1]);
  const bold = style.bold ?? /\b(?:bold|[6-9]00)\b/.test(match[1]);
  const size = style.size ? style.size * zoom : Number(match[2]);
  return `${italic ? 'italic ' : ''}${bold ? '600 ' : ''}${size}px ${fontStack(style.font) || match[3]}`;
}

export function richTextMeasure(base, measure, zoom = 1) {
  const fonts = new Map();
  return (text, part) => {
    const style = part?.s;
    if (!style) return measure(text, base);
    let font = fonts.get(style);
    if (!font) { font = richTextFont(base, style, zoom); fonts.set(style, font); }
    return measure(text, font);
  };
}

export function largestRichTextSize(parts, fallback) {
  let size = fallback;
  for (const part of parts || []) if (part.text && part.s?.size) size = Math.max(size, part.s.size);
  return size;
}
