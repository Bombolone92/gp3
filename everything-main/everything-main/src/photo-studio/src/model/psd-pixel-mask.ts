import {
  getLayerMaskImageData,
  type Layer as PsdLayer,
  type PixelData,
} from "ag-psd";
import type { Assets } from "./assets";
import { assertSize, type Layer, type Rect } from "./document";
import {
  coverageMimeType,
  decodeCoverage,
  type CoverageSamples,
} from "./coverage";
import {
  identityMaskMatrix,
  inverseMaskMatrix,
  maskStrokeMatrix,
  pixelMaskMatrix,
  sampleCoverage,
} from "./pixel-mask";
import { maskBounds, type PsdPixelMask } from "./psd-mask-codec";
import { drawWorldMask } from "./masks";

export function supportedPsdPixelMask(item: PsdLayer) {
  const m = item.mask;
  return (
    !item.realMask &&
    (!m ||
      (!m.fromVectorData &&
        !m.userMaskFeather &&
        !m.vectorMaskFeather &&
        (m.vectorMaskDensity === undefined || m.vectorMaskDensity === 1)))
  );
}

export async function importPsdPixelMask(
  item: PsdLayer,
  l: Layer,
  assets: Assets,
  reserve: (width: number, height: number) => void,
) {
  if (!item.mask) return;
  if (!supportedPsdPixelMask(item))
    throw new Error("Unsupported PSD pixel mask parameters.");
  const m = item.mask as PsdPixelMask,
    b = maskBounds(m);
  const bounds = {
    x: b.left,
    y: b.top,
    width: b.right - b.left,
    height: b.bottom - b.top,
  };
  let asset: string | undefined;
  if (bounds.width && bounds.height) {
    // Budget the decoder's RGBA plane and immutable scalar asset copies.
    reserve(bounds.width, bounds.height);
    reserve(bounds.width, bounds.height);
    const pixels = item.mask.imageData ?? getLayerMaskImageData(item);
    if (
      !pixels ||
      pixels.width !== bounds.width ||
      pixels.height !== bounds.height
    )
      throw new Error("PSD mask samples do not match its bounds.");
    const data =
      pixels.data instanceof Float32Array
        ? new Float32Array(bounds.width * bounds.height)
        : pixels.data instanceof Uint16Array
          ? new Uint16Array(bounds.width * bounds.height)
          : new Uint8Array(bounds.width * bounds.height);
    for (let i = 0; i < data.length; i++) data[i] = pixels.data[i * 4];
    asset = await assets.addCoverage({
      width: bounds.width,
      height: bounds.height,
      data,
    });
  }
  l.pixelMask = {
    ...(asset ? { asset } : {}),
    bounds,
    reference: { ...l.transform },
    matrix: identityMaskMatrix(),
    defaultColor: (m.defaultColor ?? 0) as 0 | 255,
    positionRelativeToLayer: !!m.positionRelativeToLayer,
    fromVectorData: !!m.fromVectorData,
    flags: m.flags,
    userMaskDensity: m.userMaskDensity,
    userMaskFeather: m.userMaskFeather,
    vectorMaskDensity: m.vectorMaskDensity,
    vectorMaskFeather: m.vectorMaskFeather,
  };
  l.maskDisabled = !!m.disabled;
  l.maskInverted = !!m.inverted;
}

