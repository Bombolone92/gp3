// Decimal conversion keeps 15 significant digits. Its normalized
// 0.significand * 10^scale representation accepts scales from -308 through 308;
// values below the smallest normal binary64 number become zero. This is text
// and literal conversion, not a limit on subsequent arithmetic results.
export const MAX_NUMBER_TEXT = 255;
const MIN_NORMAL = 2 ** -1022;
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Parse normalized decimal text, or return null when it cannot be converted.
 * VALUE incorporates its percent into the decimal scale before conversion.
 * NUMBERVALUE validates the unscaled number first, then applies its percent(s).
 */
export function parseDecimalText(text, decimalShift = 0, validateUnscaled = false) {
  return text.length > MAX_NUMBER_TEXT ? null : parseDecimal(text, decimalShift, validateUnscaled);
}

/** Decimal syntax shared by formula literals and text conversion. The text
 * functions' 255-character argument limit does not constrain formula tokens.
 */
export function parseDecimal(text, decimalShift = 0, validateUnscaled = false) {
  const match = DECIMAL.exec(text);
  if (!match || !(match[2] || match[3])) return null;
  const integer = match[2], fraction = match[3] || '', digits = integer + fraction;
  const first = digits.search(/[1-9]/);
  // For all-zero text, fractional zeros still advance the decimal scale.
  const leading = first < 0 ? digits.length : first;
  const scale = Number(match[4] || 0) + integer.length - leading;
  const checkedScale = scale + (validateUnscaled ? 0 : decimalShift);
  if (checkedScale < -308 || checkedScale > 308 || !Number.isFinite(checkedScale)) return null;
  const significant = digits.slice(leading, leading + 15) || '0';
  const value = Number(`${match[1]}${significant}e${scale + decimalShift - significant.length}`);
  if (!Number.isFinite(value)) return null;
  return Math.abs(value) < MIN_NORMAL ? 0 : value;
}
