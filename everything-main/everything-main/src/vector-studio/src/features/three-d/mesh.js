/**
 * Polygon meshes built from flattened outlines (model space: the outline's
 * plane is z = 0, x right, y down, z toward the viewer).
 *
 * A mesh is { verts: [[x, y, z]], faces, closed } where each face is
 *   { rings: [[vertex index, ...], ...]   one ring, or an outer ring and holes (caps)
 *     part: 'cap' | 'side' | 'bevel' | 'surface'
 *     smooth: bool                         shading may blend with neighbors
 *     twoSided: bool }                     visible from behind (open surfaces)
 * Faces are wound so their Newell normal points out of the solid.
 */
import { dot, normalize, newellNormal } from './math.js';
import { regionsFromRings, insetDirections, insetLimits, distanceToRings, insideRings, delaunay, resampleRing, ringsBounds, area } from './outline.js';

/** Bevel profiles: points [inset, depth] from the cap (0, 0 is not required) to the body, both 0..1. */
export const BEVELS = [
  { id: 'chamfer', label: 'Chamfer', points: [[1, 0], [0, 1]] },
  { id: 'round', label: 'Round', points: arc((a) => [1 - Math.sin(a), 1 - Math.cos(a)]) },
  { id: 'cove', label: 'Cove', points: arc((a) => [Math.cos(a), Math.sin(a)]) },
  { id: 'terrace', label: 'Terrace', points: [[1, 0], [1, 0.34], [0.5, 0.34], [0.5, 0.67], [0, 0.67], [0, 1]] },
  { id: 'ridge', label: 'Ridge', points: [[1, 0], [0.2, 0.45], [0.55, 0.6], [0, 1]] },
  { id: 'ogee', label: 'Ogee', points: arc((a) => [0.5 + 0.5 * Math.cos(a * 2), (1 - Math.cos(a * 2)) / 2 + 0.25 * Math.sin(a * 4)]) },
  { id: 'pillow', label: 'Pillow', points: arc((a) => [1 - Math.sin(a), (1 - Math.cos(a)) * 0.6 + (a / (Math.PI / 2)) * 0.4]) },
];

function arc(fn, n = 8) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const [u, v] = fn((i / n) * (Math.PI / 2));
    out.push([Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))]);
  }
  out[0] = [1, 0];
  out[n] = [0, 1];
  return out;
}

export function bevelProfile(id) {
  return BEVELS.find((b) => b.id === id) || null;
}

/** Orient a face so its normal agrees with `hint` (a vector pointing outward). */
function orient(verts, face, hint) {
  const n = newellNormal(face.rings[0].map((i) => verts[i]));
  if (dot(n, hint) < 0) face.rings = face.rings.map((r) => [...r].reverse());
  return face;
}

/** Face with repeated consecutive vertices removed, or null when it has no area left. */
function cleanFace(verts, ring) {
  const out = [];
  for (const i of ring) {
    const last = out[out.length - 1];
    if (last !== undefined && (last === i || samePoint(verts[last], verts[i]))) continue;
    out.push(i);
  }
  while (out.length > 1 && (out[0] === out[out.length - 1] || samePoint(verts[out[0]], verts[out[out.length - 1]]))) out.pop();
  return out.length >= 3 ? out : null;
}

const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9;

// ---- extrude ----

/**
 * Stations along the depth of an extrusion: { z, inset, s, part } from
 * the front cap (z = depth / 2) to the back cap. `inset` moves the
 * outline inward (bevels; negative moves it outward), s is the fraction
 * along the depth (for twist and taper), part names the band that starts
 * at the station.
 */
export function extrudeStations(opts) {
  const depth = Math.max(0, opts.depth);
  const zf = depth / 2;
  const zb = -depth / 2;
  const prof = opts.bevel && opts.bevel !== 'none' ? bevelProfile(opts.bevel) : null;
  const both = Boolean(prof && opts.bevelBack);
  const bw = prof ? Math.max(0, opts.bevelWidth || 0) : 0;
  let bh = prof ? Math.max(0, opts.bevelHeight || 0) : 0;
  bh = Math.min(bh, both ? depth / 2 : depth);
  const usable = prof && bw > 0 && bh > 0;
  const out = opts.bevelOut ? -1 : 1;
  const insetAt = (u) => (out > 0 ? u * bw : (u - 1) * bw);
  const stations = [];
  const push = (z, inset, part) => stations.push({ z, inset, s: depth > 0 ? (zf - z) / depth : 0, part });
  if (usable) for (const [u, v] of prof.points) push(zf - v * bh, insetAt(u), 'bevel');
  else push(zf, 0, 'side');
  const bodyTop = usable ? zf - bh : zf;
  const bodyBottom = usable && both ? zb + bh : zb;
  // Twisted bodies need intermediate stations to stay smooth.
  const segs = Math.max(1, Math.min(48, Math.ceil(Math.abs(opts.twist || 0) / (opts.draft ? 20 : 8))));
  const bodyInset = usable ? insetAt(0) : 0;
  stations[stations.length - 1].part = 'side';
  for (let k = 1; k <= segs; k++) push(bodyTop + ((bodyBottom - bodyTop) * k) / segs, bodyInset, 'side');
  if (usable && both) {
    stations[stations.length - 1].part = 'bevel';
    const pts = prof.points.slice(0, -1).reverse();
    for (const [u, v] of pts) push(zb + v * bh, insetAt(u), 'bevel');
  }
  // Depth 0 collapses to one station (a flat plate).
  if (depth <= 0) return [stations[0]];
  return stations;
}

