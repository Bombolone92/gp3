import type { PsdPatternFill } from "./psd-fill-codec";
import type { PatternPixels } from "./psd-patterns";
import type { VectorMatrix } from "./vector";

export type VectorPattern = PsdPatternFill & {
  asset: string;
  referencePoint?: { x: number; y: number };
};
export function isVectorPattern(value: unknown): value is VectorPattern {
  return (
    !!value &&
    typeof value === "object" &&
    (value as VectorPattern).type === "pattern"
  );
}
// Native-grid tiling is documented in independently published interoperability notes.
// Other placements need their own filtering implementation, not a substitute.
// https://github.com/SethRobinson/Patchy/blob/4816d450e6a94e954017629745c06044186b3dec/src/core/pattern_sampler.hpp
export function nativePatternPlacement(fill: PsdPatternFill) {
  return (
    (fill.scalePercent ?? 100) === 100 &&
    Number.isFinite(fill.angle ?? 0) &&
    (fill.angle ?? 0) % 360 === 0 &&
    fill.linked === undefined
  );
}
export function validateVectorPattern(fill: VectorPattern) {
  if (
    typeof fill.asset !== "string" ||
    !fill.asset ||
    typeof fill.id !== "string" ||
    !fill.id ||
    typeof fill.name !== "string" ||
    !nativePatternPlacement(fill) ||
    (fill.align !== undefined && typeof fill.align !== "boolean") ||
    (fill.phase !== undefined &&
      (!fill.phase ||
        !Number.isFinite(fill.phase.x) ||
        !Number.isFinite(fill.phase.y))) ||
    (fill.referencePoint !== undefined &&
      (!fill.referencePoint ||
        !Number.isFinite(fill.referencePoint.x) ||
        !Number.isFinite(fill.referencePoint.y)))
  )
    throw new Error("Invalid or unsupported vector pattern fill.");
}
export function patternReferencePoint(
  fill: VectorPattern,
  matrix: VectorMatrix,
) {
  const point = fill.referencePoint ?? { x: 0, y: 0 };
  // Avoid arithmetic changes to the original descriptor on an identity move.
  if (matrix.every((v, i) => v === [1, 0, 0, 1, 0, 0][i])) return { ...point };
  const result = {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y))
    throw new Error("Pattern reference point exceeds finite coordinates.");
  return result;
}
export function patternSampler(
  fill: VectorPattern,
  tile: PatternPixels,
  matrix: VectorMatrix,
) {
  validateVectorPattern(fill);
  const point =
    fill.align === false ? { x: 0, y: 0 } : patternReferencePoint(fill, matrix);
  // Reduce the two offsets separately before adding them. Huge, finite native
  // phases must not erase the document pixel's low bits or overflow the sum.
  const anchorX = (point.x % tile.width) + ((fill.phase?.x ?? 0) % tile.width),
    anchorY = (point.y % tile.height) + ((fill.phase?.y ?? 0) % tile.height);
  const maximum =
    tile.data instanceof Uint8Array
      ? 255
      : tile.data instanceof Uint16Array
        ? 65535
        : 1;
  const wrap = (n: number, extent: number) => ((n % extent) + extent) % extent;
  return (
    x: number,
    y: number,
    out: [number, number, number, number] = [0, 0, 0, 0],
  ) => {
    const i =
      (wrap(Math.floor(y + 0.5 - anchorY), tile.height) * tile.width +
        wrap(Math.floor(x + 0.5 - anchorX), tile.width)) *
      4;
    for (let c = 0; c < 4; c++) out[c] = tile.data[i + c] / maximum;
    return out;
  };
}
