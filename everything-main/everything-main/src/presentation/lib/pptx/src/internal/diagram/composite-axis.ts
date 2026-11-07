/** The same composite algebra can evaluate numbers or build dependency cells. */
export interface DiagramScalarArithmetic<T> {
  readonly zero: T;
  add(a: T, b: T): T;
  subtract(a: T, b: T): T;
  scale(value: T, factor: number): T;
  absolute(value: T): T;
}

/**
 * Preserve the dependency of each coordinate separately. An explicit length,
 * for example, does not depend on the start position. Eagerly resolving a whole
 * rectangle would introduce false cycles between otherwise independent axes
 * or between a shape's width and its sibling's position.
 */
export const deriveDiagramCompositeAxis = <T>(
  available: T,
  start: T | undefined,
  center: T | undefined,
  end: T | undefined,
  length: T | undefined,
  math: DiagramScalarArithmetic<T>,
): { start: T; center: T; end: T; length: T } => {
  if (length !== undefined) {
    // An explicit negative extent is normalized before deriving position.
    length = math.absolute(length);
    if (start !== undefined) {
      end = math.add(start, length);
      center = math.add(start, math.scale(length, 0.5));
    } else if (end !== undefined) {
      start = math.subtract(end, length);
      center = math.add(start, math.scale(length, 0.5));
    } else {
      start =
        center !== undefined
          ? math.subtract(center, math.scale(length, 0.5))
          : math.zero;
      end = math.add(start, length);
      center = center ?? math.scale(length, 0.5);
    }
  } else if (start !== undefined) {
    if (end !== undefined) {
      length = math.subtract(end, start);
      center = math.add(start, math.scale(length, 0.5));
    } else if (center !== undefined) {
      length = math.scale(math.subtract(center, start), 2);
      end = math.add(start, length);
    } else {
      end = available;
      length = math.subtract(end, start);
      center = math.add(start, math.scale(length, 0.5));
    }
  } else if (end !== undefined) {
    start =
      center !== undefined
        ? math.subtract(math.scale(center, 2), end)
        : math.zero;
    length = math.subtract(end, start);
    center = center ?? math.add(start, math.scale(length, 0.5));
  } else {
    start = math.zero;
    // A lone center remains addressable but cannot determine an extent.
    length = center !== undefined ? math.zero : available;
    end = length;
    center = center ?? math.scale(length, 0.5);
  }
  // Derived negative extents retain the coordinates from their input edge pair.
  return { start, center, end, length: math.absolute(length) };
};
