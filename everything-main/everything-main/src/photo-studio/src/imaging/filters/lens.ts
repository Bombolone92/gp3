// Lens Correction: radial distortion (Brown-Conrady polynomial in r^2 and r^4),
// lateral chromatic aberration as per-channel radial scale, vignette gain in
// linear light, and a perspective/rotation/scale transform, all evaluated as one
// inverse map so the image is resampled only once.
import type { ImageOperation, ParamValues } from '../types';
import { checkCancelled, cloneRGBA8, rgba8 } from '../types';
import { type Mat3, mat3Invert, mat3Multiply } from './warp';
import { SRGB_TO_LINEAR, blendSelection, encodeSRGB, num, sampleBilinear, str } from './sampling';

export type LensParams = {
  distortion?: number; // -100..100, positive removes barrel distortion
  distortion2?: number; // -100..100, higher-order (r^4) term
  caRedCyan?: number; // -100..100
  caGreenMagenta?: number;
  caBlueYellow?: number;
  vignetteAmount?: number; // -100..100, positive lightens corners
  vignetteMidpoint?: number; // 0..100
  vertical?: number; // -100..100 perspective
  horizontal?: number;
  angle?: number; // degrees
  scale?: number; // percent
  edge?: 'transparent' | 'edge-extension' | 'background';
};

// Forward geometric transform of the corrected image (rotations of the image
// plane about the horizontal/vertical axes through the center, viewed with a
// focal length equal to the image diagonal, then rotate and scale).
function perspectiveMatrix(
  w: number,
  h: number,
  vertical: number,
  horizontal: number,
  angle: number,
  scale: number,
): Mat3 {
  const cx = w / 2,
    cy = h / 2,
    f = Math.hypot(w, h);
  const K: Mat3 = [f, 0, cx, 0, f, cy, 0, 0, 1],
    Ki = mat3Invert(K)!;
  const a = vertical * (Math.PI / 6),
    b = horizontal * (Math.PI / 6);
  const Rx: Mat3 = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const Ry: Mat3 = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)];
  const P = mat3Multiply(K, mat3Multiply(Ry, mat3Multiply(Rx, Ki)));
  const t = (angle * Math.PI) / 180,
    c = Math.cos(t) * scale,
    s = Math.sin(t) * scale;
  const RS: Mat3 = [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
  return mat3Multiply(RS, P);
}

