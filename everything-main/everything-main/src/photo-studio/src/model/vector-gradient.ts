import type { Rect } from "./document";
import type { VectorMatrix } from "./vector";
import type { PsdSolidGradientFill } from "./psd-gradient-fill";
import type { PsdLayerBounds } from "./psd-layer-bounds";
import { inverseMaskMatrix, multiplyMaskMatrix } from "./pixel-mask";

export type VectorGradient = PsdSolidGradientFill & {
  // Original paint frame, independent of the clipped raster viewport. Linked
  // paint follows the layer affine; unlinked paint remains in document space.
  frame: Rect;
  // Canvas resize/crop transforms unlinked paint independently of its layer.
  matrix?: VectorMatrix;
};
export type RgbaSample = (
  x: number,
  y: number,
  out?: [number, number, number, number],
) => [number, number, number, number];
export function isVectorGradient(value: unknown): value is VectorGradient {
  return (
    !!value &&
    typeof value === "object" &&
    (value as VectorGradient).type === "solid"
  );
}
export function gradientFrame(
  canvas: Rect,
  aligned: boolean,
  stored?: PsdLayerBounds,
  path?: Rect | null,
): Rect {
  if (!aligned) return { ...canvas };
  if (stored && stored.right > stored.left && stored.bottom > stored.top)
    return {
      x: stored.left,
      y: stored.top,
      width: stored.right - stored.left,
      height: stored.bottom - stored.top,
    };
  return path && path.width > 0 && path.height > 0
    ? {
        x: Math.floor(path.x),
        y: Math.floor(path.y),
        width: Math.ceil(path.x + path.width) - Math.floor(path.x),
        height: Math.ceil(path.y + path.height) - Math.floor(path.y),
      }
    : { ...canvas };
}
const styles = ["linear", "radial", "angle", "reflected", "diamond"];
function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function unit(n: unknown): n is number {
  return finite(n) && n >= 0 && n <= 1;
}
function rgb(value: unknown): value is { r: number; g: number; b: number } {
  return (
    !!value &&
    typeof value === "object" &&
    Object.keys(value).length === 3 &&
    ["r", "g", "b"].every((k) => finite((value as Record<string, unknown>)[k]))
  );
}
// Classic GdFl's cubic and destination-stop midpoint law are documented in
// published interoperability notes. Dither and other interpolation methods must not
// be silently rendered as this material.
// https://github.com/SethRobinson/Patchy/blob/4816d450e6a94e954017629745c06044186b3dec/docs/vector-tools.md
export function supportedGradientDefinition(fill: PsdSolidGradientFill) {
  return (
    !!fill &&
    fill.type === "solid" &&
    !("smoothness" in fill || "scale" in fill || "offset" in fill) &&
    typeof fill.name === "string" &&
    styles.includes(fill.style ?? "linear") &&
    (fill.interpolationMethod === undefined ||
      fill.interpolationMethod === "classic") &&
    (fill.dither === undefined || fill.dither === false) &&
    [fill.align, fill.reverse].every(
      (v) => v === undefined || typeof v === "boolean",
    ) &&
    (fill.angle === undefined || finite(fill.angle)) &&
    (fill.interpolationSamples === undefined ||
      (finite(fill.interpolationSamples) &&
        fill.interpolationSamples >= 0 &&
        fill.interpolationSamples <= 4096)) &&
    (fill.scalePercent === undefined ||
      (finite(fill.scalePercent) && fill.scalePercent > 0)) &&
    (fill.offsetPercent === undefined ||
      (fill.offsetPercent &&
        finite(fill.offsetPercent.x) &&
        finite(fill.offsetPercent.y))) &&
    Array.isArray(fill.colorStops) &&
    fill.colorStops.length > 0 &&
    fill.colorStops.length <= 256 &&
    fill.colorStops.every(
      (s) =>
        s &&
        unit(s.location) &&
        (s.midpoint === undefined || unit(s.midpoint)) &&
        rgb(s.color) &&
        (s.colorType === undefined || s.colorType === "Clry.UsrS"),
    ) &&
    Array.isArray(fill.opacityStops) &&
    fill.opacityStops.length <= 256 &&
    fill.opacityStops.every(
      (s) =>
        s &&
        unit(s.location) &&
        (s.midpoint === undefined || unit(s.midpoint)) &&
        finite(s.opacityPercent) &&
        s.opacityPercent >= 0 &&
        s.opacityPercent <= 100,
    )
  );
}
export function validateGradientFrame(frame: Rect) {
  if (
    !frame ||
    !["x", "y", "width", "height"].every((k) =>
      finite(frame[k as keyof Rect]),
    ) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    !finite(frame.x + frame.width) ||
    !finite(frame.y + frame.height)
  )
    throw new Error("Invalid gradient paint frame.");
}
export function validateVectorGradient(fill: VectorGradient) {
  if (!supportedGradientDefinition(fill))
    throw new Error("Invalid or unsupported vector gradient fill.");
  validateGradientFrame(fill.frame);
  if (fill.matrix !== undefined) {
    if (
      !Array.isArray(fill.matrix) ||
      fill.matrix.length !== 6 ||
      !fill.matrix.every(finite)
    )
      throw new Error("Invalid gradient paint transform.");
    inverseMaskMatrix(fill.matrix);
  }
}
function paintMatrix(
  fill: VectorGradient,
  layerMatrix: VectorMatrix,
): VectorMatrix {
  const linked: VectorMatrix =
    fill.align === false ? [1, 0, 0, 1, 0, 0] : layerMatrix;
  return fill.matrix ? multiplyMaskMatrix(linked, fill.matrix) : linked;
}

