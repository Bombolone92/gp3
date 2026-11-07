/** Native (x14) data-bar geometry, expressed as fractions of the drawable cell. */
const clamp = x => Math.max(0, Math.min(1, x));
const hex = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;
export function nativeDataBarFraction(value, lo, hi) {
  if (lo === hi) return value === lo ? 0.5 : value < lo ? 0 : 1;
  // Values strictly outside the interval are clipped before interpolating.
  // If the finite endpoints' difference overflows, every value inside it
  // (including either endpoint) uses the midpoint of the configured lengths.
  // Keep the orientation: legacy bars allow descending endpoints.
  if (value < Math.min(lo, hi)) return lo < hi ? 0 : 1;
  if (value > Math.max(lo, hi)) return lo < hi ? 1 : 0;
  const span = hi - lo;
  return Number.isFinite(span) ? clamp((value - lo) / span) : 0.5;
}

export function extendedDataBar(rule, value, min, max, color, rightToLeft = false) {
  if (![value, min, max].every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  // Signed axes normalize reversed endpoints. Axis-free bars interpolate in
  // the original endpoint order, like legacy bars.
  const lo = Math.min(min, max), hi = Math.max(min, max);
  const start = (rule.barMinLength ?? 10) / 100, end = (rule.barMaxLength ?? 90) / 100;
  const mode = rule.barAxisPosition || 'automatic';
  const bounded = Math.max(lo, Math.min(hi, value));
  let axis = 0, length, reverse = false;
  if (mode === 'none') {
    length = start + nativeDataBarFraction(value, min, max) * (end - start);
  } else if (mode === 'automatic' && lo > 0) {
    length = start + nativeDataBarFraction(value, lo, hi) * (end - start);
  } else if (mode === 'automatic' && hi < 0) {
    axis = 1; reverse = true;
    length = start + nativeDataBarFraction(-value, -hi, -lo) * (end - start);
  } else {
    // Signed bars split the minimum length between the two sides. The unused
    // maximum-length margin is centered when locating an automatic zero axis.
    const scale = Math.max(Math.abs(lo), Math.abs(hi));
    const span = hi - lo;
    // Keep the native arithmetic: a centered bar divides by twice
    // the scale (which can overflow). An overflowing automatic interval
    // collapses to its upper stop, including the equal-stop midpoint and
    // strict outside clipping. Rescaling first changes both native results.
    const magnitude = !scale ? value === 0 ? 0 : 0.5
      : mode === 'middle' ? Math.abs(bounded) / (2 * scale)
        : Number.isFinite(span) ? Math.abs(bounded) / span : nativeDataBarFraction(value, hi, hi);
    axis = mode === 'middle' || !scale ? 0.5 : lo >= 0 ? 0
      : (1 - end + start) / 2 + (-lo / span) * (end - start);
    length = start / 2 + magnitude * (end - start);
    reverse = (scale ? bounded : value) < 0;
  }
  length = clamp(length);
  let left = reverse ? axis - length : axis;
  const mirror = rule.barDirection === 'rightToLeft' || (rule.barDirection == null || rule.barDirection === 'context') && rightToLeft;
  if (mirror) { left = 1 - left - length; axis = 1 - axis; reverse = !reverse; }
  const negative = value < 0;
  const fill = negative && !rule.barNegativeColorSame ? hex(rule.barNegativeColor, '#ff0000') : color;
  const border = hex(rule.barBorderColor, color);
  return { bar: length, barStart: clamp(left), barReverse: reverse, barColor: fill,
    barNative: true, barFullHeight: true, barGradient: rule.barGradient !== false,
    ...(rule.barBorder ? { barBorderColor: negative && rule.barNegativeBorderColorSame === false ? hex(rule.barNegativeBorderColor, '#ff0000') : border } : {}),
    ...(mode !== 'none' && axis > 0 && axis < 1 ? { barAxis: axis, barAxisColor: hex(rule.barAxisColor, '#000000') } : {}),
    ...(rule.barOnly ? { barOnly: true } : {}) };
}
