/**
 * Bitmap tracing: pixels in, compact vector shapes out. Pure and
 * synchronous; trace-runner.js runs it in a worker.
 *
 *   1. quantize colors (OKLab k-means, gray levels or a threshold)
 *   2. find connected regions and absorb ones smaller than the noise size
 *   3. optionally turn thin regions into centerline strokes
 *   4. extract region boundaries as chains shared by neighboring regions
 *   5. fit each chain once with corners and Beziers (so shapes meet exactly)
 *   6. assemble each region's contours into a path, in paint order
 *
 * Result: { w, h, shapes, stats } in pixel-grid units, where shapes are
 *   { f: '#rrggbb', d }            filled shape (even-odd), or
 *   { s: '#rrggbb', sw, d }        centerline stroke,
 * and `d` is path data using only absolute M, L, C and Z.
 * stats: { paths, anchors, colors }.
 */
import { quantize, toHex, rgbToOklab } from './color.js';
import { components, mergeRegions, regionStats, regionNeighbors, absorbRegions } from './regions.js';
import { buildChains, regionContours, contourArea, OUTSIDE } from './contours.js';
import { fitChain, reverseGeometry, smoothJunctions } from './fit.js';
import { regionDistance, centerline } from './centerline.js';
import { normalizeOptions } from './presets.js';

const MAX_REGIONS = 9000;

/** Distance tolerance (source pixels) for a Paths value 0..100. */
export function pathTolerance(paths) {
  return 0.3 + 2.7 * (1 - paths / 100) ** 1.5;
}

/** Corner turning-angle threshold (degrees) for a Corners value 0..100. */
export function cornerThreshold(corners) {
  return 150 - 1.1 * corners;
}

const num = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

function segData(g) {
  let s = '';
  for (const p of g.segs) s += p.length === 2 ? `L${num(p[0])} ${num(p[1])}` : `C${num(p[0])} ${num(p[1])} ${num(p[2])} ${num(p[3])} ${num(p[4])} ${num(p[5])}`;
  return s;
}

function isWhite(c) {
  const lab = rgbToOklab(Math.round(c.r), Math.round(c.g), Math.round(c.b));
  return lab[0] > 0.955 && Math.hypot(lab[1], lab[2]) < 0.03;
}

/**
 * Antialiased edges leave one-pixel slivers whose color is a mix of the two
 * areas they separate. Such slivers join the neighbor closest in color, so
 * edges stay single, clean boundaries. Returns true when anything moved.
 */
function absorbEdgeBlends(region, regions, w, h, scale = 1) {
  // Enlarged images spread antialiasing over about `scale` pixels.
  const limit = Math.max(1, scale) + 0.01;
  const dist = regionDistance(region, w, h);
  const thick = new Float32Array(regions.length);
  for (let i = 0; i < region.length; i++) if (dist[i] > thick[region[i]]) thick[region[i]] = dist[i];
  const nb = regionNeighbors(region, regions.length, w, h);
  const lab = regions.map((r) => rgbToOklab(Math.round(r.r), Math.round(r.g), Math.round(r.b)));
  const target = new Int32Array(regions.length).map((_, i) => i);
  regions.forEach((r, id) => {
    if (r.label < 0 || thick[id] > limit || !r.area) return;
    const sides = [...nb[id]].filter(([k]) => regions[k].label >= 0 && thick[k] > limit).sort((a, b) => b[1] - a[1]);
    if (!sides.length) return;
    const C = lab[id];
    const A = lab[sides[0][0]];
    const B = sides.length > 1 ? lab[sides[1][0]] : A;
    // Distance from C to the segment A-B in OKLab: small means C is a blend of A and B.
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((C[0] - A[0]) * ab[0] + (C[1] - A[1]) * ab[1] + (C[2] - A[2]) * ab[2]) / len2)) : 0;
    const d = Math.hypot(C[0] - A[0] - t * ab[0], C[1] - A[1] - t * ab[1], C[2] - A[2] - t * ab[2]);
    if (d > 0.045) return;
    target[id] = t <= 0.5 || sides.length < 2 ? sides[0][0] : sides[1][0];
  });
  return absorbRegions(region, target) > 0;
}

