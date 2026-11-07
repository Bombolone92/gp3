// Select Subject, Remove Background and Select Sky, entirely local and model-free:
// a saliency map (or a sky heuristic) seeds GrabCut at reduced resolution, and a
// guided filter refines the edge at full resolution for soft, hair-like borders.
//
// Quality limits, stated plainly: this works when the subject differs in color
// or brightness from its surroundings and the background touches the image
// border. It cannot recognize objects, so it struggles with camouflage, busy
// backgrounds, several unrelated subjects, subjects cut off on several sides and
// fine translucent detail (veils, smoke). Fine hair against a contrasting plain
// background comes out soft but plausible; against clutter it does not.
import { mask8, type Mask8, type Progress, type RGBA8, checkCancelled } from '../types';
import { downscaleRGBA, guidedFilterColor, guidedUpsample, lumaF32, resizePlane } from './filters';
import { BG, FG, grabCut, PR_BG, PR_FG } from './grabcut';
import { refineEdge } from './refine';
import { labPlanes, otsu, saliency } from './saliency';

export type SubjectOptions = { workSize?: number; seed?: number; progress?: Progress };

export function workSize(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))] as const;
}

// 4-connected component labels of a binary map; returns labels (0 = background)
// and the size of each component (index = label).
export function components(bin: Uint8Array, w: number, h: number) {
  const lab = new Int32Array(w * h), sizes = [0], stack = new Int32Array(w * h);
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || lab[s]) continue;
    const id = sizes.length;
    let sp = 0, count = 0;
    stack[sp++] = s;
    lab[s] = id;
    while (sp) {
      const i = stack[--sp], x = i % w;
      count++;
      if (x > 0 && bin[i - 1] && !lab[i - 1]) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && bin[i + 1] && !lab[i + 1]) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (i >= w && bin[i - w] && !lab[i - w]) { lab[i - w] = id; stack[sp++] = i - w; }
      if (i + w < bin.length && bin[i + w] && !lab[i + w]) { lab[i + w] = id; stack[sp++] = i + w; }
    }
    sizes.push(count);
  }
  return { lab, sizes };
}

// Keep the largest blob and any blob at least `keep` of its size; fill holes
// smaller than `hole` of the image that do not touch the border.
function cleanup(bin: Uint8Array, w: number, h: number, keep: number, hole: number) {
  const { lab, sizes } = components(bin, w, h);
  let big = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > big) big = sizes[k];
  for (let i = 0; i < bin.length; i++) if (bin[i] && sizes[lab[i]] < keep * big) bin[i] = 0;
  const inv = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) inv[i] = bin[i] ? 0 : 1;
  const holes = components(inv, w, h), touches = new Uint8Array(holes.sizes.length);
  for (let x = 0; x < w; x++) touches[holes.lab[x]] = touches[holes.lab[(h - 1) * w + x]] = 1;
  for (let y = 0; y < h; y++) touches[holes.lab[y * w]] = touches[holes.lab[y * w + w - 1]] = 1;
  for (let i = 0; i < bin.length; i++) {
    const l = holes.lab[i];
    if (l && !touches[l] && holes.sizes[l] < hole * bin.length) bin[i] = 1;
  }
  return bin;
}

// Lift a low-resolution hard labeling to a soft full-resolution matte: a color
// guided filter at a middle resolution recovers the edge, a gray guided filter
// at full resolution sharpens it to pixel accuracy.
export function upsampleMatte(img: RGBA8, low: Float32Array, lw: number, lh: number): Mask8 {
  const { width: W, height: H } = img;
  const [mw, mh] = workSize(W, H, 800);
  const mid = mw === W && mh === H ? img : downscaleRGBA(img, mw, mh);
  const p = resizePlane(low, lw, lh, mw, mh);
  const q = guidedFilterColor(mid, p, Math.max(2, Math.ceil((2 * mw) / lw)), 1e-3);
  // Remap the extremes so faint guided-filter haze does not leak into flat areas.
  const remap = (v: number) => (v <= 0.06 ? 0 : v >= 0.94 ? 255 : Math.round((255 * (v - 0.06)) / 0.88));
  if (mw !== W || mh !== H) {
    for (let i = 0; i < q.length; i++) q[i] = Math.min(1, Math.max(0, q[i]));
    return guidedUpsample(lumaF32(mid), q, mw, mh, img, 2, 2e-4, remap);
  }
  const out = mask8(W, H);
  for (let i = 0; i < q.length; i++) out.data[i] = remap(q[i]);
  return out;
}

function erodeBin(bin: Uint8Array, w: number, h: number, r: number) {
  let cur = bin;
  for (let k = 0; k < r; k++) {
    const nx = new Uint8Array(cur.length);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        nx[i] = cur[i] & cur[i - 1] & cur[i + 1] & cur[i - w] & cur[i + w];
      }
    cur = nx;
  }
  return cur;
}

