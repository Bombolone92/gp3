// OOXML uses signed twentieths of a point, limited to ±22 inches.
export const CHARACTER_SPACING_LIMIT = 1584;
export function checkedCharacterSpacing(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > CHARACTER_SPACING_LIMIT || Math.abs(value * 20 - Math.round(value * 20)) > 1e-8) throw new Error('Character spacing must be −1584 to 1584 pt in 0.05 pt steps.');
  return Math.round(value * 20) / 20 || 0;
}
export function checkSpacedAdvance(width, previous, style) {
  if (style.characterSpacing < 0 && width < previous - 1e-6) throw new Error('This character spacing makes text advance backwards. Use less condensed spacing or a larger font.');
}
