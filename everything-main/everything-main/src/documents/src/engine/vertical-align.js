import {preparedScriptMetrics} from './script-font-size.js';

export function checkedVerticalAlign(value) {
  if (!['baseline', 'subscript', 'superscript'].includes(value)) throw new Error('Choose baseline, subscript or superscript text.');
  return value;
}

export function checkedBaselineShift(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 200 || Math.abs(value * 2 - Math.round(value * 2)) > 1e-9) throw new Error('Baseline shift must be −200 to 200 pt in half-point steps.');
  return Math.round(value * 2) / 2 || 0;
}

// Unavailable metrics retain the existing Noto-derived fallback transform.
// Scripts stay at the preceding run's advance even for italic faces;
// copying the font's recommended horizontal script offset adds a false gap.
// Keep the stored point size intact: these are display transforms.
export function scriptGeometry(style) {
  if (!style.verticalAlign || style.verticalAlign === 'baseline') return null;
  const em = (style.fontSize ?? 12) * 4 / 3, sub = style.verticalAlign === 'subscript';
  const {size,position}=preparedScriptMetrics(style),scale=size===null?null:size/(style.scriptReferenceSize??style.fontSize??12);
  return { scaleX: scale??.65, scaleY: scale??.6, offsetX: 0, offsetY: position===null?em*(sub?.075:-.35):position*4/3 };
}