// Exact limiting cases at 0 and 1 avoid invented epsilon spans or midpoint
// clamps. At a coincident stop the last stop at that position owns the right
// side of the hard edge; definitions retain their original order in storage.
export function gradientMidpoint(t: number, midpoint: number) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t <= midpoint
    ? t / (2 * midpoint)
    : 0.5 + (t - midpoint) / (2 * (1 - midpoint));
}
type RampStop = { location: number; midpoint?: number; values: number[] };
function ramp(input: RampStop[], smoothness: number, fallback: number[]) {
  const stops = [...input].sort((a, b) => a.location - b.location);
  const segments = stops.slice(1).map((b, i) => {
    const a = stops[i],
      previous = stops[Math.max(0, i - 1)],
      next = stops[Math.min(stops.length - 1, i + 2)];
    return {
      midpoint: b.midpoint ?? 0.5,
      coefficients: a.values.map((v, c) => {
        const p0 = previous.values[c],
          p1 = v,
          p2 = b.values[c],
          p3 = next.values[c];
        return [
          p1,
          (p2 - p1) * (1 - smoothness) + ((p2 - p0) * smoothness) / 2,
          ((2 * p0 - 5 * p1 + 4 * p2 - p3) * smoothness) / 2,
          ((-p0 + 3 * p1 - 3 * p2 + p3) * smoothness) / 2,
        ];
      }),
    };
  });
  return (
    position: number,
    out: [number, number, number, number],
    offset: number,
  ) => {
    let low = 0,
      high = stops.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (stops[mid].location <= position) low = mid + 1;
      else high = mid;
    }
    if (!stops.length || low === 0 || low === stops.length) {
      const values = !stops.length
        ? fallback
        : stops[low === 0 ? 0 : stops.length - 1].values;
      for (let c = 0; c < values.length; c++) out[offset + c] = values[c];
      return;
    }
    const left = stops[low - 1],
      right = stops[low],
      segment = segments[low - 1],
      t = gradientMidpoint(
        (position - left.location) / (right.location - left.location),
        segment.midpoint,
      );
    for (let c = 0; c < segment.coefficients.length; c++) {
      const p = segment.coefficients[c];
      out[offset + c] = ((p[3] * t + p[2]) * t + p[1]) * t + p[0];
    }
  };
}
export function gradientRamp(
  fill: PsdSolidGradientFill,
): (
  position: number,
  out?: [number, number, number, number],
) => [number, number, number, number] {
  if (!supportedGradientDefinition(fill))
    throw new Error("Unsupported gradient definition.");
  const smoothness = (fill.interpolationSamples ?? 4096) / 4096,
    colors = ramp(
      fill.colorStops.map((s) => ({
        location: s.location,
        midpoint: s.midpoint,
        values: [
          (s.color as { r: number }).r / 255,
          (s.color as { g: number }).g / 255,
          (s.color as { b: number }).b / 255,
        ],
      })),
      smoothness,
      [0, 0, 0],
    ),
    alpha = ramp(
      fill.opacityStops.map((s) => ({
        location: s.location,
        midpoint: s.midpoint,
        values: [s.opacityPercent / 100],
      })),
      smoothness,
      [1],
    );
  return (position, out = [0, 0, 0, 0]) => {
    colors(position, out, 0);
    alpha(position, out, 3);
    out[3] = Math.max(0, Math.min(1, out[3]));
    return out;
  };
}
function axes(angle: number) {
  const normalized = ((angle % 360) + 360) % 360;
  // Exact cardinal axes prevent tiny cosine residuals from changing hard edges.
  if (normalized % 90 === 0)
    return [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ][normalized / 90];
  const a = (normalized * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}
export function gradientSpan(frame: Rect, angle: number) {
  const [c, s] = axes(angle);
  return Math.min(
    c === 0 ? Infinity : frame.width / Math.abs(c),
    s === 0 ? Infinity : frame.height / Math.abs(s),
  );
}
function gradientPositionField(fill: PsdSolidGradientFill, frame: Rect) {
  const [c, s] = axes(fill.angle ?? 0),
    cx =
      frame.x +
      frame.width / 2 +
      frame.width * ((fill.offsetPercent?.x ?? 0) / 100),
    cy =
      frame.y +
      frame.height / 2 +
      frame.height * ((fill.offsetPercent?.y ?? 0) / 100),
    half =
      gradientSpan(frame, fill.angle ?? 0) * ((fill.scalePercent ?? 100) / 200);
  return (x: number, y: number) => {
    const dx = x - cx,
      dy = y - cy,
      xx = dx * c - dy * s,
      yy = dx * s + dy * c;
    let position: number;
    switch (fill.style ?? "linear") {
      case "linear":
        position = 0.5 + xx / (2 * half);
        break;
      case "radial":
        position = Math.hypot(xx, yy) / half;
        break;
      case "reflected":
        position = Math.abs(xx) / half;
        break;
      case "diamond":
        position = (Math.abs(xx) + Math.abs(yy)) / half;
        break;
      case "angle":
        position =
          xx === 0 && yy === 0
            ? 0.25
            : (((Math.atan2(yy, xx) / (2 * Math.PI)) % 1) + 1) % 1;
        break;
      default:
        throw new Error("Unsupported gradient geometry.");
    }
    // A subnormal positive scale can underflow the radius to zero. Its limit at
    // the center is the natural anchor, not NaN; outside, clamp the infinite ray.
    if (Number.isNaN(position) && half === 0 && xx === 0 && yy === 0)
      position = (fill.style ?? "linear") === "linear" ? 0.5 : 0;
    if (
      !Number.isFinite(position) &&
      position !== Infinity &&
      position !== -Infinity
    )
      throw new Error("Gradient position exceeds finite coordinates.");
    position = Math.max(0, Math.min(1, position));
    return fill.reverse ? 1 - position : position;
  };
}

export function gradientPosition(
  fill: PsdSolidGradientFill,
  frame: Rect,
  x: number,
  y: number,
) {
  return gradientPositionField(fill, frame)(x, y);
}
export function gradientSampler(
  fill: VectorGradient,
  matrix: VectorMatrix,
): RgbaSample {
  validateVectorGradient(fill);
  const inverse = inverseMaskMatrix(paintMatrix(fill, matrix)),
    color = gradientRamp(fill),
    position = gradientPositionField(fill, fill.frame);
  return (x, y, out = [0, 0, 0, 0]) => {
    // Document pixel indices become centers once, independently of viewport.
    const xx = x + 0.5,
      yy = y + 0.5;
    return color(
      position(
        inverse[0] * xx + inverse[2] * yy + inverse[4],
        inverse[1] * xx + inverse[3] * yy + inverse[5],
      ),
      out,
    );
  };
}

// PSD has angle/scale/offset placement rather than an arbitrary paint affine.
// A linear/reflected scalar field remains representable under any invertible
// affine. Circular/conical/diamond fields require a similarity transform.
export function exportGradientDefinition(
  fill: VectorGradient,
  matrix: VectorMatrix,
  targetFrame: Rect,
): PsdSolidGradientFill {
  validateVectorGradient(fill);
  validateGradientFrame(targetFrame);
  const { frame, matrix: _matrix, ...definition } = fill;
  const m = paintMatrix(fill, matrix);
  if (
    m[0] === 1 &&
    m[1] === 0 &&
    m[2] === 0 &&
    m[3] === 1 &&
    frame.x + m[4] === targetFrame.x &&
    frame.y + m[5] === targetFrame.y &&
    frame.width === targetFrame.width &&
    frame.height === targetFrame.height
  )
    return definition;
  const inverse = inverseMaskMatrix(m),
    [cos, sin] = axes(fill.angle ?? 0),
    nx = inverse[0] * cos - inverse[1] * sin,
    ny = inverse[2] * cos - inverse[3] * sin,
    unchangedAxes = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1,
    norm = unchangedAxes ? 1 : Math.hypot(nx, ny),
    sx = Math.hypot(m[0], m[1]),
    sy = Math.hypot(m[2], m[3]);
  if (
    !["linear", "reflected"].includes(fill.style ?? "linear") &&
    (sx !== sy ||
      m[0] * m[2] + m[1] * m[3] !== 0 ||
      m[0] * m[3] - m[1] * m[2] <= 0)
  )
    throw new Error(
      "PSD export cannot represent this gradient’s nonuniform transform. Save a .photo project to retain the editable paint.",
    );
  const cx = frame.x + frame.width * (0.5 + (fill.offsetPercent?.x ?? 0) / 100),
    cy = frame.y + frame.height * (0.5 + (fill.offsetPercent?.y ?? 0) / 100),
    x = m[0] * cx + m[2] * cy + m[4],
    y = m[1] * cx + m[3] * cy + m[5],
    angle = unchangedAxes
      ? (fill.angle ?? 0)
      : (Math.atan2(-ny, nx) * 180) / Math.PI,
    offsetPercent = {
      x:
        ((x - targetFrame.x - targetFrame.width / 2) / targetFrame.width) * 100,
      y:
        ((y - targetFrame.y - targetFrame.height / 2) / targetFrame.height) *
        100,
    },
    scalePercent =
      (gradientSpan(frame, fill.angle ?? 0) /
        gradientSpan(targetFrame, angle) /
        norm) *
      (fill.scalePercent ?? 100);
  if (
    ![angle, offsetPercent.x, offsetPercent.y, scalePercent].every(
      Number.isFinite,
    ) ||
    !(scalePercent > 0)
  )
    throw new Error("Gradient export exceeds finite placement values.");
  return {
    ...definition,
    angle,
    offsetPercent,
    ...(fill.style === "angle" ? {} : { scalePercent }),
  };
}
