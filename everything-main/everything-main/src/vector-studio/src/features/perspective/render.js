/**
 * Perspective overlay: the grid (planes with grid lines fading into the
 * distance, the horizon, vanishing points and the optional height ruler),
 * outlines of selected and hovered objects in perspective, and the grid
 * controls of the Perspective Grid tool. Drawn in CSS pixels.
 */
import { formatLength } from '../../lib/units.js';
import { projectPoint, planePoint, toDoc } from './grid-math.js';
import { gridOf, cameraOf, perspectiveOwner, frameOfObject, isPerspective } from './model.js';
import { projectedOutlines } from './project.js';
import { pstate } from './state.js';
import { gridHandles } from './handles.js';
import { layerColor } from '../../render/overlay.js';

/** Extents (world units) of a plane: [along its first axis, along its second]. */
export function planeExtent(g, plane) {
  if (plane === 'right') return [g.extent.right, g.extent.height];
  if (plane === 'left') return [g.extent.left, g.extent.height];
  return [g.extent.right, g.extent.left];
}

function rgba(hex, a) {
  const n = parseInt(String(hex || '#888888').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** Screen point of a plane point given by world parameters (null behind the viewer). */
function screenOf(view, cam, plane, offset, u, v) {
  const p = projectPoint(cam, planePoint(cam, plane, offset, u, v));
  return p ? view.toScreen(p.x, p.y) : null;
}

/** How close a camera-space point is, relative to the picture plane (1 there, smaller farther away). */
function nearness(cam, plane, offset, u, v) {
  const q = planePoint(cam, plane, offset, u, v);
  return q[2] > 0 ? cam.d / q[2] : 0;
}

const fade = (s) => Math.max(0.12, Math.min(1, (s - 0.06) / 0.55));

function drawPlane(ctx, editor, g, cam, plane, active) {
  const { view } = editor;
  const off = g.planes[plane] || 0;
  const [E1, E2] = planeExtent(g, plane);
  const cell = Math.max(0.5, g.cell);
  const color = g.colors?.[plane] || '#888888';
  const opacity = g.opacity ?? 0.5;
  const corners = [screenOf(view, cam, plane, off, 0, 0), screenOf(view, cam, plane, off, E1, 0), screenOf(view, cam, plane, off, E1, E2), screenOf(view, cam, plane, off, 0, E2)];
  if (corners.some((c) => !c)) return;
  ctx.save();
  if (active) {
    ctx.fillStyle = rgba(color, 0.1 * Math.max(0.4, opacity * 2));
    ctx.beginPath();
    corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
    ctx.closePath();
    ctx.fill();
  }
  ctx.lineWidth = 1;
  // Each family of lines: lines u = k * cell spanning v in [0, E2], and the other way round.
  const family = (along, span, line) => {
    const n = Math.min(2000, Math.ceil(along / cell - 1e-9));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const t = Math.min(along, k * cell);
      const a = line(t, 0);
      const b = line(t, span);
      if (!a || !b) continue;
      const edge = k === 0 || t === along;
      // Lines closer than two pixels blur together: stop drawing the inner ones.
      if (!edge && prev && Math.hypot(a.s.x - prev.x, a.s.y - prev.y) < 2 && Math.hypot(b.s.x - prev.bx, b.s.y - prev.by) < 2) continue;
      prev = { x: a.s.x, y: a.s.y, bx: b.s.x, by: b.s.y };
      const near = Math.max(a.n, b.n);
      ctx.strokeStyle = rgba(color, opacity * fade(near) * (edge ? 1.4 : 1));
      ctx.beginPath();
      ctx.moveTo(Math.round(a.s.x) + 0.5, Math.round(a.s.y) + 0.5);
      ctx.lineTo(Math.round(b.s.x) + 0.5, Math.round(b.s.y) + 0.5);
      ctx.stroke();
    }
  };
  const pt = (u, v) => {
    const s = screenOf(view, cam, plane, off, u, v);
    return s ? { s, n: nearness(cam, plane, off, u, v) } : null;
  };
  family(E1, E2, (t, v) => pt(t, v));
  family(E2, E1, (t, u) => pt(u, t));
  ctx.restore();
}

function drawHorizon(ctx, editor, g, cam) {
  const { view } = editor;
  const r = view.visibleRect(0);
  const a = view.toScreen(r.x, g.horizon);
  const b = view.toScreen(r.x + r.w, g.horizon);
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 130, 150, 0.75)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(a.x, Math.round(a.y) + 0.5);
  ctx.lineTo(b.x, Math.round(b.y) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  // Lines from the planes' far corners to their vanishing points.
  ctx.strokeStyle = 'rgba(120, 130, 150, 0.35)';
  const vps = g.type === 'one' ? [{ x: g.vx, y: g.horizon }] : [{ x: g.vl, y: g.horizon }, { x: g.vr, y: g.horizon }];
  if (g.type === 'three' && g.v3) vps.push(g.v3);
  const O = view.toScreen(g.ox, g.oy);
  for (const v of vps) {
    const s = view.toScreen(v.x, v.y);
    ctx.beginPath();
    ctx.moveTo(O.x, O.y);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRuler(ctx, editor, g, cam) {
  const { view } = editor;
  const units = g.units || editor.doc.root.units || 'pt';
  const scale = g.scale || 1;
  const cell = g.cell;
  const n = Math.floor(g.extent.height / cell + 1e-9);
  const pts = [];
  for (let k = 0; k <= n; k++) pts.push(screenOf(view, cam, 'right', 0, 0, k * cell));
  if (pts.some((p) => !p)) return;
  // Label every k-th line so labels stay apart.
  const gap = pts.length > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 100;
  const every = Math.max(1, Math.ceil(22 / Math.max(1e-6, gap)));
  ctx.save();
  ctx.strokeStyle = 'rgba(60, 60, 70, 0.9)';
  ctx.fillStyle = 'rgba(40, 40, 48, 0.95)';
  ctx.font = '10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  pts.forEach((p, k) => {
    const major = k % every === 0;
    ctx.beginPath();
    ctx.moveTo(p.x - (major ? 8 : 4), Math.round(p.y) + 0.5);
    ctx.lineTo(p.x, Math.round(p.y) + 0.5);
    ctx.stroke();
    if (major) ctx.fillText(formatLength(k * cell * scale, units), p.x - 10, p.y);
  });
  ctx.restore();
}

/** The perspective grid, when shown. */
export function drawGrid(ctx, editor) {
  const st = pstate(editor);
  if (!st.visible) return;
  const g = gridOf(editor.doc);
  const { cam } = cameraOf(g);
  drawHorizon(ctx, editor, g, cam);
  for (const plane of ['floor', 'left', 'right']) drawPlane(ctx, editor, g, cam, plane, st.plane === plane);
  if (st.rulers) drawRuler(ctx, editor, g, cam);
}

function strokeOutlines(ctx, view, outlines) {
  ctx.beginPath();
  for (const { anchors, closed } of outlines) {
    if (!anchors.length) continue;
    const p0 = view.toScreen(anchors[0].x, anchors[0].y);
    ctx.moveTo(p0.x, p0.y);
    const n = closed ? anchors.length : anchors.length - 1;
    for (let i = 0; i < n; i++) {
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      const c1 = view.toScreen(a.ox, a.oy);
      const c2 = view.toScreen(b.ix, b.iy);
      const e = view.toScreen(b.x, b.y);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, e.x, e.y);
    }
    if (closed) ctx.closePath();
  }
  ctx.stroke();
}

