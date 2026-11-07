/**
 * Resolve a COMPOSITE reference canvas without changing physical child sizes.
 * Native controls across both axes, leading offsets and reference factors use
 * doubling followed by ten refinements of the failed/feasible interval. The
 * projected envelope is the extent at that ruler, rather than the ruler itself.
 * A constant envelope needs only ordinary arrangement scaling.
 *
 * The caller reevaluates live leading coordinates, retains accepted allocation
 * dimensions and charges each probe to its layout operation budget. Divergent
 * references must reject; an arbitrary maximum canvas would change geometry.
 */
export const fitDiagramCompositeCanvas = (
  available: number,
  originalExtent: number,
  extentAt: (ruler: number) => number,
): number => {
  if (!(available > 0 && originalExtent > available)) return originalExtent;
  let rejected = available,
    accepted = available * 2;
  const measure = (ruler: number) => {
    if (!Number.isFinite(ruler))
      throw new Error("unbounded diagram composite reference canvas");
    const extent = extentAt(ruler);
    if (!Number.isFinite(extent) || extent < 0)
      throw new Error("invalid diagram composite reference extent");
    return extent;
  };
  let extent = measure(accepted);
  while (extent > accepted) {
    rejected = accepted;
    accepted *= 2;
    extent = measure(accepted);
  }
  for (let refinement = 0; refinement < 10; refinement++) {
    const midpoint = (rejected + accepted) / 2;
    if (midpoint === rejected || midpoint === accepted) break;
    if (measure(midpoint) <= midpoint) accepted = midpoint;
    else rejected = midpoint;
  }
  return measure(accepted);
};
