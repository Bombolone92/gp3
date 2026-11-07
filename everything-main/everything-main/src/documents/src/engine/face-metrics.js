// The MS Gothic collection takes additional automatic-line leading which
// neither its zero hhea/OS/2 lineGap nor CSS normal line height exposes.
// Independent native controls: tests/fixtures/mixed-symbol-line-metrics/.
// These are measured metric facts, not bundled font data. Match the measured
// base geometry too, so a substituted or changed face retains native metrics.
const gothicFaces = new Set(['ms gothic', 'ms pgothic', 'ms ui gothic']);
export function measuredFaceMetrics(family, metrics) {
  // YaHei also adds symmetric native leading not exposed by CSS normal.
  // 46 independent cases: tests/fixtures/native-heading-line-metrics/.
  // Guard the measured face geometry; never correct a substituted font.
  if (family?.trim().toLowerCase() === 'microsoft yahei' &&
      metrics.ascent === 2167 / 2048 && metrics.descent === 536 / 2048) {
    return {ascent: metrics.ascent + 405 / 2048, descent: metrics.descent + 405 / 2048};
  }
  if (gothicFaces.has(family?.trim().toLowerCase()) &&
      metrics.ascent === 220 / 256 && metrics.descent === 36 / 256) {
    return {ascent: metrics.ascent + 38 / 256, descent: metrics.descent + 38 / 256};
  }
  return metrics;
}