/** Anchor positions of an object's flat paths, projected (document coordinates). */
function projectedAnchorPoints(doc, owner) {
  const frame = frameOfObject(doc, owner);
  const out = [];
  const visit = (id) => {
    const n = doc.get(id);
    if (!n || n.hidden) return;
    if (n.type === 'path') for (const a of n.anchors) out.push(toDoc(frame, a.x, a.y));
    for (const c of n.children || []) visit(c);
  };
  for (const c of owner.children) visit(c);
  return out;
}

/** Outlines of selected and hovered objects in perspective. */
export function drawObjectOutlines(ctx, editor) {
  const { doc, view } = editor;
  if (!editor.viewOptions.edges || editor.textEdit) return;
  const seen = new Set();
  ctx.save();
  ctx.lineWidth = 1;
  for (const id of editor.selection) {
    const owner = perspectiveOwner(doc, id);
    if (!owner || seen.has(owner.id) || doc.isHidden(owner.id)) continue;
    seen.add(owner.id);
    const color = layerColor(editor, owner.id);
    ctx.strokeStyle = color;
    strokeOutlines(ctx, view, projectedOutlines(doc, owner));
    ctx.fillStyle = color;
    const pts = projectedAnchorPoints(doc, owner);
    if (pts.length <= 4000) {
      for (const p of pts) {
        const s = view.toScreen(p.x, p.y);
        ctx.fillRect(Math.round(s.x - 2) + 0.5, Math.round(s.y - 2) + 0.5, 4, 4);
      }
    }
  }
  const hover = editor.hover && doc.has(editor.hover) ? perspectiveOwner(doc, editor.hover) : null;
  if (hover && !seen.has(hover.id) && isPerspective(hover)) {
    ctx.strokeStyle = layerColor(editor, hover.id);
    ctx.lineWidth = 1.5;
    strokeOutlines(ctx, view, projectedOutlines(doc, hover));
  }
  ctx.restore();
}

