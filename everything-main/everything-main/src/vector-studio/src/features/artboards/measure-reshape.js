/**
 * Measure tool (drag to measure distance and angle; the result shows on
 * the canvas and in the Info panel) and Reshape tool (drag a point on a
 * selected path; nearby anchors follow with a smooth falloff, anchors
 * selected with the tool move fully).
 */
import { Tool, tol, fmt, constrain45 } from '../../tools/tool.js';
import { buildSnapIndex, snapPoint } from '../../tools/snap.js';
import { nearestOnPath, insertAnchor } from '../../model/bezier.js';
import { nodeBounds } from '../../model/geometry.js';

/** Distance, angle (degrees, counterclockwise positive) and deltas of a measurement. */
export function measureValues(m) {
  const dx = m.x2 - m.x1;
  const dy = m.y2 - m.y1;
  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return { dx, dy, d: Math.hypot(dx, dy), angle: Math.abs(angle) < 1e-9 ? 0 : angle };
}

export class MeasureTool extends Tool {
  static id = 'measure';
  static label = 'Measure Tool';
  static icon = 'tool-measure';
  static hint = 'Drag to measure the distance and angle between two points | Shift constrains to 45 degrees';

  constructor(app) {
    super(app);
    this.drag = null;
  }

  activate() {
    this.setCursor('crosshair');
    this.status();
  }

  deactivate() {
    this.drag = null;
    this.app.measure = null;
    this.app.emit('measure', null);
    this.overlay();
  }

  onPointerDown(e) {
    const snap = buildSnapIndex(this.editor);
    const p = snapPoint(this.editor, e.x, e.y, snap);
    this.drag = { snap };
    this.app.measure = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    this.app.emit('measure', this.app.measure);
    this.app.openPanel?.('info');
  }

  onPointerMove(e) {
    if (!this.drag) return;
    const ed = this.editor;
    const m = this.app.measure;
    let p = snapPoint(ed, e.x, e.y, this.drag.snap);
    if (e.shift) p = constrain45(m.x1, m.y1, e.x, e.y);
    m.x2 = p.x;
    m.y2 = p.y;
    const v = measureValues(m);
    ed.feedback = { sx: e.sx, sy: e.sy, text: `D: ${fmt(ed, v.d)}\nAngle: ${Number(v.angle.toFixed(2))}°` };
    this.app.emit('measure', m);
    this.overlay();
  }

  onPointerUp() {
    this.drag = null;
    this.editor.feedback = null;
    this.overlay();
  }

  cancel() {
    this.drag = null;
    if (this.editor) this.editor.feedback = null;
  }

  drawOverlay(ctx, editor, colors) {
    const m = this.app.measure;
    if (!m) return;
    const a = editor.view.toScreen(m.x1, m.y1);
    const b = editor.view.toScreen(m.x2, m.y2);
    ctx.save();
    ctx.strokeStyle = colors.alignment;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y);
      ctx.lineTo(p.x + 5, p.y);
      ctx.moveTo(p.x, p.y - 5);
      ctx.lineTo(p.x, p.y + 5);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Reshape weights: 1 for the dragged anchors, then a cosine falloff with
 * distance (to the nearest dragged anchor) out to `radius`.
 */
export function reshapeWeights(anchors, fixedIdx, radius) {
  const fixed = [...fixedIdx];
  return anchors.map((a, i) => {
    if (fixedIdx.has(i)) return 1;
    let d = Infinity;
    for (const j of fixed) d = Math.min(d, Math.hypot(a.x - anchors[j].x, a.y - anchors[j].y));
    if (d >= radius) return 0;
    return 0.5 + 0.5 * Math.cos((Math.PI * d) / radius);
  });
}

/** Move anchors (with their handles) by (dx, dy) scaled by per-anchor weights. */
export function reshapeAnchors(anchors, weights, dx, dy) {
  return anchors.map((a, i) => {
    const w = weights[i];
    if (!w) return a;
    const mx = dx * w;
    const my = dy * w;
    return { x: a.x + mx, y: a.y + my, ix: a.ix + mx, iy: a.iy + my, ox: a.ox + mx, oy: a.oy + my };
  });
}

export class ReshapeTool extends Tool {
  static id = 'reshape';
  static label = 'Reshape Tool';
  static icon = 'tool-reshape';
  static hint = 'Drag a point on a selected path to reshape it | Shift+Click to select more anchor points | Option widens the falloff';