/**
 * Junctions sit on pixel corners, up to a pixel off the smooth boundary
 * running through them. Where two of a junction's chains continue each
 * other (the boundary passes straight through), the junction moves to the
 * average of the nearby points of both, at most `limit` pixels. Every chain
 * meeting there uses the moved point, so shapes still meet exactly. Image
 * border points stay put. Returns Map(lattice key -> [x, y]).
 */
function relaxJunctions(chains, w, h, K, limit) {
  const ends = new Map();
  for (const c of chains) {
    if (c.closed) continue;
    const n = c.pts.length / 2;
    const add = (x, y, idx) => {
      if (x === 0 || y === 0 || x === w || y === h) return;
      const key = y * (w + 1) + x;
      const pts = [];
      for (let j = 1; j <= Math.min(K, n - 1); j++) {
        const i = idx(j);
        pts.push(c.pts[i * 2], c.pts[i * 2 + 1]);
      }
      if (!pts.length) return;
      let list = ends.get(key);
      if (!list) ends.set(key, (list = []));
      const dx = pts[pts.length - 2] - x;
      const dy = pts[pts.length - 1] - y;
      const l = Math.hypot(dx, dy) || 1;
      list.push({ x, y, pts, ux: dx / l, uy: dy / l });
    };
    add(c.sx, c.sy, (j) => j);
    add(c.ex, c.ey, (j) => n - 1 - j);
  }
  const out = new Map();
  for (const [key, list] of ends) {
    let best = null;
    let bd = 0.85; // nearly opposite: the boundary runs straight through
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = -(list[i].ux * list[j].ux + list[i].uy * list[j].uy);
      if (d > bd) (bd = d), (best = [list[i], list[j]]);
    }
    if (!best) continue;
    const [a, b] = best;
    let sx = a.x;
    let sy = a.y;
    let n = 1;
    for (const e of [a, b]) for (let i = 0; i < e.pts.length; i += 2) (sx += e.pts[i]), (sy += e.pts[i + 1]), n++;
    let dx = sx / n - a.x;
    let dy = sy / n - a.y;
    const d = Math.hypot(dx, dy);
    if (d > limit) (dx *= limit / d), (dy *= limit / d);
    if (d > 1e-6) out.set(key, [a.x + dx, a.y + dy]);
  }
  return out;
}

/**
 * Trace an image { width, height, data (RGBA) }. extra:
 *   scale       grid pixels per source pixel (noise and widths are in source pixels)
 *   swatches    ['#rrggbb'] for the document-swatches palette
 *   onProgress  (fraction 0..1) => void
 */
