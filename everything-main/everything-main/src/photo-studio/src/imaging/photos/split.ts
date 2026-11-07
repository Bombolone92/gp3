// Crop and Straighten Photos: find several photos scanned together on a flat
// background and cut each out upright. The background color comes from the
// image border; foreground regions are cleaned up morphologically, and each
// region's minimum-area rectangle (rotating calipers over its convex hull)
// gives the crop and the skew angle.
import { checkCancelled, type Progress, type RGBA8 } from '../types';
import { rectifyQuad, type Point } from '../filters/warp';

export type FoundPhoto = {
  // Corners in image pixels: top-left, top-right, bottom-right, bottom-left
  // of the upright photo.
  corners: Point[];
  width: number;
  height: number;
  // Rotation of the photo in degrees (positive = clockwise on the scan).
  angle: number;
};
export type SplitOptions = { tolerance?: number; minArea?: number; progress?: Progress };

function borderColor(img: RGBA8): [number, number, number] {
  const { width: w, height: h, data } = img;
  const vals: number[][] = [[], [], []];
  const push = (x: number, y: number) => {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) vals[c].push(data[o + c]);
  };
  for (let x = 0; x < w; x += Math.max(1, w >> 8)) (push(x, 0), push(x, h - 1));
  for (let y = 0; y < h; y += Math.max(1, h >> 8)) (push(0, y), push(w - 1, y));
  return vals.map((v) => v.sort((a, b) => a - b)[v.length >> 1]) as [number, number, number];
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Minimum-area enclosing rectangle of a convex polygon. */
export function minAreaRect(hull: Point[]): { center: Point; width: number; height: number; angle: number } {
  let best = { area: Infinity, center: { x: 0, y: 0 }, width: 0, height: 0, angle: 0 };
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i],
      b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len,
      uy = (b.y - a.y) / len;
    let minU = Infinity,
      maxU = -Infinity,
      minV = Infinity,
      maxV = -Infinity;
    for (const q of hull) {
      const u = q.x * ux + q.y * uy,
        v = -q.x * uy + q.y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const cu = (minU + maxU) / 2,
        cv = (minV + maxV) / 2;
      best = { area, center: { x: cu * ux - cv * uy, y: cu * uy + cv * ux }, width: maxU - minU, height: maxV - minV, angle: Math.atan2(uy, ux) };
    }
  }
  // Normalize so the angle is the smallest rotation (|angle| <= 45°).
  let { width, height, angle } = best;
  while (angle > Math.PI / 4) {
    angle -= Math.PI / 2;
    [width, height] = [height, width];
  }
  while (angle < -Math.PI / 4) {
    angle += Math.PI / 2;
    [width, height] = [height, width];
  }
  return { center: best.center, width, height, angle };
}

/** Find the photos on a scan. */
export function findPhotos(img: RGBA8, opts: SplitOptions = {}): FoundPhoto[] {
  const tol = opts.tolerance ?? 28;
  const k = Math.min(1, 900 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)),
    h = Math.max(1, Math.round(img.height * k));
  const bg = borderColor(img);
  const fg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) / k)),
        sy = Math.min(img.height - 1, Math.floor((y + 0.5) / k));
      const o = (sy * img.width + sx) * 4;
      if (img.data[o + 3] < 128) continue;
      const d = Math.max(Math.abs(img.data[o] - bg[0]), Math.abs(img.data[o + 1] - bg[1]), Math.abs(img.data[o + 2] - bg[2]));
      fg[y * w + x] = d > tol ? 1 : 0;
    }
  checkCancelled(opts.progress);
  // Close small gaps (photo areas that match the background), then open to
  // drop dust and scanner noise.
  const morph = (src: Uint8Array, r: number, grow: boolean) => {
    const tmp = new Uint8Array(w * h),
      out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.max(0, Math.min(w - 1, x + dx));
          if (grow ? src[y * w + xx] : !src[y * w + xx]) {
            v = grow ? 1 : 0;
            break;
          }
        }
        tmp[y * w + x] = v;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.max(0, Math.min(h - 1, y + dy));
          if (grow ? tmp[yy * w + x] : !tmp[yy * w + x]) {
            v = grow ? 1 : 0;
            break;
          }
        }
        out[y * w + x] = v;
      }
    return out;
  };
  let m = morph(morph(fg, 3, true), 3, false);
  m = morph(morph(m, 2, false), 2, true);
  // Connected components (4-connected flood fill).
  const label = new Int32Array(w * h).fill(-1);
  const comps: Point[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || label[i] >= 0) continue;
    const id = comps.length;
    const pts: Point[] = [];
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w,
        y = (j - x) / w;
      // Boundary pixels are enough for the hull.
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !m[j - 1] || !m[j + 1] || !m[j - w] || !m[j + w])
        pts.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 });
      for (const n of [j - 1, j + 1, j - w, j + w]) {
        if (n < 0 || n >= w * h || label[n] >= 0 || !m[n]) continue;
        if ((n === j - 1 && x === 0) || (n === j + 1 && x === w - 1)) continue;
        label[n] = id;
        stack.push(n);
      }
    }
    comps.push(pts);
  }
  const minArea = (opts.minArea ?? 0.01) * w * h;
  const found: FoundPhoto[] = [];
  for (const pts of comps) {
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const r = minAreaRect(hull);
    if (r.width * r.height < minArea || r.width < 8 || r.height < 8) continue;
    // Trim the morphology's slack (about one work pixel) and scale back.
    const cw = (r.width - 1) / k,
      ch = (r.height - 1) / k;
    const c = { x: r.center.x / k, y: r.center.y / k };
    const cos = Math.cos(r.angle),
      sin = Math.sin(r.angle);
    const corner = (u: number, v: number): Point => ({ x: c.x + u * cos - v * sin, y: c.y + u * sin + v * cos });
    found.push({
      corners: [corner(-cw / 2, -ch / 2), corner(cw / 2, -ch / 2), corner(cw / 2, ch / 2), corner(-cw / 2, ch / 2)],
      width: Math.round(cw),
      height: Math.round(ch),
      angle: (r.angle * 180) / Math.PI,
    });
  }
  // Reading order: top to bottom, then left to right.
  const cy = (p: FoundPhoto) => p.corners.reduce((s, q) => s + q.y, 0) / 4;
  const cx = (p: FoundPhoto) => p.corners.reduce((s, q) => s + q.x, 0) / 4;
  const rowH = img.height / 8;
  found.sort((a, b) => Math.round(cy(a) / rowH) - Math.round(cy(b) / rowH) || cx(a) - cx(b));
  return found;
}

/** Cut one found photo out of the scan, upright. */
export function extractPhoto(img: RGBA8, p: FoundPhoto): RGBA8 {
  return rectifyQuad(img, p.corners, Math.max(1, p.width), Math.max(1, p.height), 'bicubic');
}
