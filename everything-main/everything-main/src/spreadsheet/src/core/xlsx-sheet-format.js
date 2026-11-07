// Excel initializes a worksheet without sheetFormatPr to 16 points, separately
// from the Normal-font auto-fit of materialized rows. Keep the absent element
// on export: adding an automatic or custom default changes native layout.
export const XLSX_IMPLICIT_ROW_HEIGHT = 16 * 4 / 3;

/** Original default-height semantics, valid only while its pixel cache matches. */
export function normalizeNativeDefaultHeight(value) {
  if (!value || !Number.isFinite(value.pixels) || value.pixels <= 0) return null;
  if (value.mode !== 'auto' && !(value.mode === 'implicit' && value.pixels === XLSX_IMPLICIT_ROW_HEIGHT)) return null;
  return { pixels: value.pixels, mode: value.mode };
}