export function traceImage(image, options, { scale = 1, swatches = null, onProgress = null } = {}) {
  const o = normalizeOptions(options);
  const { width: w, height: h, data } = image;
  const progress = (v) => onProgress?.(v);
  progress(0.02);
  const q = quantize(image, { mode: o.mode, palette: o.palette, colors: o.colors, grays: o.grays, threshold: o.threshold, swatches });
  progress(0.2);
  const paletteLab = q.palette.map((c) => rgbToOklab(Math.round(c.r), Math.round(c.g), Math.round(c.b)));
  const distance = (a, b) => (a < 0 || b < 0 ? 10 : Math.hypot(paletteLab[a][0] - paletteLab[b][0], paletteLab[a][1] - paletteLab[b][1], paletteLab[a][2] - paletteLab[b][2]));
  const cc = components(q.labels, w, h);
  const minArea = Math.max(1, Math.round(o.noise * scale * scale));
  const { region, regions } = mergeRegions(cc, w, h, { minArea, maxRegions: MAX_REGIONS, distance });
  regionStats(region, regions, w, h, data);
  if (o.mode !== 'bw' && absorbEdgeBlends(region, regions, w, h, scale)) regionStats(region, regions, w, h, data);
  progress(0.4);

  // Region colors and which regions are drawn.
  for (const r of regions) {
    r.void = r.label < 0;
    if (r.void) continue;
    const c = o.mode === 'color' && o.palette === 'fullTone' ? { r: r.r, g: r.g, b: r.b } : q.palette[r.label];
    r.hex = toHex(c);
    if (o.ignoreWhite && (o.mode === 'bw' ? r.label === 1 : isWhite(c))) r.void = true;
  }

  const tol = Math.max(0.25, pathTolerance(o.paths) * scale);
  const cornerAngle = cornerThreshold(o.corners);
  const lineTolerance = o.snapLines ? Math.max(tol, 0.6) : 0.12;
  const strokes = [];
  if (o.strokes) {
    const dist = regionDistance(region, w, h);
    const thick = new Float32Array(regions.length);
    for (let i = 0; i < w * h; i++) if (dist[i] > thick[region[i]]) thick[region[i]] = dist[i];
    const maxWidth = Math.max(1, o.strokeWidth * scale);
    const strokeIds = new Set();
    regions.forEach((r, id) => {
      if (r.void || r.area < 3) return;
      // Black-and-white strokes come from the black areas only.
      if (o.mode === 'bw' && r.label !== 0) return;
      if (2 * thick[id] - 1 > maxWidth * 1.6) return;
      // A region filling most of the image is background, not a line.
      if (r.area > w * h * 0.5) return;
      const c = centerline(region, dist, w, id, r, { maxWidth, tolerance: tol, cornerAngle, lineTolerance });
      if (!c) return;
      strokes.push({ id, hex: r.hex, ...c });
      strokeIds.add(id);
    });
    if (strokeIds.size) {
      // Stroked areas leave the fills: they join their main neighbor so fills stay gap-free underneath.
      const nb = regionNeighbors(region, regions.length, w, h);
      const target = new Int32Array(regions.length).map((_, i) => i);
      for (const id of strokeIds) {
        let best = -1;
        let bl = -1;
        for (const [k, len] of nb[id]) if (!strokeIds.has(k) && len > bl) (best = k), (bl = len);
        target[id] = best;
        regions[id].stroked = true;
      }
      for (let i = 0; i < w * h; i++) {
        const t = target[region[i]];
        if (t !== region[i]) {
          if (t >= 0) region[i] = t;
          // No fill neighbor: the area stays as an undrawn region of its own.
        }
      }
      for (const id of strokeIds) if (target[id] >= 0) regions[target[id]].area += regions[id].area;
      for (const id of strokeIds) if (target[id] >= 0) regions[id].area = 0;
      for (const id of strokeIds) regions[id].void = true;
    }
  }
  progress(0.55);

  const drawn = (id) => id >= 0 && o.fills && !regions[id].void && regions[id].area > 0;
  const shapes = [];
  let anchors = 0;
  if (o.fills) {
    const graph = buildChains(region, w, h);
    const contours = regionContours(graph, regions.length);
    progress(0.65);
    // Image corners must stay sharp.
    const isImageCorner = (x, y) => (x === 0 || x === w) && (y === 0 || y === h);
    const geoms = new Array(graph.chains.length);
    const chains = graph.chains;
    // Staircases of enlarged images are `scale` pixels tall: smooth and look for corners at that size.
    const grid = Math.max(1, scale);
    const smoothing = 1.5 * grid;
    const reach = Math.round(4 * grid);
    const moved = relaxJunctions(chains, w, h, Math.max(2, Math.round(2 * grid)), grid);
    for (let ci = 0; ci < chains.length; ci++) {
      const c = chains[ci];
      if (!drawn(c.left) && !drawn(c.right)) continue;
      let forced = null;
      const n = c.pts.length / 2;
      for (let i = 1; i < n - 1; i++) {
        if (isImageCorner(c.pts[i * 2], c.pts[i * 2 + 1])) (forced ||= new Set()).add(i);
      }
      if (c.closed && isImageCorner(c.pts[0], c.pts[1])) (forced ||= new Set()).add(0);
      let pts = c.pts;
      if (!c.closed) {
        const a = moved.get(c.sy * (w + 1) + c.sx);
        const b = moved.get(c.ey * (w + 1) + c.ex);
        if (a || b) {
          pts = c.pts.slice();
          if (a) (pts[0] = a[0]), (pts[1] = a[1]);
          if (b) (pts[pts.length - 2] = b[0]), (pts[pts.length - 1] = b[1]);
        }
      }
      geoms[ci] = fitChain(pts, c.closed, { tolerance: tol, cornerAngle, lineTolerance, forced, smoothing, reach });
      if (ci % 256 === 0) progress(0.65 + (0.25 * ci) / chains.length);
    }
    // Boundaries that pass straight through a junction stay smooth.
    const ends = [];
    for (let ci = 0; ci < chains.length; ci++) {
      const c = chains[ci];
      if (!geoms[ci] || c.closed) continue;
      ends.push({ key: c.sy * (w + 1) + c.sx, geom: geoms[ci], start: true });
      ends.push({ key: c.ey * (w + 1) + c.ex, geom: geoms[ci], start: false });
    }
    smoothJunctions(ends, Math.min(35, cornerAngle / 2));
    progress(0.9);
    // Paint order: larger boxes first, so enclosed regions draw on top.
    const order = regions.map((_, i) => i).filter(drawn);
    const boxArea = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
    order.sort((a, b) => boxArea(regions[b]) - boxArea(regions[a]) || a - b);
    const nb = o.method === 'overlapping' ? regionNeighbors(region, regions.length, w, h) : null;
    // Overlapping: a hole whose whole interior is drawn (on top) can be filled.
    const coveredHole = (R, cycle) => {
      const seen = new Set([R]);
      const queue = [];
      for (const { chain, forward } of cycle) {
        const other = forward ? chains[chain].right : chains[chain].left;
        if (other === OUTSIDE) return false;
        if (!seen.has(other)) seen.add(other), queue.push(other);
      }
      while (queue.length) {
        const id = queue.pop();
        if (!drawn(id)) return false;
        for (const k of nb[id].keys()) if (!seen.has(k)) seen.add(k), queue.push(k);
      }
      return true;
    };
    for (const id of order) {
      let d = '';
      for (const cycle of contours[id]) {
        if (!cycle.length) continue;
        if (nb && contourArea(graph, cycle) > 0 && coveredHole(id, cycle)) continue;
        let first = true;
        for (const { chain, forward } of cycle) {
          const g = forward ? geoms[chain] : reverseGeometry(geoms[chain]);
          if (first) d += `M${num(g.x0)} ${num(g.y0)}`;
          first = false;
          d += segData(g);
          anchors += g.segs.length;
        }
        d += 'Z';
      }
      if (d) shapes.push({ f: regions[id].hex, d });
    }
  }
  for (const s of strokes) {
    let d = '';
    for (const g of s.paths) {
      d += `M${num(g.x0)} ${num(g.y0)}${segData(g)}${g.closed ? 'Z' : ''}`;
      anchors += g.segs.length + (g.closed ? 0 : 1);
    }
    shapes.push({ s: s.hex, sw: Math.round(s.width * 100) / 100, d });
  }
  progress(1);
  const colors = new Set(shapes.map((s) => s.f || s.s)).size;
  return { w, h, shapes, stats: { paths: shapes.length, anchors, colors } };
}

