import { textFillColor, visibleUnderline } from './text-fill.js';
import { UnsupportedDocumentError } from './errors.js';
import { inlineSegments } from './images.js';

export const UNDERLINE_STYLES = Object.freeze({ none: 'None', single: 'Single', words: 'Words only', double: 'Double', thick: 'Thick', dotted: 'Dotted', dottedHeavy: 'Heavy dotted', dash: 'Dashed', dashedHeavy: 'Heavy dashed', dashLong: 'Long dashed', dashLongHeavy: 'Heavy long dashed', dotDash: 'Dash-dot', dashDotHeavy: 'Heavy dash-dot', dotDotDash: 'Dash-dot-dot', dashDotDotHeavy: 'Heavy dash-dot-dot', wave: 'Wavy', wavyHeavy: 'Heavy wavy', wavyDouble: 'Double wavy' });
export function checkedUnderline(value) {
  if (typeof value !== 'string' || !Object.hasOwn(UNDERLINE_STYLES, value)) throw new UnsupportedDocumentError('invalid underline pattern');
  return value;
}
export function underlinePattern(style = {}) {
  style ||= {};
  if (style.underlineStyle !== undefined) checkedUnderline(style.underlineStyle);
  if (style.underline === false) return 'none';
  return style.underlineStyle && style.underlineStyle !== 'none' ? style.underlineStyle : style.underline ? 'single' : 'none';
}
// Keep the legacy boolean API as an alias for single/none. The enum is carried
// through effective formatting and history; imported missing attributes inherit.
export function underlineDeclaration(patch = {}, nullable = false) {
  patch ||= {};
  if (!('underline' in patch) && !('underlineStyle' in patch)) return patch;
  const pattern = 'underlineStyle' in patch ? patch.underlineStyle : patch.underline === null && nullable ? null : patch.underline ? 'single' : 'none';
  if (pattern !== null || !nullable) checkedUnderline(pattern);
  const enabled = pattern === null ? null : pattern !== 'none';
  if ('underline' in patch && patch.underline !== enabled) throw new Error('Underline flag and pattern disagree.');
  return { ...patch, underline: enabled, underlineStyle: pattern };
}
export const underlineSpace = text => /\p{White_Space}/u.test(text);
const nativeMetricPatterns = new Set(['single', 'words', 'dotted', 'dash', 'dashLong', 'dotDash', 'dotDotDash']);
export function underlineGeometry(pattern, metrics) {
  // Ordinary rules use post metrics. Heavy/double/wavy decorations
  // use separate size-dependent rules: do not enlarge their existing preview
  // approximation by feeding it the thicker native single-rule metric.
  const native = metrics.nativeUnderlineThickness !== undefined && nativeMetricPatterns.has(pattern);
  return { offset: native ? metrics.nativeUnderlineOffset : metrics.underlineOffset, thickness: native ? metrics.nativeUnderlineThickness : metrics.underlineThickness };
}
export function underlineSpan(style, metrics, x, width, phase = 0) {
  const pattern = underlinePattern(style);
  return { pattern, phase, x, width, ...underlineGeometry(pattern, metrics), fontSize: style.fontSize,
    verticalAlign: style.verticalAlign, baselineShift: style.baselineShift, color: !style.underlineColor || style.underlineColor === 'auto' ? textFillColor(style) : style.underlineColor, highlight: style.highlight, shading: style.shading };
}

export function markerUnderlines(text, style, metrics, measure) {
  const pattern = underlinePattern(style);
  if (pattern === 'none' || !visibleUnderline(style)) return [];
  if (pattern !== 'words') return [underlineSpan(style, metrics, 0, metrics.width)];
  const spans = []; let prefix = '', width = 0, span;
  for (const { segment } of inlineSegments(text)) {
    prefix += segment; const next = measure(prefix, style).width;
    if (underlineSpace(segment)) span = null;
    else { if (!span) { span = underlineSpan(style, metrics, width, 0); spans.push(span); } span.width = next - span.x; }
    width = next;
  }
  return spans;
}

// Original preview geometry. OOXML names the shapes but does not fix dash
// lengths, wave amplitudes or double-line gaps. All distances derive from the
// bundled font's underline thickness after vertical display transforms.
export function underlineInk(span) {
  const { x, width, offset: y, thickness: t, phase = 0 } = span, pattern = span.pattern || 'single';
  const rects = [], waves = [];
  if (width <= 0 || t <= 0 || pattern === 'none') return { rects, waves };
  const heavy = /Heavy$/.test(pattern) || pattern === 'thick', thickness = t * (heavy ? 2 : 1);
  if (['wave', 'wavyHeavy', 'wavyDouble'].includes(pattern)) {
    const period = 8 * t, amplitude = t, start = -((phase % period + period) % period);
    for (const shift of pattern === 'wavyDouble' ? [0, 3 * t] : [0]) {
      const curve = [], center = y + amplitude + thickness / 2 + shift;
      for (let at = start; at < width; at += period) {
        curve.push([x + at, center, x + at + period / 4, center - 4 / 3 * amplitude, x + at + period / 4, center - 4 / 3 * amplitude, x + at + period / 2, center]);
        curve.push([x + at + period / 2, center, x + at + 3 * period / 4, center + 4 / 3 * amplitude, x + at + 3 * period / 4, center + 4 / 3 * amplitude, x + at + period, center]);
      }
      waves.push({ curve, thickness });
    }
    return { rects, waves };
  }
  if (pattern === 'double') { for (const shift of [0, 2 * t]) rects.push({ x, y: y + shift, width, height: t }); return { rects, waves }; }
  const units = { dotted: [1, 2], dottedHeavy: [1, 2], dash: [4, 2], dashedHeavy: [4, 2], dashLong: [8, 3], dashLongHeavy: [8, 3], dotDash: [4, 2, 1, 2], dashDotHeavy: [4, 2, 1, 2], dotDotDash: [4, 2, 1, 2, 1, 2], dashDotDotHeavy: [4, 2, 1, 2, 1, 2] }[pattern];
  if (!units) rects.push({ x, y, width, height: thickness });
  else {
    const lengths = units.map(v => v * thickness), period = lengths.reduce((a,b) => a+b, 0);
    for (let at = -((phase % period + period) % period); at < width;) {
      for (let i = 0; i < lengths.length; i++) { const end = at + lengths[i]; if (!(i % 2) && end > 0 && at < width) rects.push({ x: x + Math.max(0, at), y, width: Math.min(width, end) - Math.max(0, at), height: thickness }); at = end; }
    }
  }
  return { rects, waves };
}
