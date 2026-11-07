// Layer → Mask All Objects: find every distinct object in an image and return a
// soft mask for each, without learned models.
//
// It extends Select Subject: the same salient-region map (minimum barrier
// distance to the border plus border-contrast backgroundness, here with only a
// light center bias so objects near the edges count) seeds GrabCut at work
// resolution, but instead of keeping the largest region, every separate
// foreground region becomes an object. Thin bridges between neighbors are cut
// by a one-pixel opening, regions below the minimum size are dropped and each
// survivor is lifted to a soft full-resolution matte inside its own bounds.
//
// Limits, stated plainly: it separates objects that stand apart from a
// background reaching the image border. Touching objects of similar color stay
// one object, and a busy background can produce extra regions (raise the
// minimum size) or hide low-contrast objects.
import { checkCancelled, type IRect, type Mask8, type Progress, type RGBA8 } from '../types';
import { downscaleRGBA } from './filters';
import { BG, FG, grabCut, PR_BG, PR_FG } from './grabcut';
import { otsu, saliency } from './saliency';
import { components, upsampleMatte, workSize } from './subject';

export type DetectedObject = {
  // Full-resolution bounds of the mask (document pixels of the source image).
  rect: IRect;
  // Soft coverage inside `rect`.
  mask: Mask8;
  // Share of the image covered, 0..1.
  area: number;
};
export type ObjectOptions = {
  // Smallest object kept, as a share of the image area.
  minSize?: number;
  maxObjects?: number;
  workSize?: number;
  seed?: number;
  progress?: Progress;
};

function erode(bin: Uint8Array, w: number, h: number) {
  const out = new Uint8Array(bin.length);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = bin[i] & bin[i - 1] & bin[i + 1] & bin[i - w] & bin[i + w];
    }
  return out;
}

/** Object labels at work resolution: 0 = background, k = object k (largest
 * first), plus each object's pixel count. Exported for tests. */
export function objectLabels(small: RGBA8, minSize = 0.002, maxObjects = 32, seed = 1) {
  const { width: w, height: h } = small, n = w * h;
  const S = saliency(small, 0.15), t = otsu(S);
  const tri = new Uint8Array(n), core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    tri[i] = S[i] > t ? PR_FG : PR_BG;
    core[i] = S[i] > 0.5 * (1 + t) ? 1 : 0;
  }
  const sure = erode(erode(core, w, h), w, h);
  for (let i = 0; i < n; i++) if (sure[i]) tri[i] = FG;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && tri[y * w + x] === PR_BG) tri[y * w + x] = BG;
  // Transparent pixels are never objects.
  for (let i = 0; i < n; i++) if (small.data[i * 4 + 3] < 128) tri[i] = BG;
  const fg = grabCut(small, tri, { iterations: 5, seed });
  // Opening cuts one-pixel bridges; components are found on the opened map
  // and the pixels the opening removed rejoin their nearest labeled neighbor.
  const opened = erode(fg, w, h);
  const { lab: lab0, sizes } = components(opened, w, h);
  const lab = Int32Array.from(lab0);
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      if (!fg[i] || lab[i]) continue;
      const x = i % w;
      lab[i] = (x > 0 && lab[i - 1]) || (x < w - 1 && lab[i + 1]) || (i >= w && lab[i - w]) || (i + w < n && lab[i + w]) || 0;
    }
  // Keep objects above the minimum size, largest first, renumbered 1..k.
  const counts = new Array<number>(sizes.length).fill(0);
  for (let i = 0; i < n; i++) counts[lab[i]]++;
  const order = counts
    .map((c, k) => ({ k, c }))
    .filter(({ k, c }) => k > 0 && c >= Math.max(4, minSize * n))
    .sort((a, b) => b.c - a.c)
    .slice(0, maxObjects);
  const remap = new Int32Array(sizes.length);
  order.forEach(({ k }, j) => (remap[k] = j + 1));
  for (let i = 0; i < n; i++) lab[i] = remap[lab[i]];
  // Fill holes enclosed by a single object.
  const holes = components(Uint8Array.from(lab, (v) => (v ? 0 : 1)), w, h);
  const owner = new Int32Array(holes.sizes.length).fill(-1);
  for (let i = 0; i < n; i++) {
    const hl = holes.lab[i];
    if (!hl) continue;
    const x = i % w, y = (i / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) owner[hl] = 0;
    const nb = [x > 0 ? lab[i - 1] : 0, x < w - 1 ? lab[i + 1] : 0, y > 0 ? lab[i - w] : 0, y < h - 1 ? lab[i + w] : 0];
    for (const v of nb) {
      if (!v) continue;
      if (owner[hl] === -1) owner[hl] = v;
      else if (owner[hl] !== v) owner[hl] = 0;
    }
  }
  for (let i = 0; i < n; i++) {
    const hl = holes.lab[i];
    if (hl && owner[hl] > 0 && holes.sizes[hl] < 0.02 * n) lab[i] = owner[hl];
  }
  return { lab, count: order.length, sizes: [0, ...order.map((o) => o.c)] };
}

/** Detect objects and return a soft full-resolution mask for each. */
export function detectObjects(img: RGBA8, opts: ObjectOptions = {}): DetectedObject[] {
  const { width: W, height: H } = img;
  const [sw, sh] = workSize(W, H, opts.workSize ?? 320);
  const small = downscaleRGBA(img, sw, sh);
  checkCancelled(opts.progress);
  const { lab, count } = objectLabels(small, opts.minSize ?? 0.002, opts.maxObjects ?? 32, opts.seed ?? 1);
  opts.progress?.report?.(0.5);
  const out: DetectedObject[] = [];
  const sx = W / sw, sy = H / sh;
  for (let k = 1; k <= count; k++) {
    checkCancelled(opts.progress);
    let x0 = sw, y0 = sh, x1 = -1, y1 = -1, area = 0;
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++)
        if (lab[y * sw + x] === k) {
          area++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) continue;
    // Low-resolution bounds with a margin for the soft edge.
    const m = 2;
    const lx = Math.max(0, x0 - m), ly = Math.max(0, y0 - m), lw = Math.min(sw, x1 + m + 1) - lx, lh = Math.min(sh, y1 + m + 1) - ly;
    const rect = { x: Math.floor(lx * sx), y: Math.floor(ly * sy), width: 0, height: 0 };
    rect.width = Math.min(W, Math.ceil((lx + lw) * sx)) - rect.x;
    rect.height = Math.min(H, Math.ceil((ly + lh) * sy)) - rect.y;
    const low = new Float32Array(lw * lh);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) low[y * lw + x] = lab[(y + ly) * sw + x + lx] === k ? 1 : 0;
    const crop: RGBA8 = { width: rect.width, height: rect.height, data: new Uint8ClampedArray(rect.width * rect.height * 4) };
    for (let y = 0; y < rect.height; y++)
      crop.data.set(img.data.subarray(((y + rect.y) * W + rect.x) * 4, ((y + rect.y) * W + rect.x + rect.width) * 4), y * rect.width * 4);
    const mask = upsampleMatte(crop, low, lw, lh);
    for (let i = 0; i < mask.data.length; i++) if (!crop.data[i * 4 + 3]) mask.data[i] = 0;
    out.push({ rect, mask, area: area / (sw * sh) });
    opts.progress?.report?.(0.5 + (0.5 * k) / count);
  }
  return out;
}
