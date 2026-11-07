// Context Scale: resizing guided by image content, by seam carving. A seam is a
// connected path of one pixel per row (or column) through low-detail areas;
// removing seams narrows an image and duplicating them widens it while edges
// and protected areas keep their shape.
//
// Seams are found once per axis as a removal order: each pixel records the
// index of the seam that removes it. Any target size is then a cheap pass
// over the image (drop or duplicate the first k seams), so interactive drags
// never search seams again. Several non-overlapping seams are taken from each
// dynamic-programming pass, which keeps the search near-linear in practice.
import type { Mask8, Progress, RGBA8 } from '../types';
import { checkCancelled, rgba8 } from '../types';
import { resize } from '../filters/resample';

/** Order value of pixels no seam removes. */
export const KEPT = 0xffff;
export type SeamAxis = 'vertical' | 'horizontal';
// Energy added to protected pixels: far above any seam step (at most 3 x 4 x 255).
const PROTECTED = 1e5;

/** Pixels in a common skin-tone range (a published RGB rule), as 0/255. */
export function skinMask(img: RGBA8): Uint8Array {
  const n = img.width * img.height,
    d = img.data,
    out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4],
      g = d[i * 4 + 1],
      b = d[i * 4 + 2];
    if (d[i * 4 + 3] < 128) continue;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    if (r > 95 && g > 40 && b > 20 && mx - mn > 15 && Math.abs(r - g) > 15 && r > g && r > b) out[i] = 255;
  }
  return out;
}
/** Combine protection sources into one map (nonzero = protected). */
export function protectionMap(img: RGBA8, opts: { skin?: boolean; mask?: Mask8 }): Uint8Array | undefined {
  if (!opts.skin && !opts.mask) return;
  const out = opts.skin ? skinMask(img) : new Uint8Array(img.width * img.height);
  if (opts.mask) for (let i = 0; i < out.length; i++) if (opts.mask.data[i] >= 128) out[i] = 255;
  return out;
}

function transposeRGBA(img: RGBA8): RGBA8 {
  const { width: w, height: h } = img;
  const src = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h);
  const out = rgba8(h, w),
    dst = new Uint32Array(out.data.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dst[x * h + y] = src[y * w + x];
  return out;
}
function transpose<T extends Uint8Array | Uint16Array>(a: T, w: number, h: number): T {
  const out = new (a.constructor as { new (n: number): T })(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + y] = a[y * w + x];
  return out;
}

/** Removal order for up to `maxSeams` seams along `axis` ('vertical' seams
 * narrow the image). */
export function seamOrder(img: RGBA8, axis: SeamAxis, maxSeams: number, protect?: Uint8Array, progress?: Progress): Uint16Array {
  if (axis === 'horizontal') {
    const t = transposeRGBA(img);
    const order = verticalOrder(t, maxSeams, protect && transpose(protect, img.width, img.height), progress);
    return transpose(order, img.height, img.width);
  }
  return verticalOrder(img, maxSeams, protect, progress);
}

