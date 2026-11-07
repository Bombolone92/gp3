import { normalizeColor } from './colors.js';
import { compoundBorderMetrics } from './border-patterns.js';

export const BORDER_SIDES = Object.freeze(['top', 'left', 'bottom', 'right', 'between', 'bar']);
export const BORDER_STYLES = Object.freeze({ none: 'None', single: 'Single', double: 'Double', triple: 'Triple', thinThickSmallGap: 'Thin and thick, small gap', thickThinSmallGap: 'Thick and thin, small gap', thinThickMediumGap: 'Thin and thick, medium gap', thickThinMediumGap: 'Thick and thin, medium gap', thinThickLargeGap: 'Thin and thick, large gap', dotted: 'Dotted', dashed: 'Dashed', dashSmallGap: 'Short dashed', dotDash: 'Dot dash', dotDotDash: 'Dot dot dash' });

/** One side replaces a complete CT_Border declaration. Missing sides inherit. */
export function checkedParagraphBorder(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose a paragraph border.');
  if (!Object.keys(value).every(key => ['style', 'size', 'space', 'color', 'frame', 'shadow', 'theme'].includes(key))) throw new Error('Unknown paragraph border property.');
  const { style, size = 0, space = 0, color = 'auto', frame = false, shadow = false } = value;
  if (!Object.hasOwn(BORDER_STYLES, style) && style !== 'nil') throw new Error('This paragraph border style is not supported yet.');
  if (!Number.isInteger(size) || size < 0 || size > 96 || size === 1) throw new Error('Border width must be zero or 0.25–12 points in eighth-point steps.');
  if (!Number.isInteger(space) || space < 0 || space > 31) throw new Error('Border spacing must be a whole number from 0–31 points.');
  if (typeof frame !== 'boolean' || typeof shadow !== 'boolean') throw new Error('Border frame and shadow settings must be on or off.');
  if (shadow && !['none', 'nil'].includes(style)) throw new Error('Paragraph border shadows are not supported yet.');
  const result = { style, size, space, color: normalizeColor(color), frame, shadow };
  // Retain theme provenance for grouping. Equal RGB fallbacks with different
  // theme declarations do not make otherwise different border sets identical.
  if (value.theme) result.theme = structuredClone(value.theme);
  return result;
}

export function checkedParagraphBorders(value, allowInherit = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Choose paragraph borders.');
  if (Object.keys(value).some(side => !BORDER_SIDES.includes(side))) throw new Error('Unknown paragraph border side.');
  return Object.fromEntries(BORDER_SIDES.filter(side => Object.hasOwn(value, side)).map(side => [side, value[side] === null && allowInherit ? null : checkedParagraphBorder(value[side])]));
}

// The large-gap compound border has fixed 1.44pt/0.72pt ink bands.
// Its size controls the gap, rounded down to 600dpi units with a one-unit floor.
// The independent paragraph/table reference controls include size zero.
export const borderWidth = border => !border || ['none', 'nil'].includes(border.style) ? 0
  : border.style === 'thinThickLargeGap' ? 2.88 + Math.max(1, Math.floor(border.size * 25 / 24)) * .16
  : compoundBorderMetrics(border)?.reduce((sum, width) => sum + width, 0) ?? border.size / 6;
export const borderOutset = border => borderWidth(border) ? borderWidth(border) + border.space * 4 / 3 : 0;
export const visibleParagraphBorders = borders => BORDER_SIDES.some(side => side !== 'bar' && borderWidth(borders?.[side]));
export const sameParagraphBorders = (a, b) => BORDER_SIDES.every(side => JSON.stringify(a?.[side] ?? null) === JSON.stringify(b?.[side] ?? null));

export const paragraphBorderInsets = block => borderOutset(block?.format?.paragraphBorders?.top) + borderOutset(block?.format?.paragraphBorders?.bottom);