/** Parse result path data (absolute M/L/C/Z) into subpaths of anchors. */
export function parsePathData(d) {
  const subs = [];
  let cur = null;
  const re = /([MLCZ])([^MLCZ]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const v = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
    if (m[1] === 'M') {
      cur = { anchors: [{ x: v[0], y: v[1], ix: v[0], iy: v[1], ox: v[0], oy: v[1] }], closed: false };
      subs.push(cur);
    } else if (m[1] === 'L' && cur) {
      cur.anchors.push({ x: v[0], y: v[1], ix: v[0], iy: v[1], ox: v[0], oy: v[1] });
    } else if (m[1] === 'C' && cur) {
      const last = cur.anchors[cur.anchors.length - 1];
      last.ox = v[0];
      last.oy = v[1];
      cur.anchors.push({ x: v[4], y: v[5], ix: v[2], iy: v[3], ox: v[4], oy: v[5] });
    } else if (m[1] === 'Z' && cur) {
      cur.closed = true;
      // The closing segment ends on the first anchor: fold it in.
      const a = cur.anchors;
      if (a.length > 1) {
        const first = a[0];
        const last = a[a.length - 1];
        if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
          first.ix = last.ix;
          first.iy = last.iy;
          a.pop();
        }
      }
    }
  }
  return subs;
}

