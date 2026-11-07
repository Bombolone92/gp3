import {
  assertSize,
  type Layer,
  type MaskStroke,
  type Rect,
  type Transform,
} from "./document";
import type { VectorMatrix } from "./vector";
import type { CoverageSamples } from "./coverage";

export type PixelMask = {
  asset?: string;
  bounds: Rect;
  // The plane's original document coordinates and the layer's import transform.
  reference: Transform;
  matrix: VectorMatrix;
  defaultColor: 0 | 255;
  // PSD bit 0 is an unlink flag. Stored rectangles remain absolute in either
  // state; see the correction to GIMP bugs 592533/593251:
  // https://mail.gnome.org/archives/commits-list/2017-September/msg02005.html
  positionRelativeToLayer: boolean;
  fromVectorData: boolean;
  flags?: number;
  userMaskDensity?: number;
  userMaskFeather?: number;
  vectorMaskDensity?: number;
  vectorMaskFeather?: number;
};
export const identityMaskMatrix = (): VectorMatrix => [1, 0, 0, 1, 0, 0];
export function multiplyMaskMatrix(
  a: VectorMatrix,
  b: VectorMatrix,
): VectorMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverseMaskMatrix(m: VectorMatrix): VectorMatrix {
  const d = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(d) || d === 0)
    throw new Error("Invalid mask transform.");
  const result: VectorMatrix = [
    m[3] / d,
    -m[1] / d,
    -m[2] / d,
    m[0] / d,
    (m[2] * m[5] - m[3] * m[4]) / d,
    (m[1] * m[4] - m[0] * m[5]) / d,
  ];
  if (!result.every(Number.isFinite))
    throw new Error("Invalid mask transform.");
  return result;
}
export function pixelMaskMatrix(l: Layer): VectorMatrix {
  const mask = l.pixelMask!;
  if (l.kind === "group" || mask.positionRelativeToLayer) return mask.matrix;
  const r = mask.reference,
    t = l.transform;
  // Reference transforms are captured before any native editing and may rotate.
  return multiplyMaskMatrix(
    multiplyMaskMatrix(
      transformMatrix(t),
      inverseMaskMatrix(transformMatrix(r)),
    ),
    mask.matrix,
  );
}
export function transformMatrix(v: Transform): VectorMatrix {
  const angle = (v.rotation * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return [
    c * v.width,
    s * v.width,
    -s * v.height,
    c * v.height,
    v.x + v.width / 2 - (c * v.width - s * v.height) / 2,
    v.y + v.height / 2 - (s * v.width + c * v.height) / 2,
  ];
}
export function sourceMatrix(
  t: Transform,
  width: number,
  height: number,
): VectorMatrix {
  return multiplyMaskMatrix(transformMatrix(t), [
    1 / width,
    0,
    0,
    1 / height,
    0,
    0,
  ]);
}
export function maskStrokeMatrix(l: Layer, s: MaskStroke): VectorMatrix {
  return multiplyMaskMatrix(
    pixelMaskMatrix(l),
    s.matrix ??
      sourceMatrix(l.pixelMask!.reference, l.sourceWidth, l.sourceHeight),
  );
}
export function setPixelMaskLinked(l: Layer, linked: boolean) {
  const mask = l.pixelMask!;
  const world = pixelMaskMatrix(l);
  mask.positionRelativeToLayer = !linked;
  mask.matrix =
    l.kind === "group" || !linked
      ? world
      : multiplyMaskMatrix(
          multiplyMaskMatrix(
            transformMatrix(mask.reference),
            inverseMaskMatrix(transformMatrix(l.transform)),
          ),
          world,
        );
}
export function validatePixelMask(mask: PixelMask) {
  if (
    !mask ||
    !mask.bounds ||
    !mask.reference ||
    !["x", "y", "width", "height"].every((k) =>
      Number.isInteger(mask.bounds[k as keyof Rect]),
    ) ||
    mask.bounds.width < 0 ||
    mask.bounds.height < 0 ||
    ![
      mask.bounds.x,
      mask.bounds.y,
      mask.bounds.x + mask.bounds.width,
      mask.bounds.y + mask.bounds.height,
    ].every((n) => n >= -0x80000000 && n <= 0x7fffffff) ||
    !["x", "y", "width", "height", "rotation"].every((k) =>
      Number.isFinite(mask.reference[k as keyof Transform]),
    ) ||
    mask.reference.width <= 0 ||
    mask.reference.height <= 0 ||
    !Array.isArray(mask.matrix) ||
    mask.matrix.length !== 6 ||
    !mask.matrix.every(Number.isFinite) ||
    ![0, 255].includes(mask.defaultColor) ||
    typeof mask.positionRelativeToLayer !== "boolean" ||
    typeof mask.fromVectorData !== "boolean" ||
    (mask.flags !== undefined &&
      (!Number.isInteger(mask.flags) || mask.flags < 0 || mask.flags > 255)) ||
    (mask.asset !== undefined &&
      (typeof mask.asset !== "string" || !mask.asset.length))
  )
    throw new Error("Invalid pixel mask.");
  inverseMaskMatrix(mask.matrix);
  for (const value of [mask.userMaskDensity, mask.vectorMaskDensity])
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > 1)
    )
      throw new Error("Invalid pixel mask density.");
  for (const value of [mask.userMaskFeather, mask.vectorMaskFeather])
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error("Invalid pixel mask feather.");
  if (mask.bounds.width && mask.bounds.height) {
    assertSize(mask.bounds.width, mask.bounds.height);
    if (!mask.asset) throw new Error("Pixel mask samples are missing.");
  } else if (mask.asset)
    throw new Error("An empty pixel mask cannot have samples.");
}
// Scalar oracle and interchange sampling. Pixel centers are at half integers;
// every out-of-bounds tap uses the mask's default, including the edge footprint.
export function sampleCoverage(
  samples: CoverageSamples | undefined,
  x: number,
  y: number,
  background: number,
): number {
  if (!samples) return background;
  const max =
    samples.data instanceof Float32Array
      ? 1
      : samples.data instanceof Uint16Array
        ? 65535
        : 255;
  const bx = Math.floor(x - 0.5),
    by = Math.floor(y - 0.5),
    fx = x - 0.5 - bx,
    fy = y - 0.5 - by;
  const tap = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < samples.width && y < samples.height
      ? samples.data[y * samples.width + x] / max
      : background;
  const a = tap(bx, by);
  if (fx === 0 && fy === 0) return a;
  return (
    (a * (1 - fx) + tap(bx + 1, by) * fx) * (1 - fy) +
    (tap(bx, by + 1) * (1 - fx) + tap(bx + 1, by + 1) * fx) * fy
  );
}
export function rawPixelMaskCoverage(
  l: Layer,
  samples: CoverageSamples | undefined,
  x: number,
  y: number,
): number {
  if (!l.pixelMask) return 1;
  const m = inverseMaskMatrix(pixelMaskMatrix(l)),
    mask = l.pixelMask;
  return sampleCoverage(
    samples,
    m[0] * x + m[2] * y + m[4] - mask.bounds.x,
    m[1] * x + m[3] * y + m[5] - mask.bounds.y,
    mask.defaultColor / 255,
  );
}
export function applyPixelMask(l: Layer, value: number) {
  if (!l.pixelMask || l.maskDisabled) return 1;
  if (l.maskInverted) value = 1 - value;
  const mask = l.pixelMask;
  const density = mask.userMaskDensity ?? 1;
  return density === 1 ? value : 1 - density + density * value;
}
export function pixelMaskCoverage(
  l: Layer,
  samples: CoverageSamples | undefined,
  x: number,
  y: number,
) {
  return applyPixelMask(l, rawPixelMaskCoverage(l, samples, x, y));
}