/**
 * Extrude flattened outlines (model space). Closed outlines become solids
 * (outer rings with holes, capped unless opts.cap is false); open ones
 * become two-sided ribbons.
 *
 * opts: { depth, cap, twist (degrees over the depth), taper (scale of the
 * back, 1 = none), bevel (profile id or 'none'), bevelWidth, bevelHeight,
 * bevelOut, bevelBack, draft }
 */
export function extrudeMesh(polys, opts) {
  const verts = [];
  const faces = [];
  const stations = extrudeStations(opts);
  const cap = opts.cap !== false;
  const twist = opts.twist || 0;
  const taper = Number.isFinite(opts.taper) ? opts.taper : 1;
  const place = (x, y, st) => {
    const a = (twist * st.s * Math.PI) / 180;
    const k = 1 + (taper - 1) * st.s;
    const c = Math.cos(a) * k;
    const s = Math.sin(a) * k;
    return [x * c - y * s, x * s + y * c, st.z];
  };
  const closedRings = polys.filter((p) => p.closed).map((p) => p.pts);
  const regions = regionsFromRings(closedRings);
  for (const reg of regions) {
    const rings = [reg.outer, ...reg.holes];
    const dirs = rings.map((r) => insetDirections(r));
    const needLimits = stations.some((st) => st.inset > 0);
    const limits = needLimits ? insetLimits(rings, dirs) : null;
    // idx[station][ring][vertex]
    const idx = stations.map((st) =>
      rings.map((r, ri) =>
        r.map((p, i) => {
          let d = st.inset * dirs[ri][i].miter;
          if (d > 0 && limits) d = Math.min(d, limits[ri][i]);
          const q = [p[0] + dirs[ri][i].dir[0] * d, p[1] + dirs[ri][i].dir[1] * d];
          verts.push(place(q[0], q[1], st));
          return verts.length - 1;
        }),
      ),
    );
    const twoSided = !cap;
    for (let k = 0; k < stations.length - 1; k++) {
      const part = stations[k].part;
      rings.forEach((r, ri) => {
        const n = r.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ring = cleanFace(verts, [idx[k][ri][i], idx[k][ri][j], idx[k + 1][ri][j], idx[k + 1][ri][i]]);
          if (!ring) continue;
          // Outward in the plane: left of travel for positive rings (holes are wound the other way).
          const ex = r[j][0] - r[i][0];
          const ey = r[j][1] - r[i][1];
          faces.push(orient(verts, { rings: [ring], part, smooth: true, twoSided }, [ey, -ex, 0]));
        }
      });
    }
    if (cap) {
      const last = stations.length - 1;
      faces.push(orient(verts, { rings: idx[0].map((r) => [...r]), part: 'cap', smooth: false, twoSided: stations.length === 1 }, [0, 0, 1]));
      if (last > 0) faces.push(orient(verts, { rings: idx[last].map((r) => [...r]), part: 'cap', smooth: false, twoSided: false }, [0, 0, -1]));
    }
  }
  for (const p of polys) {
    if (p.closed) continue;
    // Ribbons follow the stations (twist and taper) but not the bevel insets.
    const sts = stations.length > 1 ? stations : [{ z: 0, s: 0 }, { z: 0, s: 0 }];
    const idx = sts.map((st) => p.pts.map((q) => (verts.push(place(q[0], q[1], st)), verts.length - 1)));
    for (let k = 0; k < sts.length - 1; k++) {
      for (let i = 0; i < p.pts.length - 1; i++) {
        const ring = cleanFace(verts, [idx[k][i], idx[k][i + 1], idx[k + 1][i + 1], idx[k + 1][i]]);
        if (!ring) continue;
        const ex = p.pts[i + 1][0] - p.pts[i][0];
        const ey = p.pts[i + 1][1] - p.pts[i][1];
        faces.push(orient(verts, { rings: [ring], part: 'side', smooth: true, twoSided: true }, [ey, -ex, 0]));
      }
    }
  }
  const closed = cap && regions.length > 0 && polys.every((p) => p.closed) && stations.length > 1;
  return { verts, faces, closed };
}

