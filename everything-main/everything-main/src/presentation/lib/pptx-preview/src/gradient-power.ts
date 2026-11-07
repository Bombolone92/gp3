/** Resolved, ordered stops in the renderer's sRGB color space. */
interface ColorStop {
  readonly offset: number;
  readonly color: string;
  readonly opacity?: number;
}

/** The two-color compatibility interpolation also applies to three stops
 * with matching outer RGBA. Positions must span the complete gradient; the
 * middle stop need not be centered. Other configurations use ordinary
 * premultiplied interpolation. Native reference controls distinguish equal RGB
 * from equal RGBA and confirm that alpha itself remains linear.
 */
export const gradientPowerTransfer = (stops: readonly ColorStop[]) => {
  if (stops.length !== 2 && stops.length !== 3) return null;
  const first = stops[0]!,
    second = stops[1]!,
    last = stops.at(-1)!;
  if (first.offset !== 0 || last.offset !== 1) return null;
  if (
    stops.length === 3 &&
    (!(second.offset > 0 && second.offset < 1) ||
      first.color.toUpperCase() !== last.color.toUpperCase() ||
      (first.opacity ?? 1) !== (last.opacity ?? 1))
  )
    return null;
  if (
    stops.some(
      (s) =>
        !/^#[0-9a-f]{6}$/i.test(s.color) ||
        !Number.isFinite(s.opacity ?? 1) ||
        (s.opacity ?? 1) < 0 ||
        (s.opacity ?? 1) > 1,
    )
  )
    return null;
  // Constant RGB needs no nonlinear operation, even when alpha varies.
  if (
    first.color.toUpperCase() === second.color.toUpperCase() ||
    stops.every((s) => s.opacity === 0)
  )
    return null;
  const channels = [1, 3, 5].map((i) => {
    const a = parseInt(first.color.slice(i, i + 2), 16) / 255;
    const b = parseInt(second.color.slice(i, i + 2), 16) / 255;
    return {
      descending: a >= b,
      amplitude: Math.min(a, b) - Math.max(a, b),
      offset: Math.max(a, b),
    };
  });
  const alpha = first.opacity ?? 1;
  return {
    channels,
    // Carry position in alpha, which is unaffected by color-space conversion
    // of SVG gradient inputs in filters. The matrix reconstructs RGB progress
    // and authored alpha before applying the per-channel power functions.
    matrix: channels
      .flatMap((c) => [0, 0, 0, c.descending ? 1 : -1, c.descending ? 0 : 1])
      .concat([0, 0, 0, (second.opacity ?? 1) - alpha, alpha]),
    exponent: 1.875,
  };
};
