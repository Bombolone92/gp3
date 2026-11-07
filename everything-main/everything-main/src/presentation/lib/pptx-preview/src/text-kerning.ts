/**
 * Resolve DrawingML kerning after font autofit. An explicit zero disables
 * kerning, and a 12pt threshold applies when the format cascade supplies
 * none. Native reference controls cover omitted/zero/positive thresholds, the
 * exact boundary and an authored 24pt run shrunk to 12pt.
 *
 * The 12pt default follows native reference output; the standard describes
 * the omitted threshold as zero with kerning allowed at every size.
 */
export const textKerning = (
  sizePt: number,
  thresholdHundredths?: number,
): "normal" | "none" => {
  const threshold = thresholdHundredths ?? 1200;
  return threshold > 0 && sizePt >= threshold / 100 ? "normal" : "none";
};