/** Draw the grid controls (Perspective Grid tool). */
export function drawHandles(ctx, editor, { hover = null, active = null, locked = false } = {}) {
  const st = pstate(editor);
  if (!st.visible) return;
  const g = gridOf(editor.doc);
  const { view } = editor;
  const origin = view.toScreen(g.ox, g.oy);
  ctx.save();
  ctx.lineWidth = 1;
  for (const h of gridHandles(g, { reach: 40 / view.zoom })) {
    const s = view.toScreen(h.x, h.y);
    // Controls crowding the ground point are hidden until zoomed in.
    if (h.id === 'cell' && Math.hypot(s.x - origin.x, s.y - origin.y) < 14) continue;
    const hot = h.id === hover || h.id === active;
    const r = hot ? 6 : 5;
    const plane = h.id.startsWith('plane-') ? h.id.slice(6) : null;
    ctx.fillStyle = locked ? '#9a9a9a' : plane ? g.colors?.[plane] || '#888' : hot ? '#2563eb' : '#ffffff';
    ctx.strokeStyle = locked ? '#6a6a6a' : '#2b2b33';
    ctx.beginPath();
    if (h.kind === 'vp' || h.kind === 'origin') {
      ctx.moveTo(s.x, s.y - r - 1);
      ctx.lineTo(s.x + r + 1, s.y);
      ctx.lineTo(s.x, s.y + r + 1);
      ctx.lineTo(s.x - r - 1, s.y);
      ctx.closePath();
    } else if (h.kind === 'extent' || h.kind === 'cell') ctx.rect(Math.round(s.x - r + 1) + 0.5, Math.round(s.y - r + 1) + 0.5, 2 * r - 2, 2 * r - 2);
    else ctx.arc(s.x, s.y, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** The control under a screen point (within `radius` CSS pixels), or null. */
export function handleAt(editor, sx, sy, radius = 8) {
  const g = gridOf(editor.doc);
  const { view } = editor;
  let best = null;
  let bestD = radius;
  const origin = view.toScreen(g.ox, g.oy);
  for (const h of gridHandles(g, { reach: 40 / view.zoom })) {
    const s = view.toScreen(h.x, h.y);
    if (h.id === 'cell' && Math.hypot(s.x - origin.x, s.y - origin.y) < 14) continue;
    const d = Math.hypot(s.x - sx, s.y - sy);
    // Ties go to the later control: plane controls win over the ground point under them.
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}
