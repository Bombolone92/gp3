// Clone source geometry: where a clone or healing stroke reads its pixels.
// A source is a point S in the source image; the stroke's anchor D is where
// S lands in the destination. Cloned content can be scaled, rotated and
// flipped about the source point, so a destination point d reads from
//   s = S + T⁻¹ (d − D),   T = Rotate(θ) · Flip · Scale(w, h).
import type { RGBA8 } from '../types';

export type CloneTransform = {
  // Percent; negative values are not used (flips are separate).
  scaleW: number;
  scaleH: number;
  // Degrees, counterclockwise on screen is negative (canvas y points down).
  rotation: number;
  flipH: boolean;
  flipV: boolean;
};
export const identityCloneTransform = (): CloneTransform => ({ scaleW: 100, scaleH: 100, rotation: 0, flipH: false, flipV: false });
export function isTranslation(t: CloneTransform) {
  return t.scaleW === 100 && t.scaleH === 100 && t.rotation % 360 === 0 && !t.flipH && !t.flipV;
}

// Forward matrix T as [a, b, c, d] (x' = a x + c y, y' = b x + d y).
export function cloneMatrix(t: CloneTransform): [number, number, number, number] {
  const sx = (t.scaleW / 100) * (t.flipH ? -1 : 1),
    sy = (t.scaleH / 100) * (t.flipV ? -1 : 1);
  const r = (t.rotation * Math.PI) / 180,
    cos = Math.cos(r),
    sin = Math.sin(r);
  return [cos * sx, sin * sx, -sin * sy, cos * sy];
}

/** Map destination points to source points for a source point S and anchor D. */
export function sourceMapping(source: [number, number], anchor: [number, number], t: CloneTransform): (x: number, y: number) => [number, number] {
  const [a, b, c, d] = cloneMatrix(t);
  const det = a * d - b * c || 1e-9;
  // Inverse of [[a c] [b d]].
  const ia = d / det,
    ib = -b / det,
    ic = -c / det,
    id = a / det;
  const [sx, sy] = source,
    [dx, dy] = anchor;
  return (x, y) => {
    const u = x - dx,
      v = y - dy;
    return [sx + ia * u + ic * v, sy + ib * u + id * v];
  };
}
/** Destination of a source point (the overlay's placement). */
export function destinationOf(source: [number, number], anchor: [number, number], t: CloneTransform, s: [number, number]): [number, number] {
  const [a, b, c, d] = cloneMatrix(t);
  const u = s[0] - source[0],
    v = s[1] - source[1];
  return [anchor[0] + a * u + c * v, anchor[1] + b * u + d * v];
}

export type Sampler = (x: number, y: number, out: Uint8ClampedArray) => boolean;

/** Bilinear sampler over a straight-alpha image; colors are averaged
 * premultiplied so transparent neighbours do not darken edges. Pixel (i, j)
 * covers [i, i + 1) × [j, j + 1), so integer + 0.5 hits a pixel center. */
export function bilinearSampler(img: RGBA8, ox = 0, oy = 0): Sampler {
  const { width: w, height: h, data } = img;
  return (x, y, out) => {
    const fx = x - ox - 0.5,
      fy = y - oy - 0.5;
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) {
        const xi = x0 + i,
          yi = y0 + j;
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) continue;
        const k = (i ? tx : 1 - tx) * (j ? ty : 1 - ty);
        if (!k) continue;
        const o = (yi * w + xi) * 4,
          al = data[o + 3] * k;
        r += data[o] * al;
        g += data[o + 1] * al;
        b += data[o + 2] * al;
        a += al;
      }
    if (a <= 0) {
      out[0] = out[1] = out[2] = out[3] = 0;
      return false;
    }
    out[0] = r / a;
    out[1] = g / a;
    out[2] = b / a;
    out[3] = a;
    return true;
  };
}

/** Compose a sampler with a destination → source mapping for integer pixel
 * positions (as the paint engine passes them). Translations read the nearest
 * pixel so clones stay crisp; scaled or rotated sources are interpolated. */
export function mappedSampler(sample: Sampler, nearest: Sampler, map: (x: number, y: number) => [number, number], translation: boolean): Sampler {
  return (x, y, out) => {
    const [sx, sy] = map(x + 0.5, y + 0.5);
    return translation ? nearest(sx, sy, out) : sample(sx, sy, out);
  };
}

/** Render the mapped source into a destination rectangle (healing source). */
export function renderMapped(sample: Sampler, map: (x: number, y: number) => [number, number], rect: { x: number; y: number; width: number; height: number }): RGBA8 {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  const px = new Uint8ClampedArray(4);
  for (let j = 0; j < rect.height; j++)
    for (let i = 0; i < rect.width; i++) {
      const [sx, sy] = map(rect.x + i + 0.5, rect.y + j + 0.5);
      if (!sample(sx, sy, px)) continue;
      out.set(px, (j * rect.width + i) * 4);
    }
  return { width: rect.width, height: rect.height, data: out };
}
