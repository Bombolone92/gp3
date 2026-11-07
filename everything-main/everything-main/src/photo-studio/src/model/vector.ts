import { isVectorGradient, validateVectorGradient, type VectorGradient } from "./vector-gradient";
import { validatePsdBounds, type PsdLayerBounds } from "./psd-layer-bounds";
import type { LayerVectorMask } from "ag-psd";
import { assertSize, type Rect, type Layer } from "./document";
import {
  validateVectorStroke,
  supportedStrokePaths,
  type VectorStroke,
} from "./vector-stroke";
import { isVectorPattern, validateVectorPattern, type VectorPattern } from './vector-pattern';
import { validateLiveShape, type LiveShape } from './live-shape';

// Points remain editable cubic knots (incoming control, anchor, outgoing
// control). ag-psd has already decoded PSD's signed 8.24 document coordinates.
// Compiled boolean geometry and raster coverage are disposable render products.
export type VectorMask = LayerVectorMask;
// A cubic whose controls lie on the anchor segment has exactly that segment's
// filled geometry. Keep source knots, but emit a line for scan conversion.
export function linearVectorSegment(a: number[], b: number[]) {
  const dx = b[2] - a[2],
    dy = b[3] - a[3],
    length = dx * dx + dy * dy;
  return [
    [a[4], a[5]],
    [b[0], b[1]],
  ].every(([x, y]) => {
    const px = x - a[2],
      py = y - a[3],
      dot = px * dx + py * dy;
    return length === 0
      ? px === 0 && py === 0
      : px * dy - py * dx === 0 && dot >= 0 && dot <= length;
  });
}
export type VectorColor = {
  rgb: [number, number, number];
  space: "document" | "srgb";
};
export type VectorShape = {
  mask: VectorMask;
  reference: Rect;
  // Original declarative layer rectangle, independent of editable path bounds.
  psdBounds?: PsdLayerBounds;
  fill: VectorColor | VectorPattern | VectorGradient;
  stroke?: VectorStroke;
  // Editable parameters of a shape drawn as a live rectangle, ellipse, etc.
  live?: LiveShape;
};

export function validateVectorShape(shape: VectorShape) {
  if (
    !shape ||
    !shape.reference ||
    !["x", "y", "width", "height"].every((key) =>
      Number.isFinite(shape.reference[key as keyof Rect]),
    ) ||
    shape.reference.width <= 0 ||
    shape.reference.height <= 0 ||
    !shape.fill
  )
    throw new Error("Invalid vector shape.");
  if (isVectorGradient(shape.fill)) validateVectorGradient(shape.fill);
  else if (isVectorPattern(shape.fill)) validateVectorPattern(shape.fill);
  else if (
    !["document", "srgb"].includes(shape.fill.space) ||
    !Array.isArray(shape.fill.rgb) ||
    shape.fill.rgb.length !== 3 ||
    !shape.fill.rgb.every(Number.isFinite)
  )
    throw new Error("Invalid vector shape color.");
  if (shape.psdBounds !== undefined) validatePsdBounds(shape.psdBounds);
  if (shape.live !== undefined) validateLiveShape(shape.live);
  validateVectorMask(shape.mask);
  if (shape.stroke) {
    validateVectorStroke(shape.stroke);
    if (!supportedStrokePaths(shape.mask, shape.stroke))
      throw new Error("Unsupported vector stroke path operations.");
  }
}

export function vectorMatrix(l: Layer): VectorMatrix {
  return l.vector!.mask.notLink ? identityVectorMatrix : vectorPaintMatrix(l);
}
export function vectorPaintMatrix(l: Layer): VectorMatrix {
  const v = l.vector!;
  const r = v.reference,
    t = l.transform,
    a = (t.rotation * Math.PI) / 180;
  const sx = t.width / r.width,
    sy = t.height / r.height;
  const c = Math.cos(a),
    s = Math.sin(a);
  const xx = c * sx,
    xy = -s * sy,
    yx = s * sx,
    yy = c * sy;
  return [
    xx,
    yx,
    xy,
    yy,
    t.x + t.width / 2 - xx * (r.x + r.width / 2) - xy * (r.y + r.height / 2),
    t.y + t.height / 2 - yx * (r.x + r.width / 2) - yy * (r.y + r.height / 2),
  ];
}