// ---- revolve ----

/**
 * Revolve flattened profiles about the vertical axis x = 0 (model space).
 * Profile x values are distances from the axis. opts: { angle (degrees,
 * 360 = full turn), cap, segments }
 */
export function revolveMesh(polys, opts) {
  const verts = [];
  const faces = [];
  const angle = Math.max(1, Math.min(360, opts.angle ?? 360));
  const full = angle >= 359.999;
  const segs = Math.max(3, Math.round(((opts.segments || 48) * angle) / 360));
  const cols = full ? segs : segs + 1;
  const theta = (j) => (((angle * j) / segs) * Math.PI) / 180;
  const eps = 1e-6;
  const at = (x, y, j) => {
    const t = theta(j);
    return [x * Math.cos(t), y, x * Math.sin(t)];
  };
  const cap = opts.cap !== false;
  let closed = true;
  for (const p of polys) {
    const pts = p.pts.map((q) => [Math.abs(q[0]) < eps ? 0 : q[0], q[1]]);
    const n = pts.length;
    // idx[i][j]: points on the axis share one vertex.
    const idx = pts.map((q) => {
      if (q[0] === 0) {
        verts.push([0, q[1], 0]);
        const v = verts.length - 1;
        return new Array(cols).fill(v);
      }
      const row = [];
      for (let j = 0; j < cols; j++) row.push((verts.push(at(q[0], q[1], j)), verts.length - 1));
      return row;
    });
    const sgn = p.closed ? Math.sign(area(pts)) || 1 : 1;
    const twoSided = !p.closed || (!full && !cap);
    if (twoSided) closed = false;
    const edges = p.closed ? n : n - 1;
    for (let i = 0; i < edges; i++) {
      const i2 = (i + 1) % n;
      // Outward normal of the profile edge in the (r, y) plane.
      const ex = pts[i2][0] - pts[i][0];
      const ey = pts[i2][1] - pts[i][1];
      const nr = ey * sgn;
      const ny = -ex * sgn;
      for (let j = 0; j < segs; j++) {
        const j2 = full ? (j + 1) % segs : j + 1;
        const ring = cleanFace(verts, [idx[i][j], idx[i2][j], idx[i2][j2], idx[i][j2]]);
        if (!ring) continue;
        const tm = (theta(j) + theta(j + 1)) / 2;
        faces.push(orient(verts, { rings: [ring], part: 'surface', smooth: true, twoSided }, [nr * Math.cos(tm), ny, nr * Math.sin(tm)]));
      }
    }
    if (!full && cap && p.closed) {
      // End caps: the profile itself at the start and end angles.
      for (const [col, hint] of [
        [0, [0, 0, -1]],
        [segs, [-Math.sin(theta(segs)), 0, Math.cos(theta(segs))]],
      ]) {
        const ring = cleanFace(verts, idx.map((row) => row[col]));
        if (ring) faces.push(orient(verts, { rings: [ring], part: 'cap', smooth: false, twoSided: false }, hint));
      }
    }
  }
  // Profiles with holes (a ring revolved inside another) still close up.
  return { verts, faces, closed: closed && faces.length > 0 };
}

// ---- inflate ----

/**
 * Puff closed outlines up like a cushion. opts: { depth (flat side wall
 * height), volume (0..1, puff height relative to the shape's half width),
 * bothSides, grid (cells across the larger side) }
 */