  constructor(app) {
    super(app);
    this.drag = null;
    this.selectionMode = 'direct';
  }

  activate() {
    this.setCursor('default');
    this.status();
  }

  deactivate() {
    this.cancel();
  }

  /** Nearest point on a selected path: { node, index (anchor), seg, t, onAnchor }. */
  pick(e) {
    const ed = this.editor;
    const t = tol(ed, 5);
    let best = null;
    for (const id of ed.selection) {
      const paths = [];
      const visit = (n) => {
        if (!n) return;
        if (n.type === 'path') paths.push(n);
        else for (const c of n.children || []) visit(ed.doc.get(c));
      };
      visit(ed.doc.get(id));
      for (const n of paths) {
        if (ed.doc.isLocked(n.id)) continue;
        n.anchors.forEach((a, i) => {
          const d = Math.hypot(a.x - e.x, a.y - e.y);
          if (d <= t && (!best || d < best.d)) best = { node: n, index: i, d, onAnchor: true };
        });
        if (best?.onAnchor) continue;
        const near = nearestOnPath(n.anchors, n.closed, e.x, e.y);
        if (near && near.d <= t && (!best || near.d < best.d)) best = { node: n, seg: near.index, t: near.t, d: near.d, onAnchor: false };
      }
    }
    return best;
  }

  onHover(e) {
    this.setCursor(this.pick(e) ? 'var(--cursor-move)' : 'default');
  }

  onPointerDown(e) {
    const ed = this.editor;
    const p = this.pick(e);
    if (!p) return;
    const doc = ed.doc;
    const tx = doc.begin('Reshape');
    let node = p.node;
    let index = p.index;
    if (!p.onAnchor) {
      // Clicking a segment adds an anchor there.
      const anchors = insertAnchor(node.anchors, node.closed, p.seg, p.t);
      node = doc.update(node.id, { anchors, shape: undefined });
      index = p.seg + 1;
      // Anchor indices after the insertion shift by one.
      const prev = ed.anchors.get(node.id);
      if (prev) ed.anchors.set(node.id, new Set([...prev].map((i) => (i > p.seg ? i + 1 : i))));
    }
    const partial = ed.anchors.get(node.id);
    const fixed = new Set(e.shift && partial ? [...partial, index] : [index]);
    if (e.shift) ed.selectAnchors(node.id, [index], { add: true });
    else {
      ed.anchors.set(node.id, new Set([index]));
      ed.emit('selection');
    }
    const b = nodeBounds(doc, node);
    const radius = Math.max(1, Math.hypot(b?.w || 0, b?.h || 0) * (e.alt ? 0.6 : 0.3));
    this.drag = { tx, id: node.id, anchors0: node.anchors, weights: reshapeWeights(node.anchors, fixed, radius), x0: e.x, y0: e.y, moved: false };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const ed = this.editor;
    let dx = e.x - d.x0;
    let dy = e.y - d.y0;
    if (!d.moved && Math.hypot(dx, dy) * ed.view.zoom < 2) return;
    d.moved = true;
    if (e.shift) {
      const c = constrain45(0, 0, dx, dy);
      dx = c.x;
      dy = c.y;
    }
    ed.doc.update(d.id, { anchors: reshapeAnchors(d.anchors0, d.weights, dx, dy), shape: undefined });
    ed.feedback = { sx: e.sx, sy: e.sy, text: `dX: ${fmt(ed, dx)}\ndY: ${fmt(ed, dy)}` };
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (this.editor) this.editor.feedback = null;
    d?.tx.commit();
    this.overlay();
  }

  cancel() {
    const d = this.drag;
    this.drag = null;
    d?.tx.cancel();
    if (this.editor) this.editor.feedback = null;
  }
}
