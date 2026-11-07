// The supported editing range; OOXML stores integer half-point units.
export const MAX_FONT_SIZE = 1638;
export function validFontSize(value) {
  return Number.isFinite(value) && value >= 1 && value <= MAX_FONT_SIZE && Number.isInteger(value * 2);
}