// Hard labels for the main subject at work resolution (exported for tests).
export function subjectLabels(small: RGBA8, seed = 1) {
  const { width: w, height: h } = small, n = w * h;
  const S = saliency(small), t = otsu(S);
  const tri = new Uint8Array(n);
  const core = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    tri[i] = S[i] > t ? PR_FG : PR_BG;
    core[i] = S[i] > 0.5 * (1 + t) ? 1 : 0;
  }
  const sure = erodeBin(core, w, h, Math.max(1, Math.round(Math.min(w, h) / 60)));
  for (let i = 0; i < n; i++) if (sure[i]) tri[i] = FG;
  // The outermost ring is background unless saliency insists otherwise.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && tri[y * w + x] === PR_BG) tri[y * w + x] = BG;
  const lab = grabCut(small, tri, { iterations: 5, seed });
  return cleanup(lab, w, h, 0.15, 0.01);
}

export function selectSubject(img: RGBA8, opts: SubjectOptions = {}): Mask8 {
  const [sw, sh] = workSize(img.width, img.height, opts.workSize ?? 320);
  const small = downscaleRGBA(img, sw, sh);
  checkCancelled(opts.progress);
  const lab = subjectLabels(small, opts.seed);
  opts.progress?.report?.(0.6);
  checkCancelled(opts.progress);
  const f = new Float32Array(lab.length);
  for (let i = 0; i < f.length; i++) f[i] = lab[i];
  const m = upsampleMatte(img, f, sw, sh);
  // Transparent pixels are never part of the subject.
  for (let i = 0; i < m.data.length; i++) if (!img.data[i * 4 + 3]) m.data[i] = 0;
  opts.progress?.report?.(1);
  return m;
}

// Subject matte plus a copy of the image whose edge colors are decontaminated
// and whose alpha is multiplied by the matte (ready to bake as a cut-out). Use
// `mask` as a layer mask to keep the edit non-destructive.
export function removeBackground(img: RGBA8, opts: SubjectOptions = {}): { mask: Mask8; image: RGBA8 } {
  const mask = selectSubject(img, opts);
  const { image } = refineEdge(img, mask, { decontaminate: 1 });
  const out = image!;
  for (let i = 0; i < mask.data.length; i++) out.data[i * 4 + 3] = Math.round((img.data[i * 4 + 3] * mask.data[i]) / 255);
  return { mask, image: out };
}

// Sky: bright or blue, smooth, and connected to the top edge; GrabCut then snaps
// the horizon. Returns an empty mask when nothing sky-like touches the top.
export function selectSky(img: RGBA8, opts: SubjectOptions = {}): Mask8 {
  const [w, h] = workSize(img.width, img.height, opts.workSize ?? 256);
  checkCancelled(opts.progress);
  const small = downscaleRGBA(img, w, h), n = w * h;
  const [L, A, B] = labPlanes(small);
  const score = new Float32Array(n);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let g = 0;
      if (x > 0 && x < w - 1 && y > 0 && y < h - 1) g = Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]);
      const chroma = Math.hypot(A[i], B[i]);
      const blue = B[i] < -8 && L[i] > 30 ? 1 : 0;
      const overcast = L[i] > 68 && chroma < 18 ? 1 : 0;
      // Warm dusk skies: bright, orange to pink, very smooth.
      const dusk = L[i] > 45 && B[i] > 10 && A[i] > -5 && g < 4 ? 0.7 : 0;
      const smoothness = Math.max(0, 1 - g / 14);
      score[i] = Math.max(blue, overcast, dusk) * smoothness * (small.data[i * 4 + 3] / 255);
    }
  const cand = new Uint8Array(n);
  for (let i = 0; i < n; i++) cand[i] = score[i] > 0.45 ? 1 : 0;
  // Flood from the top row through candidates.
  const sky = new Uint8Array(n), stack: number[] = [];
  for (let x = 0; x < w; x++) if (cand[x]) { sky[x] = 1; stack.push(x); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    if (x > 0 && cand[i - 1] && !sky[i - 1]) { sky[i - 1] = 1; stack.push(i - 1); }
    if (x < w - 1 && cand[i + 1] && !sky[i + 1]) { sky[i + 1] = 1; stack.push(i + 1); }
    if (i >= w && cand[i - w] && !sky[i - w]) { sky[i - w] = 1; stack.push(i - w); }
    if (i + w < n && cand[i + w] && !sky[i + w]) { sky[i + w] = 1; stack.push(i + w); }
  }
  let area = 0;
  for (let i = 0; i < n; i++) area += sky[i];
  if (area < 0.02 * n) return mask8(img.width, img.height);
  const tri = new Uint8Array(n);
  const sure = erodeBin(sky, w, h, Math.max(1, Math.round(Math.min(w, h) / 40)));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tri[i] = sure[i] ? FG : sky[i] ? PR_FG : score[i] < 0.15 && y > h * 0.3 ? BG : PR_BG;
      if (y === h - 1 && !sky[i]) tri[i] = BG;
    }
  checkCancelled(opts.progress);
  const lab = grabCut(small, tri, { iterations: 3, seed: opts.seed ?? 1 });
  opts.progress?.report?.(0.6);
  checkCancelled(opts.progress);
  // Only regions connected to the top survive.
  const { lab: cl } = components(lab, w, h), top = new Set<number>();
  for (let x = 0; x < w; x++) if (cl[x]) top.add(cl[x]);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = lab[i] && top.has(cl[i]) ? 1 : 0;
  return upsampleMatte(img, f, w, h);
}