// Resampling a transformed pixel plane is required by PSD's axis-aligned mask
// storage. Preserve the original plane byte-for-byte for integral translations.
// Brush geometry uses Canvas; native mask samples never go through its alpha.
export async function exportPsdPixelMask(
  l: Layer,
  depth: 8 | 16 | 32,
  readAsset: ((id: string) => Blob | Promise<Blob>) | undefined,
  reserve: (width: number, height: number) => void,
): Promise<PsdPixelMask | undefined> {
  if (!l.pixelMask) return;
  const m = l.pixelMask,
    matrix = pixelMaskMatrix(l);
  let samples: CoverageSamples | undefined;
  if (m.asset) {
    if (!readAsset)
      throw new Error("PSD export requires the pixel mask coverage asset.");
    const blob = await readAsset(m.asset);
    if (blob.type !== coverageMimeType)
      throw new Error("Invalid pixel mask asset type.");
    // Validate native dimensions before allocating a copy.
    if (blob.size > 16 + m.bounds.width * m.bounds.height * 4)
      throw new Error("Invalid pixel mask asset length.");
    reserve(m.bounds.width, m.bounds.height);
    samples = decodeCoverage(await blob.arrayBuffer());
    if (samples.width !== m.bounds.width || samples.height !== m.bounds.height)
      throw new Error("Pixel mask dimensions do not match its coverage asset.");
  }
  let bounds: Rect = { ...m.bounds };
  const direct =
    !l.maskStrokes?.length &&
    matrix[0] === 1 &&
    matrix[1] === 0 &&
    matrix[2] === 0 &&
    matrix[3] === 1 &&
    Number.isInteger(matrix[4]) &&
    Number.isInteger(matrix[5]);
  let plane: CoverageSamples | undefined = samples;
  if (direct) {
    bounds.x += matrix[4];
    bounds.y += matrix[5];
  } else if (samples || l.maskStrokes?.length) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const box = (b: Rect, a: typeof matrix) => {
      for (const x of [b.x, b.x + b.width])
        for (const y of [b.y, b.y + b.height]) {
          const xx = a[0] * x + a[2] * y + a[4],
            yy = a[1] * x + a[3] * y + a[5];
          minX = Math.min(minX, xx);
          minY = Math.min(minY, yy);
          maxX = Math.max(maxX, xx);
          maxY = Math.max(maxY, yy);
        }
    };
    if (samples)
      box(
        {
          x: m.bounds.x - 0.5,
          y: m.bounds.y - 0.5,
          width: m.bounds.width + 1,
          height: m.bounds.height + 1,
        },
        matrix,
      );
    for (const s of l.maskStrokes ?? []) {
      const radius = s.size / 2,
        aspect = s.aspect ?? 1;
      for (const [x, y] of s.points)
        box(
          {
            x: x - radius,
            y: y - radius * aspect,
            width: 2 * radius,
            height: 2 * radius * aspect,
          },
          maskStrokeMatrix(l, s),
        );
    }
    const x = Math.floor(minX),
      y = Math.floor(minY);
    bounds = {
      x,
      y,
      width: Math.ceil(maxX) - x,
      height: Math.ceil(maxY) - y,
    };
    assertSize(bounds.width, bounds.height);
    reserve(bounds.width, bounds.height);
    let black: Uint8ClampedArray | undefined,
      white: Uint8ClampedArray | undefined;
    if (l.maskStrokes?.length) {
      const canvas = new OffscreenCanvas(bounds.width, bounds.height),
        c = canvas.getContext("2d")!;
      const draw = (base: number) => {
        c.clearRect(0, 0, bounds.width, bounds.height);
        drawWorldMask(
          c,
          { ...l, maskInverted: false },
          bounds,
          undefined,
          base,
        );
        return c.getImageData(0, 0, bounds.width, bounds.height).data;
      };
      black = draw(0);
      white = draw(1);
    }
    const data = new Float32Array(bounds.width * bounds.height);
    const inv = inverseMaskMatrix(matrix);
    for (let yy = 0; yy < bounds.height; yy++)
      for (let xx = 0; xx < bounds.width; xx++) {
        const i = yy * bounds.width + xx;
        const wx = bounds.x + xx + 0.5,
          wy = bounds.y + yy + 0.5;
        let value = sampleCoverage(
          samples,
          inv[0] * wx + inv[2] * wy + inv[4] - m.bounds.x,
          inv[1] * wx + inv[3] * wy + inv[5] - m.bounds.y,
          m.defaultColor / 255,
        );
        if (black && white)
          value =
            (value * (white[i * 4 + 3] - black[i * 4 + 3])) / 255 +
            black[i * 4 + 3] / 255;
        data[i] = value;
      }
    plane = { width: bounds.width, height: bounds.height, data };
  }
  if (
    ![
      bounds.x,
      bounds.y,
      bounds.x + bounds.width,
      bounds.y + bounds.height,
    ].every((n) => Number.isInteger(n) && n >= -0x80000000 && n <= 0x7fffffff)
  )
    throw new Error("Mask bounds exceed PSD signed 32-bit coordinates.");
  let imageData: PixelData | undefined;
  if (plane) {
    reserve(plane.width, plane.height);
    const data =
      depth === 32
        ? new Float32Array(plane.data.length * 4)
        : depth === 16
          ? new Uint16Array(plane.data.length * 4)
          : new Uint8ClampedArray(plane.data.length * 4);
    const sourceMax =
      plane.data instanceof Float32Array
        ? 1
        : plane.data instanceof Uint16Array
          ? 65535
          : 255;
    const max = depth === 32 ? 1 : depth === 16 ? 65535 : 255;
    for (let i = 0; i < plane.data.length; i++) {
      const v = plane.data[i] / sourceMax;
      data[i * 4] =
        data[i * 4 + 1] =
        data[i * 4 + 2] =
          depth === 32 ? v : Math.round(v * max);
      data[i * 4 + 3] = max;
    }
    imageData = { width: plane.width, height: plane.height, data };
  }
  return {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
    defaultColor: m.defaultColor,
    positionRelativeToLayer: m.positionRelativeToLayer,
    fromVectorData: m.fromVectorData,
    disabled: !!l.maskDisabled,
    inverted: !!l.maskInverted,
    flags: m.flags,
    userMaskDensity: m.userMaskDensity,
    userMaskFeather: m.userMaskFeather,
    vectorMaskDensity: m.vectorMaskDensity,
    vectorMaskFeather: m.vectorMaskFeather,
    imageData,
  };
}
