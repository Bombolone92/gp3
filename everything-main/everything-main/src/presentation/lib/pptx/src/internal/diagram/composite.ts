import type { DiagramLayoutRect, DiagramLayoutSize } from "./arrange.ts";
import { deriveDiagramCompositeAxis } from "./composite-axis.ts";

/** Evaluated geometric constraint values for one composite child, in mm. */
export interface DiagramCompositeConstraints {
  readonly l?: number;
  readonly ctrX?: number;
  readonly r?: number;
  readonly w?: number;
  readonly t?: number;
  readonly ctrY?: number;
  readonly b?: number;
  readonly h?: number;
}
export type DiagramCompositeCoordinates = Required<DiagramCompositeConstraints>;

const finite = (value: number): number => {
  if (!Number.isFinite(value))
    throw new Error("non-finite diagram composite geometry");
  return value;
};

const axis = (
  available: number,
  start: number | undefined,
  center: number | undefined,
  end: number | undefined,
  length: number | undefined,
): { start: number; center: number; end: number; length: number } => {
  if (finite(available) < 0)
    throw new Error("negative diagram composite available size");
  for (const value of [start, center, end, length])
    if (value !== undefined) finite(value);

  const result = deriveDiagramCompositeAxis(
    available,
    start,
    center,
    end,
    length,
    {
      zero: 0,
      add: (a, b) => a + b,
      subtract: (a, b) => a - b,
      scale: (value, factor) => value * factor,
      absolute: Math.abs,
    },
  );
  return {
    start: finite(result.start),
    center: finite(result.center),
    end: finite(result.end),
    length: finite(result.length),
  };
};

/**
 * Derive a composite child's coordinate variables from evaluated constraints.
 * Any two of start/center/end/length determine an axis. Explicit
 * length takes priority, then start/end, then center, independent of declaration
 * order. Missing values are distinct from explicit zero. Native controls also
 * cover one-coordinate defaults, conflicting extra coordinates and negatives.
 * Keep these variables for reference evaluation: they are not interchangeable
 * with a drawing rectangle's edges. A center-only declaration retains its
 * center even though start/end/length are zero; inverted edge pairs retain
 * their signed positions even though the resulting extent becomes positive.
 *
 * The caller resolves scopes/references and supplies values for the current
 * adjustment pass. Fitting and group alignment follow in
 * arrangeDiagramChildren. This function does not read cached drawing geometry
 * or mutate source constraints.
 */
export const resolveDiagramCompositeCoordinates = (
  available: DiagramLayoutSize,
  values: DiagramCompositeConstraints,
): DiagramCompositeCoordinates => {
  const horizontal = axis(
    available.w,
    values.l,
    values.ctrX,
    values.r,
    values.w,
  );
  const vertical = axis(available.h, values.t, values.ctrY, values.b, values.h);
  return {
    l: horizontal.start,
    ctrX: horizontal.center,
    r: horizontal.end,
    w: horizontal.length,
    t: vertical.start,
    ctrY: vertical.center,
    b: vertical.end,
    h: vertical.length,
  };
};

/** Preferred drawing rectangle; reference evaluation uses the full coordinates. */
export const resolveDiagramCompositeRect = (
  available: DiagramLayoutSize,
  values: DiagramCompositeConstraints,
): DiagramLayoutRect => {
  const coordinates = resolveDiagramCompositeCoordinates(available, values);
  return {
    x: coordinates.l,
    y: coordinates.t,
    w: coordinates.w,
    h: coordinates.h,
  };
};