// PSD stores an integer axis-aligned layer rectangle. Preserve unedited
// records exactly; affine edits export a conservative enclosure of that box.
export function transformedVectorPsdBounds(
  l: Layer,
): PsdLayerBounds | undefined {
  const v = l.vector!,
    bounds = v.psdBounds;
  if (!bounds) return;
  validatePsdBounds(bounds);
  const r = v.reference,
    t = l.transform;
  if (t.rotation % 360 === 0 && t.width === r.width && t.height === r.height) {
    const dx = t.x - r.x,
      dy = t.y - r.y;
    if (Number.isInteger(dx) && Number.isInteger(dy)) {
      const shifted = {
        left: bounds.left + dx,
        right: bounds.right + dx,
        top: bounds.top + dy,
        bottom: bounds.bottom + dy,
      };
      validatePsdBounds(shifted);
      return shifted;
    }
  }
  const m = vectorPaintMatrix(l),
    points = [];
  for (const x of [bounds.left, bounds.right])
    for (const y of [bounds.top, bounds.bottom])
      points.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const minX = Math.min(...points.map((p) => p[0])),
    maxX = Math.max(...points.map((p) => p[0])),
    minY = Math.min(...points.map((p) => p[1])),
    maxY = Math.max(...points.map((p) => p[1]));
  const result = {
    left: minX === maxX ? Math.round(minX) : Math.floor(minX),
    right: minX === maxX ? Math.round(maxX) : Math.ceil(maxX),
    top: minY === maxY ? Math.round(minY) : Math.floor(minY),
    bottom: minY === maxY ? Math.round(maxY) : Math.ceil(maxY),
  };
  validatePsdBounds(result);
  return result;
}

export function transformedVectorMask(l: Layer): VectorMask {
  const mask = structuredClone(l.vector!.mask),
    m = vectorMatrix(l);
  for (const path of mask.paths)
    for (const knot of path.knots)
      for (let i = 0; i < 6; i += 2) {
        const x = knot.points[i],
          y = knot.points[i + 1];
        knot.points[i] = m[0] * x + m[2] * y + m[4];
        knot.points[i + 1] = m[1] * x + m[3] * y + m[5];
      }
  return mask;
}

// Evaluate the mask outside all finite contours to determine whether its
// support is unbounded (inversion, initial fill or a first subtraction).
export function vectorUnbounded(mask: VectorMask) {
  if (mask.disable) return true;
  const components = vectorComponents(mask);
  let outside =
    !!mask.fillStartsWithAllPixels ||
    ["subtract", "intersect"].includes(components[0]?.operation);
  for (const component of components)
    if (component.operation === "intersect") outside = false;
  return mask.invert ? !outside : outside;
}

export function vectorBounds(
  mask: VectorMask,
  matrix: VectorMatrix = identityVectorMatrix,
): Rect | null {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  const point = (p: number[], i: number) => [
    matrix[0] * p[i] + matrix[2] * p[i + 1] + matrix[4],
    matrix[1] * p[i] + matrix[3] * p[i + 1] + matrix[5],
  ];
  const include = (x: number, y: number) => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  const value = (p: number[], t: number) =>
    (1 - t) ** 3 * p[0] +
    3 * (1 - t) ** 2 * t * p[1] +
    3 * (1 - t) * t * t * p[2] +
    t ** 3 * p[3];
  for (const path of mask.paths) {
    for (const knot of path.knots)
      include(...(point(knot.points, 2) as [number, number]));
    const count = path.open ? path.knots.length - 1 : path.knots.length;
    for (let i = 0; i < count; i++) {
      const a = path.knots[i].points,
        b = path.knots[(i + 1) % path.knots.length].points;
      const points = [point(a, 2), point(a, 4), point(b, 0), point(b, 2)];
      for (let axis = 0; axis < 2; axis++) {
        const p = points.map((v) => v[axis]);
        const A = -p[0] + 3 * p[1] - 3 * p[2] + p[3],
          B = 2 * (p[0] - 2 * p[1] + p[2]),
          C = p[1] - p[0];
        const roots =
          A === 0
            ? B === 0
              ? []
              : [-C / B]
            : B * B - 4 * A * C < 0
              ? []
              : [
                  (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A),
                  (-B - Math.sqrt(B * B - 4 * A * C)) / (2 * A),
                ];
        for (const t of roots)
          if (t > 0 && t < 1)
            include(
              value(
                points.map((v) => v[0]),
                t,
              ),
              value(
                points.map((v) => v[1]),
                t,
              ),
            );
      }
    }
  }
  return Number.isFinite(left)
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}
export type VectorMatrix = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];
export const identityVectorMatrix: VectorMatrix = Object.freeze([
  1, 0, 0, 1, 0, 0,
]);
export type VectorRaster = {
  viewport: Rect;
  coverage: Uint8Array;
  // A resolved, viewport-local path is useful for inspecting/hit-testing the
  // exact same geometry. It never replaces the source knots in the document.
  path: string;
  fillRule: CanvasFillRule;
};
export type FloatVectorRaster = Omit<VectorRaster, "coverage"> & {
  coverage: Float32Array;
};

