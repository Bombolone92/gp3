// The caller owns save/restore. Clip in physical page coordinates before
// entering the cell's local reading axes; all ordinary glyph/decorations
// retain the existing painter and their original font shaping.
export function enterCellText(context, physical, page) {
  if (!physical.cellText) return { line: physical, geometry: page };
  const clip = physical.cellClip;
  context.beginPath();
  context.rect(clip.left, clip.top, clip.right - clip.left, clip.bottom - clip.top);
  context.clip();
  context.transform(...physical.cellText.matrix);
  return { line: physical.cellText.line, geometry: physical.cellText.geometry };
}

// Keep the physical cell clip and the outer canvas scale/translation. Only
// cancel the cell's local text transform while painting an upright picture.
export function leaveCellText(context, matrix) {
  const [a, b, c, d, e, f] = matrix, determinant = a * d - b * c;
  context.transform(d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant);
}
