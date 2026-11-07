// DrawingML preset dash lengths are multiples of the pen width.
export const DRAWING_DASHES = Object.freeze({
  solid: [], dot: [1, 3], dash: [4, 3], lgDash: [8, 3],
  dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3],
  sysDash: [3, 1], sysDot: [1, 1], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1],
});

export function drawingLineDash(dash = 'solid', cap = 'flat') {
  const lengths = DRAWING_DASHES[dash];
  // Round/square caps extend half a pen width at each end. The engine keeps the
  // preset's visible dash/gap lengths by compensating the centerline pattern.
  return cap === 'flat' ? lengths : lengths.map((length, i) => length + (i % 2 ? 1 : -1));
}
