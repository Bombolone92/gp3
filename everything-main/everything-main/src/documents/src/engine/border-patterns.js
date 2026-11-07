/** Native reference widths in CSS pixels, independently quantized to 600dpi. */
export function compoundBorderMetrics(border) {
  if (!['thinThickSmallGap', 'thickThinSmallGap', 'thinThickMediumGap', 'thickThinMediumGap'].includes(border.style)) return null;
  const full = Math.max(1, Math.floor(border.size * 25 / 24)) * .16;
  if (border.style === 'thinThickSmallGap') return [full, .96, .96];
  if (border.style === 'thickThinSmallGap') return [.96, .96, full];
  if (border.style === 'thickThinMediumGap' || border.style === 'thinThickMediumGap') {
    const half = Math.max(1, Math.floor(border.size * 25 / 48)) * .16;
    return border.style === 'thinThickMediumGap' ? [full, half, half] : [half, half, full];
  }
  return null;
}

/** Continuous ink bands across a resolved border's thickness, in CSS pixels. */
export function borderBands(border, thickness, side) {
  const compound = compoundBorderMetrics(border);
  if (compound) {
    const reverse = border.frame && ['bottom', 'right'].includes(side);
    const first = compound[reverse ? 2 : 0], last = compound[reverse ? 0 : 2];
    return [[0, first], [thickness - last, last]];
  }
  if (border.style === 'thinThickLargeGap') {
    const reverse = border.frame && ['bottom', 'right'].includes(side);
    const first = reverse ? .96 : 1.92, last = reverse ? 1.92 : .96;
    return [[0, first], [thickness - last, last]];
  }
  if (border.style === 'double' || border.style === 'triple') {
    const count = border.style === 'double' ? 2 : 3, size = thickness / (count * 2 - 1);
    return Array.from({ length: count }, (_, i) => [i * 2 * size, size]);
  }
  return ['single', 'thick'].includes(border.style) ? [[0, thickness]] : null;
}