export const lensCorrection: ImageOperation = {
  id: 'lens-correction',
  label: 'Lens Correction',
  category: 'Distort',
  params: [
    { key: 'distortion', label: 'Remove distortion', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'distortion2', label: 'Edge distortion', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'caRedCyan', label: 'Fix red/cyan fringe', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'caGreenMagenta', label: 'Fix green/magenta fringe', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'caBlueYellow', label: 'Fix blue/yellow fringe', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'vignetteAmount', label: 'Vignette amount', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'vignetteMidpoint', label: 'Vignette midpoint', type: 'number', min: 0, max: 100, default: 50 },
    { key: 'vertical', label: 'Vertical perspective', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'horizontal', label: 'Horizontal perspective', type: 'number', min: -100, max: 100, default: 0 },
    { key: 'angle', label: 'Angle', type: 'number', min: -180, max: 180, step: 0.1, default: 0, unit: '°' },
    { key: 'scale', label: 'Scale', type: 'number', min: 50, max: 150, default: 100, unit: '%' },
    {
      key: 'edge',
      label: 'Edge',
      type: 'select',
      options: [
        { value: 'transparent', label: 'Transparency' },
        { value: 'edge-extension', label: 'Edge extension' },
        { value: 'background', label: 'Background color' },
      ],
      default: 'transparent',
    },
  ],
  apply(src, p: ParamValues, ctx, progress) {
    const w = src.width,
      h = src.height;
    const k1 = (-num(p, 'distortion', 0) / 100) * 0.35,
      k2 = (-num(p, 'distortion2', 0) / 100) * 0.2;
    // Per-channel radial scale: red/cyan moves red, blue/yellow moves blue and
    // green/magenta moves green against the other two.
    const sr = 1 + (num(p, 'caRedCyan', 0) / 100) * 0.005,
      sg = 1 - (num(p, 'caGreenMagenta', 0) / 100) * 0.005,
      sb = 1 + (num(p, 'caBlueYellow', 0) / 100) * 0.005;
    const vAmt = num(p, 'vignetteAmount', 0) / 100,
      vMid = Math.max(0, Math.min(1, num(p, 'vignetteMidpoint', 50) / 100)) * 0.9;
    const vert = num(p, 'vertical', 0) / 100,
      hor = num(p, 'horizontal', 0) / 100,
      angle = num(p, 'angle', 0),
      scale = num(p, 'scale', 100) / 100;
    const edge = str(p, 'edge', 'transparent');
    const geometric = k1 || k2 || sr !== 1 || sg !== 1 || sb !== 1 || vert || hor || angle || scale !== 1;
    if (!geometric && !vAmt) return cloneRGBA8(src);
    const inv = mat3Invert(perspectiveMatrix(w, h, vert, hor, angle, scale)) ?? ([1, 0, 0, 0, 1, 0, 0, 0, 1] as Mat3);
    const [a, b, c, d, e, f, g, hh, ii] = inv;
    const cx = w / 2,
      cy = h / 2,
      rn = 1 / Math.hypot(cx, cy);
    const [bgR, bgG, bgB] = ctx.background;
    const mode = edge === 'edge-extension' ? 'clamp' : 'transparent';
    const sd = src.data,
      out = rgba8(w, h),
      od = out.data,
      px = new Float32Array(12);
    const chroma = sr !== 1 || sg !== 1 || sb !== 1;
    // One function per row keeps V8 from bouncing in and out of OSR code.
    const row = (y: number) => {
      const Y = y + 0.5;
      for (let x = 0; x < w; x++) {
        const X = x + 0.5,
          o = (y * w + x) * 4;
        let gx = X,
          gy = Y,
          rad = 1;
        if (geometric) {
          const ww = g * X + hh * Y + ii;
          if (ww <= 0) {
            if (edge === 'background') ((od[o] = bgR), (od[o + 1] = bgG), (od[o + 2] = bgB), (od[o + 3] = 255));
            continue;
          }
          const ux = (a * X + b * Y + c) / ww - cx,
            uy = (d * X + e * Y + f) / ww - cy;
          const r2 = (ux * ux + uy * uy) * rn * rn;
          rad = 1 + k1 * r2 + k2 * r2 * r2;
          gx = cx + ux * rad * sg;
          gy = cy + uy * rad * sg;
          if (edge === 'background' && (gx < 0 || gy < 0 || gx > w || gy > h)) {
            od[o] = bgR;
            od[o + 1] = bgG;
            od[o + 2] = bgB;
            od[o + 3] = 255;
            continue;
          }
          sampleBilinear(src, gx, gy, mode, px, 0);
          if (chroma) {
            const ux2 = (gx - cx) / sg,
              uy2 = (gy - cy) / sg;
            sampleBilinear(src, cx + ux2 * sr, cy + uy2 * sr, mode, px, 4);
            sampleBilinear(src, cx + ux2 * sb, cy + uy2 * sb, mode, px, 8);
            px[0] = px[4];
            px[2] = px[10];
          }
        } else {
          px[0] = sd[o];
          px[1] = sd[o + 1];
          px[2] = sd[o + 2];
          px[3] = sd[o + 3];
        }
        if (vAmt) {
          const r = Math.sqrt((gx - cx) * (gx - cx) + (gy - cy) * (gy - cy)) * rn,
            t = r <= vMid ? 0 : Math.min(1, (r - vMid) / (1 - vMid)),
            gain = 1 + (vAmt > 0 ? 1.5 : 1) * vAmt * t * t;
          od[o] = encodeSRGB(SRGB_TO_LINEAR[Math.round(px[0])] * gain);
          od[o + 1] = encodeSRGB(SRGB_TO_LINEAR[Math.round(px[1])] * gain);
          od[o + 2] = encodeSRGB(SRGB_TO_LINEAR[Math.round(px[2])] * gain);
        } else {
          od[o] = px[0];
          od[o + 1] = px[1];
          od[o + 2] = px[2];
        }
        od[o + 3] = px[3];
      }
    };
    for (let y = 0; y < h; y++) {
      if ((y & 31) === 0) {
        checkCancelled(progress);
        progress?.report?.(y / h);
      }
      row(y);
    }
    progress?.report?.(1);
    return blendSelection(src, out, ctx.selection);
  },
};
