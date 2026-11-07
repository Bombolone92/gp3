import { UnsupportedDocumentError } from './errors.js';

export const KERNING_LIMIT = 1638.5;
export function checkedKerning(value) {
  if (!Number.isFinite(value) || value < 0 || value > KERNING_LIMIT || !Number.isInteger(value * 2)) throw new UnsupportedDocumentError('kerning thresholds outside 0–1638.5 pt in half-point steps');
  return value || 0;
}
// Zero means disabled; positive thresholds compare stored sz,
// before the separate superscript/subscript and horizontal text transforms.
export const kerningEnabled = style => (style.kerning || 0) > 0 && (style.fontSize ?? 12) >= style.kerning;
