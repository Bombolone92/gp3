import type { Layer as PsdLayer, UnitsValue } from "ag-psd";
import type { VectorColor, VectorMask } from "./vector";

// Native values retain their physical units and the descriptor's resolution.
// Width is evaluated in document pixels after transforming the editable path.
export type VectorStroke = {
  enabled: boolean;
  fillEnabled: boolean;
  lineWidth: UnitsValue;
  lineDashOffset: UnitsValue;
  lineDashSet?: UnitsValue[];
  resolution: number;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  alignment: "inside" | "center" | "outside";
  miterLimit: number;
  opacity: number;
  color: VectorColor;
};

const units = {
  Pixels: 1,
  Points: 1 / 72,
  Picas: 1 / 6,
  Millimeters: 1 / 25.4,
  Centimeters: 1 / 2.54,
  Inches: 1,
};
export function strokePixels(stroke: VectorStroke) {
  return strokeMeasurePixels(stroke.lineWidth, stroke.resolution);
}
export function strokeMeasurePixels(measure: UnitsValue, resolution: number) {
  return (
    measure.value *
    (measure.units === "None"
      ? 1
      : units[measure.units as keyof typeof units]) *
    (measure.units === "Pixels" || measure.units === "None" ? 1 : resolution)
  );
}
// PixelProbe resolves dimensionless dash intervals as multiples of the stroke
// width, while the offset is an ordinary descriptor unit (None means pixels).
export function strokeDashPixels(stroke: VectorStroke) {
  return (stroke.lineDashSet ?? []).map((v) =>
    v.units === "None"
      ? v.value * strokePixels(stroke)
      : strokeMeasurePixels(v, stroke.resolution),
  );
}
export function strokeDashRuns(stroke: VectorStroke) {
  const values = strokeDashPixels(stroke);
  if (!values.length) return [];
  // An odd sequence alternates paint/gap roles on its second repetition.
  if (values.length % 2) values.push(...values);
  const period = values.reduce((sum, v) => sum + v, 0);
  const gap = values.findIndex((v, i) => i % 2 === 1 && v > 0);
  if (gap < 0) return []; // All gaps are zero: one continuous stroke.
  const phase = strokeMeasurePixels(stroke.lineDashOffset, stroke.resolution);
  const runs: { on: number; off: number; phase: number }[] = [];
  let start = values.slice(0, gap + 1).reduce((sum, v) => sum + v, 0);
  let on = 0;
  // Start just after a positive gap, merging adjacent painted intervals when
  // their separating gap is zero, including across the period's seam.
  for (let k = 1; k <= values.length; k++) {
    const i = (gap + k) % values.length;
    if (i % 2 === 0) on += values[i];
    else if (values[i] > 0) {
      const offset = (((phase - start) % period) + period) % period;
      runs.push({ on, off: period - on, phase: offset });
      start += on + values[i];
      on = 0;
    }
  }
  return runs;
}
export function parseStrokeDashInput(value: string): UnitsValue[] | undefined {
  if (!value.trim()) return [];
  const numbers = value
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (
    numbers.length > 256 ||
    numbers.some(
      (v, i) =>
        !Number.isFinite(v) ||
        v < 0 ||
        (v === 0 && (i % 2 === 0 || numbers.length % 2 === 1)),
    )
  )
    return;
  return numbers.map((value) => ({ value, units: "Pixels" }));
}
export function validVectorColor(color: VectorColor) {
  return (
    !!color &&
    ["document", "srgb"].includes(color.space) &&
    Array.isArray(color.rgb) &&
    color.rgb.length === 3 &&
    color.rgb.every(Number.isFinite)
  );
}
export function validateVectorStroke(stroke: VectorStroke) {
  const measure = (v: UnitsValue) =>
    !!v && Number.isFinite(v.value) && Object.hasOwn(units, v.units);
  if (
    !stroke ||
    typeof stroke.enabled !== "boolean" ||
    typeof stroke.fillEnabled !== "boolean" ||
    !measure(stroke.lineWidth) ||
    stroke.lineWidth.value < 0 ||
    !(
      measure(stroke.lineDashOffset) ||
      (stroke.lineDashOffset?.units === "None" &&
        Number.isFinite(stroke.lineDashOffset.value))
    ) ||
    (stroke.lineDashSet !== undefined &&
      (!Array.isArray(stroke.lineDashSet) ||
        stroke.lineDashSet.length > 256 ||
        stroke.lineDashSet.some(
          (v) =>
            !(
              measure(v) ||
              (v?.units === "None" && Number.isFinite(v.value))
            ) || v.value < 0,
        ) ||
        // Zero-length painted dashes need explicit point/tangent geometry;
        // PathKit's dash binding discards them. Keep that gap explicit.
        stroke.lineDashSet.some(
          (v, i, list) =>
            v.value === 0 && (i % 2 === 0 || list.length % 2 === 1),
        ))) ||
    !Number.isFinite(stroke.resolution) ||
    stroke.resolution <= 0 ||
    !Number.isFinite(strokePixels(stroke)) ||
    !Number.isFinite(
      strokeMeasurePixels(stroke.lineDashOffset, stroke.resolution),
    ) ||
    !strokeDashPixels(stroke).every(Number.isFinite) ||
    !Number.isFinite(
      strokeDashPixels(stroke).reduce((sum, v) => sum + v, 0) * 2,
    ) ||
    !["butt", "round", "square"].includes(stroke.cap) ||
    !["miter", "round", "bevel"].includes(stroke.join) ||
    !["inside", "center", "outside"].includes(stroke.alignment) ||
    !Number.isFinite(stroke.miterLimit) ||
    stroke.miterLimit < 1 ||
    !Number.isFinite(stroke.opacity) ||
    stroke.opacity < 0 ||
    stroke.opacity > 1 ||
    !validVectorColor(stroke.color)
  )
    throw new Error("Invalid vector stroke.");
}
export function solidRgb(
  content: PsdLayer["vectorFill"],
): [number, number, number] | undefined {
  if (content?.type !== "color") return;
  const c = content.color;
  if ("r" in c) return [c.r / 255, c.g / 255, c.b / 255];
  if ("fr" in c) return [c.fr, c.fg, c.fb];
}
// Non-normal paint blending, snapping and non-solid paints need their
// own semantics. Keep the existing explicit unsupported-feature path for them.
export function importVectorStroke(layer: PsdLayer): VectorStroke | undefined {
  const s = layer.vectorStroke;
  if (
    !s ||
    layer.usingAlignedRendering ||
    s.lineDashSet?.some(
      (v, i, list) => v.value === 0 && (i % 2 === 0 || list.length % 2 === 1),
    ) ||
    s.scaleLock ||
    s.strokeAdjust ||
    (s.blendMode && s.blendMode !== "normal")
  )
    return;
  const rgb = solidRgb(
    s.content ?? { type: "color", color: { r: 0, g: 0, b: 0 } },
  );
  if (!rgb) return;
  const stroke: VectorStroke = {
    enabled: s.strokeEnabled ?? false,
    fillEnabled: s.fillEnabled ?? false,
    lineWidth: structuredClone(s.lineWidth ?? { value: 3, units: "Points" }),
    lineDashOffset: structuredClone(
      s.lineDashOffset ?? { value: 0, units: "Points" },
    ),
    ...(s.lineDashSet?.length
      ? { lineDashSet: structuredClone(s.lineDashSet) }
      : {}),
    resolution: s.resolution ?? 72,
    cap: s.lineCapType ?? "butt",
    join: s.lineJoinType ?? "miter",
    alignment: s.lineAlignment ?? "inside",
    miterLimit: s.miterLimit ?? 100,
    opacity: s.opacity ?? 1,
    color: { rgb, space: "document" },
  };
  validateVectorStroke(stroke);
  return supportedStrokePaths(layer.vectorMask, stroke) ? stroke : undefined;
}
export function supportedStrokePaths(
  mask: VectorMask | undefined,
  stroke: Pick<VectorStroke, "enabled" | "alignment" | "lineDashSet">,
) {
  // Dashes have an origin and direction. A boolean-resolved compound boundary
  // can reorder them; how other readers anchor its dashes still needs verification.
  if (
    stroke.enabled &&
    stroke.lineDashSet?.length &&
    mask &&
    (mask.paths.length > 1 ||
      (mask.paths[0]?.operation && mask.paths[0].operation !== "combine"))
  )
    return false;
  // Open paths retain their real end caps; filling closes them implicitly.
  // Boolean operations on mixed open/closed stroke paths remain unverified.
  return (
    !stroke.enabled ||
    !mask?.paths.some((p) => p.open) ||
    (stroke.alignment === "center" &&
      mask.paths.length === 1 &&
      (!mask.paths[0].operation || mask.paths[0].operation === "combine") &&
      !mask.invert &&
      !mask.fillStartsWithAllPixels &&
      !mask.disable)
  );
}
export function exportVectorStroke(
  stroke: VectorStroke,
  rgb: number[],
): PsdLayer["vectorStroke"] {
  return {
    strokeEnabled: stroke.enabled,
    fillEnabled: stroke.fillEnabled,
    lineWidth: { ...stroke.lineWidth },
    lineDashOffset: { ...stroke.lineDashOffset },
    resolution: stroke.resolution,
    lineCapType: stroke.cap,
    lineJoinType: stroke.join,
    lineAlignment: stroke.alignment,
    miterLimit: stroke.miterLimit,
    opacity: stroke.opacity,
    blendMode: "normal",
    scaleLock: false,
    strokeAdjust: false,
    lineDashSet: structuredClone(stroke.lineDashSet ?? []),
    content: {
      type: "color",
      color: { r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255 },
    },
  };
}
