import { normalizeColor, paintColor } from './colors.js';

// ECMA-376 Part 1 §17.18.40, including its exact dark/gray sRGB values.
export const HIGHLIGHTS = Object.freeze({ none: null, yellow: 'FFFF00', green: '00FF00', cyan: '00FFFF', magenta: 'FF00FF', blue: '0000FF', red: 'FF0000', darkBlue: '00008B', darkCyan: '008B8B', darkGreen: '006400', darkMagenta: '800080', darkRed: '8B0000', darkYellow: '808000', darkGray: 'A9A9A9', lightGray: 'D3D3D3', black: '000000', white: 'FFFFFF' });
export const highlightLabel = value => value === 'none' ? 'No highlight' : value.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase());
export function checkedHighlight(value) {
  if (typeof value !== 'string' || !Object.hasOwn(HIGHLIGHTS, value)) throw new Error('Choose a supported highlight color or No highlight.');
  return value;
}
export function checkedShading(value) {
  return value === 'foreground' ? value : normalizeColor(value);
}
export const cellShadingFill = value => !value || value === 'auto' ? null : runBackground({ shading: value });
export function runBackground(style, background = '#FFFFFF') {
  const highlight = HIGHLIGHTS[style.highlight];
  if (highlight) return `#${highlight}`;
  return foregroundBackground(style, background);
}
// Automatic ink resolves against shading, ignoring highlight overlays.
export function foregroundBackground(style, background = '#FFFFFF') {
  if (style.shading === 'foreground') return paintColor('auto', background);
  return style.shading && style.shading !== 'auto' ? `#${style.shading}` : background;
}
export const hasRunBackground = style => !!HIGHLIGHTS[style.highlight] || !!style.shading && style.shading !== 'auto';

// Each run background extends to the shared text band, even for a small
// run beside a larger one. Exact-spaced body lines fill their entire line box;
// extra automatic/minimum leading and square-wrap clearance are not shaded.
export function runBackgroundRect(line, span) {
  const before = line.wrapBefore || 0;
  return { x: span.x, width: span.width,
    y: line.clip ? line.y + before : line.baseline - (line.ascent ?? span.ascent),
    height: line.clip ? line.height - before : (line.ascent ?? span.ascent) + (line.descent ?? span.descent) };
}