function verticalOrder(img: RGBA8, maxSeams: number, protect: Uint8Array | undefined, progress?: Progress): Uint16Array {
  const W = img.width,
    H = img.height,
    N = W * H,
    d = img.data;
  const order = new Uint16Array(N).fill(KEPT);
  maxSeams = Math.max(0, Math.min(maxSeams, W - 1, KEPT - 1));
  if (!maxSeams) return order;
  // Working copies, compacted in place as seams go (row stride W): colours
  // premultiplied by alpha (so a cut-out's outline counts as an edge),
  // packed one pixel per word.
  const col = new Uint32Array(N),
    prot = new Uint8Array(N),
    orig = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const a = d[i * 4 + 3];
    col[i] = (((d[i * 4] * a) / 255) | 0) | ((((d[i * 4 + 1] * a) / 255) | 0) << 8) | ((((d[i * 4 + 2] * a) / 255) | 0) << 16) | (a << 24);
    if (protect && protect[i]) prot[i] = 1;
    orig[i] = i % W;
  }
  // Colour difference between two working pixels.
  const diff = (i: number, j: number) => {
    const x = col[i],
      y = col[j];
    return Math.abs((x & 255) - (y & 255)) + Math.abs(((x >>> 8) & 255) - ((y >>> 8) & 255)) + Math.abs(((x >>> 16) & 255) - ((y >>> 16) & 255)) + Math.abs((x >>> 24) - (y >>> 24));
  };
  const M = new Float32Array(N),
    back = new Int8Array(N),
    taken = new Uint8Array(N),
    path = new Int32Array(H);
  let w = W,
    removed = 0;
  while (removed < maxSeams && w > 1) {
    checkCancelled(progress);
    progress?.report?.(removed / maxSeams);
    // Forward energy: the cost of a seam pixel is the contrast of the new
    // edges its removal creates (between its left and right neighbours, and
    // with the row above on a diagonal step), so seams avoid tearing lines.
    for (let x = 0; x < w; x++) M[x] = (x > 0 && x < w - 1 ? diff(x - 1, x + 1) : 0) + (prot[x] ? PROTECTED : 0);
    for (let y = 1; y < H; y++) {
      const r = y * W,
        p = r - W;
      for (let x = 0; x < w; x++) {
        const cu = x > 0 && x < w - 1 ? diff(r + x - 1, r + x + 1) : 0;
        let best = M[p + x] + cu,
          dir = 0;
        if (x > 0) {
          const v = M[p + x - 1] + cu + diff(p + x, r + x - 1);
          if (v < best) ((best = v), (dir = -1));
        }
        if (x < w - 1) {
          const v = M[p + x + 1] + cu + diff(p + x, r + x + 1);
          if (v < best) ((best = v), (dir = 1));
        }
        M[r + x] = best + (prot[r + x] ? PROTECTED : 0);
        back[r + x] = dir;
      }
    }
    // Take the cheapest seams that do not share pixels with each other.
    const want = Math.min(maxSeams - removed, w - 1, Math.max(1, Math.floor(w * 0.08)));
    const last = (H - 1) * W;
    const ends = Array.from({ length: w }, (_, x) => x).sort((a, b) => M[last + a] - M[last + b]);
    taken.fill(0, 0, H * W);
    let found = 0;
    for (const end of ends) {
      if (found >= want) break;
      if (taken[last + end]) continue;
      let x = end,
        ok = true;
      path[H - 1] = x;
      for (let y = H - 1; y > 0; y--) {
        const p = (y - 1) * W;
        let nx = x + back[y * W + x];
        if (taken[p + nx]) {
          nx = -1;
          let best = Infinity;
          for (let c = Math.max(0, x - 1); c <= Math.min(w - 1, x + 1); c++)
            if (!taken[p + c] && M[p + c] < best) ((best = M[p + c]), (nx = c));
          if (nx < 0) {
            ok = false;
            break;
          }
        }
        x = nx;
        path[y - 1] = x;
      }
      if (!ok) continue;
      const index = removed + found++;
      for (let y = 0; y < H; y++) {
        const k = y * W + path[y];
        taken[k] = 1;
        order[y * W + orig[k]] = index;
      }
    }
    if (!found) break;
    // Close the gaps the seams left in each row.
    for (let y = 0; y < H; y++) {
      const r = y * W;
      let o = r;
      for (let x = 0; x < w; x++) {
        const k = r + x;
        if (taken[k]) continue;
        col[o] = col[k];
        prot[o] = prot[k];
        orig[o] = orig[k];
        o++;
      }
    }
    w -= found;
    removed += found;
  }
  progress?.report?.(1);
  return order;
}

/** Number of seams available in a row-major order map (per row). */
export function seamCount(order: Uint16Array, width: number) {
  let n = 0;
  for (let x = 0; x < width; x++) if (order[x] !== KEPT) n++;
  return n;
}

/** Change the width of `img` to `target` by dropping (narrowing) or
 * duplicating (widening) the first seams of `order`, as far as the order has
 * seams. Per row, the pixels with the lowest order values are chosen, so
 * maps that were carried through another carve stay usable. `carry` maps
 * (row-major, same size) receive the same edit. */