export function validateVectorMask(
  value: unknown,
): asserts value is VectorMask {
  const mask = value as VectorMask;
  if (!mask || !Array.isArray(mask.paths) || mask.paths.length > 65535)
    throw new Error("Invalid vector mask.");
  for (const flag of [
    mask.invert,
    mask.notLink,
    mask.disable,
    mask.fillStartsWithAllPixels,
  ])
    if (flag !== undefined && typeof flag !== "boolean")
      throw new Error("Invalid vector mask flags.");
  if (
    mask.clipboard &&
    !["top", "left", "bottom", "right", "resolution"].every((key) =>
      Number.isFinite(
        mask.clipboard![key as keyof NonNullable<VectorMask["clipboard"]>],
      ),
    )
  )
    throw new Error("Invalid vector mask clipboard.");
  let count = 0;
  for (const path of mask.paths) {
    if (
      !path ||
      typeof path.open !== "boolean" ||
      !["even-odd", "non-zero"].includes(path.fillRule) ||
      (path.operation !== undefined &&
        !["exclude", "combine", "subtract", "intersect"].includes(
          path.operation,
        )) ||
      !Array.isArray(path.knots) ||
      path.knots.length > 65535
    )
      throw new Error("Invalid vector path.");
    count += path.knots.length;
    // Bound total work as well as each PSD uint16 subpath knot count. This is a
    // processing budget, not a geometric/clipping limit on the document.
    if (count > 100000) throw new Error("Vector mask exceeds the knot budget.");
    for (const knot of path.knots)
      if (
        !knot ||
        typeof knot.linked !== "boolean" ||
        !Array.isArray(knot.points) ||
        knot.points.length !== 6 ||
        !knot.points.every((n) => typeof n === "number" && Number.isFinite(n))
      )
        throw new Error("Invalid cubic vector knot.");
  }
}

export function validateVectorViewport(viewport: Rect, matrix: VectorMatrix) {
  if (
    !viewport ||
    !Number.isFinite(viewport.x) ||
    !Number.isFinite(viewport.y) ||
    !Array.isArray(matrix) ||
    matrix.length !== 6 ||
    !matrix.every(Number.isFinite)
  )
    throw new Error("Invalid vector viewport or transform.");
  assertSize(viewport.width, viewport.height);
}

// An absent operation is a continuation contour of the preceding component,
// rather than a separately unioned shape. This preserves holes even when their
// winding agrees. Older records with no operation start one combine component.
export function vectorComponents(mask: VectorMask) {
  const components: {
    operation: NonNullable<VectorMask["paths"][number]["operation"]>;
    paths: VectorMask["paths"];
  }[] = [];
  for (const path of mask.paths) {
    if (path.operation === undefined && components.length)
      components[components.length - 1].paths.push(path);
    else
      components.push({
        operation: path.operation ?? "combine",
        paths: [path],
      });
  }
  return components;
}
