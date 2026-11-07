// Numeric OpenType post metrics from installed faces, independently checked
// against a native reference: tests/fixtures/native-underlines/reference.json. No font
// bytes or glyphs are bundled. Canvas does not expose underline metrics; its
// underscore ink bounds differ from post and must not be used as a substitute.
// Values: cached line ascent/descent, regular position/thickness, bold pair.
// All four reviewed families use the same underline metrics for italic faces.
const faces = new Map([
  ['arial', [1921, 434, 217, 150, 217, 215]],
  ['calibri', [1950, 550, 232, 134, 232, 134]],
  ['times new roman', [1912, 443, 223, 100, 223, 195]],
  ['cambria', [1946, 455, 125, 116, 105, 156]],
]);

export function nativeUnderlineMetrics(family, style, metrics) {
  const face = faces.get(family?.trim().toLowerCase());
  // A missing/substituted or differently measured face keeps its existing
  // fallback metrics. Never apply a requested family's metrics to its fallback.
  if (!face || metrics.ascent !== face[0] / 2048 || metrics.descent !== face[1] / 2048) return metrics;
  const at = style?.bold ? 4 : 2;
  return { ...metrics, underlineOffset: face[at] / 2048, underlineThickness: face[at + 1] / 2048 };
}