export function carveWidth(img: RGBA8, order: Uint16Array, target: number, carry: Uint16Array[] = []): { image: RGBA8; carry: Uint16Array[] } {
  const W = img.width,
    H = img.height;
  const available = seamCount(order, W);
  const k = Math.min(Math.abs(target - W), available, target < W ? W - 1 : W);
  if (!k) return { image: img, carry };
  const widen = target > W;
  const OW = widen ? W + k : W - k;
  const out = rgba8(OW, H),
    od = out.data,
    sd = img.data;
  const carried = carry.map(() => new Uint16Array(OW * H));
  const row = new Uint16Array(W),
    pick = new Uint8Array(W);
  for (let y = 0; y < H; y++) {
    const r = y * W;
    // The k-th smallest order value in this row decides which pixels go.
    row.set(order.subarray(r, r + W));
    row.sort();
    const limit = row[k - 1];
    let below = 0;
    for (let x = 0; x < W; x++) if (order[r + x] < limit) below++;
    let ties = k - below;
    for (let x = 0; x < W; x++) {
      const v = order[r + x];
      pick[x] = v < limit || (v === limit && ties-- > 0) ? 1 : 0;
    }
    let o = y * OW;
    for (let x = 0; x < W; x++) {
      if (!widen && pick[x]) continue;
      od.set(sd.subarray((r + x) * 4, (r + x) * 4 + 4), o * 4);
      carried.forEach((c, i) => (c[o] = carry[i][r + x]));
      o++;
      if (widen && pick[x]) {
        // The inserted pixel averages the seam pixel and its right neighbour.
        const n = r + (x < W - 1 ? x + 1 : Math.max(0, x - 1));
        const s = (r + x) * 4,
          t = n * 4;
        const a1 = sd[s + 3],
          a2 = sd[t + 3],
          a = a1 + a2;
        for (let c = 0; c < 3; c++) od[o * 4 + c] = a ? (sd[s + c] * a1 + sd[t + c] * a2) / a : (sd[s + c] + sd[t + c]) / 2;
        od[o * 4 + 3] = a / 2;
        carried.forEach((c, i) => (c[o] = carry[i][r + x]));
        o++;
      }
    }
  }
  return { image: out, carry: carried };
}
/** Change the height to `target` with a column-wise order map. */
export function carveHeight(img: RGBA8, order: Uint16Array, target: number): RGBA8 {
  const t = transposeRGBA(img);
  const r = carveWidth(t, transpose(order, img.width, img.height), target);
  return r.image === t ? img : transposeRGBA(r.image);
}

export type ContextScaleOrders = { vertical: Uint16Array; horizontal: Uint16Array };
/** Size reached by seams for `amount` (0..1) of a change to width x height. */
export function seamSize(W: number, H: number, width: number, height: number, amount: number) {
  return { cw: Math.max(1, Math.round(W + amount * (width - W))), ch: Math.max(1, Math.round(H + amount * (height - H))) };
}
/** The width pass of a resize: the narrowed or widened image, with the
 * horizontal order and protection map carried through the same edit. */
export function widthPass(img: RGBA8, orders: ContextScaleOrders, cw: number, protect?: Uint8Array) {
  if (cw === img.width) return { image: img, horizontal: orders.horizontal, protect };
  const r = carveWidth(img, orders.vertical, cw, protect ? [orders.horizontal, Uint16Array.from(protect)] : [orders.horizontal]);
  return { image: r.image, horizontal: r.carry[0], protect: r.carry[1] && Uint8Array.from(r.carry[1]) };
}
/** Resize `img` to `width` x `height`: `amount` (0..1) of the change comes
 * from seams and the rest, plus anything beyond the available seams, from
 * ordinary resampling. Columns go first; the rows of the narrowed image then
 * follow `heightOrder` when given (searched on that image, the exact
 * result), else the original horizontal order carried through the column
 * pass (a close, instant approximation). */
export function contextScale(img: RGBA8, orders: ContextScaleOrders, width: number, height: number, amount = 1, heightOrder?: Uint16Array): RGBA8 {
  const W = img.width,
    H = img.height;
  const { cw, ch } = seamSize(W, H, width, height, amount);
  const first = widthPass(img, orders, cw);
  let out = first.image;
  if (ch !== H) out = carveHeight(out, heightOrder && heightOrder.length === out.width * out.height ? heightOrder : first.horizontal, ch);
  if (out.width !== width || out.height !== height) out = resize(out, width, height, 'bicubic');
  return out === img ? { width: W, height: H, data: new Uint8ClampedArray(img.data) } : out;
}
