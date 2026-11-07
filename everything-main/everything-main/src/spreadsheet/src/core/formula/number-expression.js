import { parseDecimal } from './number-text.js';

/** Encode a finite binary64 constant for generated formulas. Decimal
 * literals lose digits past the fifteenth and cannot cover the full arithmetic
 * range. Split the significand into small exact integers and scale by a power
 * of two instead. The final multiplication flushes subnormal results to zero,
 * matching what the workbook computes when opened in Excel.
 */
export function numberExpression(value) {
  if (!Number.isFinite(value)) throw new RangeError('A formula constant must be finite');
  const text = String(value);
  if (parseDecimal(text) === value) return text;
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, Math.abs(value));
  const upper = bits.getUint32(0), lower = bits.getUint32(4);
  const exponent = (upper >>> 20) & 0x7ff;
  const significand = (upper & 0xfffff) * 2 ** 32 + lower + (exponent ? 2 ** 52 : 0);
  // A 26/27-bit split keeps every literal within 15 decimal digits. Normalize
  // before multiplying so the intermediate power never underflows for normals.
  const high = Math.floor(significand / 2 ** 27), low = significand - high * 2 ** 27;
  return `(${value < 0 ? '-' : ''}(${high}+${low}/${2 ** 27})/${2 ** 25}*2^(${exponent ? exponent - 1023 : -1022}))`;
}