export function inflateMesh(polys, opts) {
  const verts = [];
  const faces = [];
  const regions = regionsFromRings(polys.filter((p) => p.closed).map((p) => p.pts));
  const depth = Math.max(0, opts.depth || 0);
  const vol = Math.max(0, opts.volume ?? 0.5);
  const grid = Math.max(6, opts.grid || 28);
  for (const reg of regions) {
    const raw = [reg.outer, ...reg.holes];
    const b = ringsBounds(raw);
    if (!b) continue;
    const step = Math.max(b.w, b.h) / grid;
    const rings = raw.map((r) => resampleRing(r, step));
    const pts = [];
    const ringIdx = rings.map((r) => r.map((p) => (pts.push(p), pts.length - 1)));
    const nb = pts.length;
    const dy = step * 0.866;
    let row = 0;
    for (let y = b.y + dy / 2; y < b.y + b.h; y += dy, row++) {
      for (let x = b.x + (row % 2 ? step / 2 : step / 4); x < b.x + b.w; x += step) {
        if (!insideRings(raw, x, y)) continue;
        if (distanceToRings(raw, x, y) < step * 0.45) continue;
        pts.push([x, y]);
      }
    }
    const tris = delaunay(pts).filter(([a, c, d]) => {
      const cx = (pts[a][0] + pts[c][0] + pts[d][0]) / 3;
      const cy = (pts[a][1] + pts[c][1] + pts[d][1]) / 3;
      return insideRings(raw, cx, cy);
    });
    const dist = pts.map((p, i) => (i < nb ? 0 : distanceToRings(raw, p[0], p[1])));
    const dmax = Math.max(1e-6, ...dist);
    const puff = vol * dmax;
    const height = (d) => {
      const t = Math.min(1, d / dmax);
      return puff * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
    };
    const zf = depth / 2;
    const front = pts.map((p, i) => (verts.push([p[0], p[1], zf + height(dist[i])]), verts.length - 1));
    const back = pts.map((p, i) => {
      // A flat back with no side wall shares the outline with the front.
      if (i < nb && depth === 0) return front[i];
      verts.push([p[0], p[1], -zf - (opts.bothSides ? height(dist[i]) : 0)]);
      return verts.length - 1;
    });
    for (const [a, c, d] of tris) {
      faces.push(orient(verts, { rings: [[front[a], front[c], front[d]]], part: 'surface', smooth: true, twoSided: false }, [0, 0, 1]));
      faces.push(orient(verts, { rings: [[back[a], back[c], back[d]]], part: opts.bothSides ? 'surface' : 'cap', smooth: Boolean(opts.bothSides), twoSided: false }, [0, 0, -1]));
    }
    if (depth > 0) {
      rings.forEach((r, ri) => {
        const n = r.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ring = cleanFace(verts, [front[ringIdx[ri][i]], front[ringIdx[ri][j]], back[ringIdx[ri][j]], back[ringIdx[ri][i]]]);
          if (!ring) continue;
          const ex = r[j][0] - r[i][0];
          const ey = r[j][1] - r[i][1];
          faces.push(orient(verts, { rings: [ring], part: 'side', smooth: true, twoSided: false }, [ey, -ex, 0]));
        }
      });
    }
  }
  return { verts, faces, closed: faces.length > 0 };
}

/** The mesh mirrored left to right (faces rewound so they still face out). */
export function mirrorX(mesh) {
  return {
    ...mesh,
    verts: mesh.verts.map((v) => [-v[0], v[1], v[2]]),
    faces: mesh.faces.map((f) => ({ ...f, rings: f.rings.map((r) => [...r].reverse()) })),
  };
}

/** Bounding radius of a mesh about the origin. */
export function meshRadius(mesh) {
  let r = 0;
  for (const v of mesh.verts) {
    const d = Math.hypot(v[0], v[1], v[2]);
    if (d > r) r = d;
  }
  return r;
}

/** Unit normal of a face (from its first ring). */
export function faceNormal(mesh, face) {
  return normalize(newellNormal(face.rings[0].map((i) => mesh.verts[i])));
}

/**
 * Per-corner normals for smooth faces: the average of the normals of
 * smooth faces sharing the vertex whose normals are within `crease`
 * degrees of this face's. Returns, per face, an array of normals matching
 * its first ring (null for faces that shade flat).
 */
export function cornerNormals(mesh, crease = 40) {
  const normals = mesh.faces.map((f) => faceNormal(mesh, f));
  const around = new Map();
  mesh.faces.forEach((f, fi) => {
    if (!f.smooth) return;
    for (const v of f.rings[0]) {
      let list = around.get(v);
      if (!list) around.set(v, (list = []));
      list.push(fi);
    }
  });
  const cos = Math.cos((crease * Math.PI) / 180);
  return mesh.faces.map((f, fi) => {
    if (!f.smooth) return null;
    const n0 = normals[fi];
    return f.rings[0].map((v) => {
      let s = [0, 0, 0];
      for (const g of around.get(v) || []) {
        const ng = normals[g];
        if (dot(ng, n0) < cos) continue;
        // Weight by the face's area so slivers do not tip the average.
        const w = faceArea(mesh, mesh.faces[g]);
        s = [s[0] + ng[0] * w, s[1] + ng[1] * w, s[2] + ng[2] * w];
      }
      return s[0] || s[1] || s[2] ? normalize(s) : n0;
    });
  });
}

function faceArea(mesh, face) {
  const pts = face.rings[0].map((i) => mesh.verts[i]);
  const n = newellNormal(pts);
  return Math.hypot(n[0], n[1], n[2]) / 2 + 1e-9;
}

