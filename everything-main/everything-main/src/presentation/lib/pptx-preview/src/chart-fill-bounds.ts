/** Full, unstroked series geometry in chart pixels, before plot clipping. */
export interface ChartFillFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Point = readonly [number, number];

export const chartPointBounds = (
  points: ReadonlyArray<Point>,
): ChartFillFrame => {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  return {
    x: left,
    y: top,
    w: Math.max(Number.EPSILON, right - left),
    h: Math.max(Number.EPSILON, bottom - top),
  };
};

// Area paths are generated locally with absolute M/L/C/Z commands. Include
// cubic extrema rather than control points or only the displayed vertices.
export const chartAreaPathBounds = (path: string): ChartFillFrame => {
  const points: Point[] = [];
  let current: Point = [0, 0];
  for (const match of path.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const numbers = (
      match[2]!.match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? []
    ).map(Number);
    if (match[1] === "M" || match[1] === "L") {
      current = [numbers[0]!, numbers[1]!];
      points.push(current);
    } else if (match[1] === "C") {
      const p0 = current,
        p1: Point = [numbers[0]!, numbers[1]!],
        p2: Point = [numbers[2]!, numbers[3]!],
        p3: Point = [numbers[4]!, numbers[5]!];
      points.push(p0, p3);
      for (const axis of [0, 1] as const) {
        const a = -p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis],
          b = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]),
          c = p1[axis] - p0[axis],
          discriminant = b * b - 4 * a * c,
          roots =
            a === 0
              ? b === 0
                ? []
                : [-c / b]
              : discriminant < 0
                ? []
                : [
                    (-b + Math.sqrt(discriminant)) / (2 * a),
                    (-b - Math.sqrt(discriminant)) / (2 * a),
                  ];
        for (const t of roots)
          if (t > 0 && t < 1) {
            const at = (i: 0 | 1) =>
              (1 - t) ** 3 * p0[i] +
              3 * (1 - t) ** 2 * t * p1[i] +
              3 * (1 - t) * t * t * p2[i] +
              t ** 3 * p3[i];
            points.push([at(0), at(1)]);
          }
      }
      current = p3;
    }
  }
  return chartPointBounds(points);
};

/** Each pie/ring segment owns its fill bounds, including the inner endpoints. */
export const chartSliceBounds = (
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): ChartFillFrame => {
  const at = (r: number, a: number): Point => [
      cx + r * Math.cos(a),
      cy + r * Math.sin(a),
    ],
    points: Point[] = [
      at(outer, start),
      at(outer, end),
      at(inner, start),
      at(inner, end),
    ],
    quarter = Math.PI / 2;
  for (let k = Math.ceil(start / quarter); k * quarter < end; k++)
    points.push(at(outer, k * quarter));
  return chartPointBounds(points);
};
