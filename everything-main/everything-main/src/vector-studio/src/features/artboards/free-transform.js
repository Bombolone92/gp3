/**
 * Free Transform tool (E): a bounding box that moves, scales, rotates and
 * shears the selection, plus the floating widget's modes: Constrain,
 * Free Transform, Perspective Distort and Free Distort. Distortions apply to
 * paths (anchors and handles are mapped projectively or bilinearly); type
 * and images can only be transformed.
 *
 * In Free Transform mode, Cmd-dragging a corner free-distorts and
 * Cmd+Option+Shift-dragging a corner applies perspective; dragging a side
 * handle along its edge shears.
 */
import { h } from '../../lib/dom.js';
import { Tool, fmt } from '../../tools/tool.js';
import { TransformSession } from '../../tools/transform-session.js';
import { hitTest } from '../../render/hit.js';
import { tol } from '../../tools/tool.js';
import { resizeCursorFor } from '../../tools/selection.js';
import { collectOriginals, frameToDoc, docToFrame, frameMatrix } from '../../model/geometry.js';
import { rotate, scale, shear, translate } from '../../lib/matrix.js';
import { icon } from '../../ui/icons.js';
import { projectiveMap, bilinearMap, rectQuad, distortAnchors, perspectiveQuad } from './distort.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNER_INDEX = { nw: 0, ne: 1, se: 2, sw: 3 };
const OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e', nw: 'se', se: 'nw', ne: 'sw', sw: 'ne' };

const MODES = [
  { id: 'free', label: 'Free Transform', icon: 'ft-free' },
  { id: 'perspective', label: 'Perspective Distort', icon: 'ft-perspective' },
  { id: 'distort', label: 'Free Distort', icon: 'ft-distort' },
];

/** Can the selection be distorted (only paths and containers of paths)? */
export function distortable(doc, ids) {
  let ok = true;
  const visit = (n) => {
    if (!n || !ok) return;
    if (n.type === 'text' || n.type === 'image') ok = false;
    for (const c of n.children || []) visit(doc.get(c));
  };
  for (const id of ids) visit(doc.get(id));
  return ok;
}

/**
 * Apply a point map to original nodes (paths and compound children) inside
 * an open transaction. With a turned box `frame`, fn maps frame-space points.
 */
export function applyDistort(doc, originals, fn, frame = null) {
  const map = frame?.angle
    ? (x, y) => {
        const l = docToFrame(frame, x, y);
        const p = fn(l.x, l.y);
        return frameToDoc(frame, p.x, p.y);
      }
    : fn;
  for (const n of originals.values()) {
    if (n.type === 'path') doc.update(n.id, { anchors: distortAnchors(n.anchors, map), shape: undefined });
  }
}

export class FreeTransformTool extends Tool {
  static id = 'free-transform';
  static label = 'Free Transform Tool';
  static shortcut = 'E';
  static icon = 'tool-free-transform';
  static hint = 'Drag a handle to scale | Drag outside a corner to rotate | Drag a side handle along its edge to shear';

  constructor(app) {
    super(app);
    this.mode = 'free';
    this.constrain = false;
    this.drag = null;
    this.widget = null;
  }

  activate() {
    this.setCursor('default');
    this.status();
    this.showWidget(true);
  }

  deactivate() {
    this.cancel();
    this.showWidget(false);
  }

  // ---- widget ----

  showWidget(on) {
    if (!this.widget) this.buildWidget();
    this.widget.hidden = !on || !this.editor;
    if (on) this.refreshWidget();
  }

  buildWidget() {
    const btn = (id, label, ic, onclick) => h('button.icon-btn.ft-btn', { type: 'button', 'aria-label': label, 'data-tip': label, 'data-id': id, tabindex: '-1', onclick }, icon(ic, 18));
    this.constrainBtn = btn('constrain', 'Constrain', 'ft-constrain', () => {
      this.constrain = !this.constrain;
      this.refreshWidget();
    });
    this.modeBtns = MODES.map((m) =>
      btn(m.id, m.label, m.icon, () => {
        if (m.id !== 'free' && this.editor && !distortable(this.editor.doc, this.editor.topSelection())) {
          this.app.notify('Distort works on paths. Type and images can only be transformed.');
          return;
        }
        this.mode = m.id;
        this.refreshWidget();
      }),
    );
    const all = [this.constrainBtn, ...this.modeBtns];
    all[0].tabIndex = 0;
    this.widget = h('div.ft-widget', { role: 'toolbar', 'aria-label': 'Free Transform options', 'aria-orientation': 'vertical' }, this.constrainBtn, h('div.ft-sep', { 'aria-hidden': 'true' }), ...this.modeBtns);
    this.widget.addEventListener('keydown', (e) => {
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const next = all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
        all.forEach((b) => (b.tabIndex = -1));
        next.tabIndex = 0;
        next.focus();
      }
    });
    const host = this.app.canvasWrap?.parentElement || document.body;
    host.append(this.widget);
  }

  refreshWidget() {
    if (!this.widget) return;
    this.constrainBtn.setAttribute('aria-pressed', String(this.constrain));
    this.constrainBtn.disabled = this.mode !== 'free';
    for (const b of this.modeBtns) b.setAttribute('aria-pressed', String(b.dataset.id === this.mode));
  }

  // ---- geometry ----

  /** The selection's box in its frame (turned with rotated objects, see selectionFrame). */
  bounds() {
    const ed = this.editor;
    return ed?.selection.size ? ed.selectionFrame(false) : null;
  }

  /** Screen points of the current box handles; `quad` is in the frame of box `b`. */
  handlePoints(quad, b = this.bounds()) {
    const v = this.editor.view;
    const [nw, ne, se, sw] = quad;
    const mid = (a, c) => ({ x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 });
    const pts = { nw, n: mid(nw, ne), ne, e: mid(ne, se), se, s: mid(se, sw), sw, w: mid(sw, nw) };
    const out = {};
    for (const k of HANDLES) {
      const p = b ? frameToDoc(b, pts[k].x, pts[k].y) : pts[k];
      out[k] = { ...v.toScreen(p.x, p.y), dx: p.x, dy: p.y, fx: pts[k].x, fy: pts[k].y };
    }
    return out;
  }

  partAt(sx, sy) {
    const b = this.bounds();
    if (!b) return null;
    const hp = this.handlePoints(rectQuad(b), b);
    for (const k of HANDLES) if (Math.abs(hp[k].x - sx) <= 6 && Math.abs(hp[k].y - sy) <= 6) return k;
    const mid = frameToDoc(b, b.x + b.w / 2, b.y + b.h / 2);
    const c = this.editor.view.toScreen(mid.x, mid.y);
    for (const k of ['nw', 'ne', 'se', 'sw']) {
      const p = hp[k];
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d > 6 && d < 22 && Math.hypot(sx - c.x, sy - c.y) > Math.hypot(p.x - c.x, p.y - c.y)) return `rotate-${k}`;
    }
    const d = this.editor.view.toDoc(sx, sy);
    const l = docToFrame(b, d.x, d.y);
    if (l.x >= b.x && l.x <= b.x + b.w && l.y >= b.y && l.y <= b.y + b.h) return 'inside';
    return null;
  }

  onHover(e) {
    const part = this.partAt(e.sx, e.sy);
    if (!part) this.setCursor('default');
    else if (part === 'inside') this.setCursor('var(--cursor-move)');
    else if (part.startsWith('rotate')) this.setCursor(this.mode === 'free' ? 'var(--cursor-rotate)' : 'default');
    else this.setCursor(this.mode === 'free' || part.length === 2 ? resizeCursorFor(this.editor, this.bounds(), part) : 'default');
  }

  onPointerDown(e) {
    const ed = this.editor;
    const part = this.partAt(e.sx, e.sy);
    if (!part) {
      // Click to select an object, like the Selection tool.
      const hit = hitTest(ed.doc, e.x, e.y, tol(ed, 3), { outline: ed.viewOptions.mode === 'outline' });
      if (hit) {
        const t = ed.selectionTarget(hit.id);
        ed.select([t.id], { toggle: e.shift });
      } else if (!e.shift) ed.clearSelection();
      return;
    }
    const b = this.bounds();
    const quad = rectQuad(b);
    const isCorner = part in CORNER_INDEX;
    let mode = this.mode;
    if (mode === 'free' && isCorner && e.mod) mode = e.alt && e.shift ? 'perspective' : 'distort';
    if ((mode === 'perspective' || mode === 'distort') && isCorner) {
      if (!distortable(ed.doc, ed.topSelection())) {
        this.app.notify('Distort works on paths. Type and images can only be transformed.');
        return;
      }
      const tx = ed.doc.begin(mode === 'perspective' ? 'Perspective Distort' : 'Free Distort');
      const l = docToFrame(b, e.x, e.y);
      this.drag = { kind: mode, corner: CORNER_INDEX[part], b, q0: quad, quad, x0: l.x, y0: l.y, tx, originals: collectOriginals(ed.doc, ed.topSelection()) };
      return;
    }
    if (mode !== 'free' && part !== 'inside') return;
    if (part === 'inside') {
      this.drag = { kind: 'move', x0: e.x, y0: e.y, b, session: null };
      return;
    }
    if (part.startsWith('rotate')) {
      const c = frameToDoc(b, b.x + b.w / 2, b.y + b.h / 2);
      this.drag = { kind: 'rotate', c, a0: Math.atan2(e.y - c.y, e.x - c.x), session: new TransformSession(ed, 'Rotate') };
      return;
    }
    // Scaling and shearing work in the box's frame, so a turned box keeps its axes.
    const hp = this.handlePoints(quad, b);
    const opp = hp[OPPOSITE[part]];
    const l = docToFrame(b, e.x, e.y);
    this.drag = { kind: 'scale', handle: part, b, x0: l.x, y0: l.y, origin: { x: opp.fx, y: opp.fy }, start: { x: hp[part].fx, y: hp[part].fy }, center: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, session: new TransformSession(ed, 'Scale') };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const ed = this.editor;
    if (d.kind === 'move') {
      let dx = e.x - d.x0;
      let dy = e.y - d.y0;
      if (!d.session) {
        if (Math.hypot(dx, dy) * ed.view.zoom < 3) return;
        d.session = new TransformSession(ed, 'Move');
      }
      if (e.shift || this.constrain) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      d.session.apply(translate(dx, dy));
      ed.feedback = { sx: e.sx, sy: e.sy, text: `dX: ${fmt(ed, dx)}\ndY: ${fmt(ed, dy)}` };
      return;
    }
    if (d.kind === 'rotate') {
      let deg = ((Math.atan2(e.y - d.c.y, e.x - d.c.x) - d.a0) * 180) / Math.PI;
      if (e.shift || this.constrain) deg = Math.round(deg / 45) * 45;
      d.session.apply(rotate(deg, d.c.x, d.c.y));
      ed.feedback = { sx: e.sx, sy: e.sy, text: `${Number(((((-deg % 360) + 540) % 360) - 180).toFixed(1))}°` };
      return;
    }
    if (d.kind === 'scale' && e.mod && d.handle in CORNER_INDEX && this.mode === 'free' && distortable(ed.doc, ed.topSelection())) {
      // Cmd pressed once a corner drag is under way (pressing it first gives the Selection tool):
      // switch to Free Distort, or Perspective with Alt+Shift.
      d.session.cancel();
      const kind = e.alt && e.shift ? 'perspective' : 'distort';
      const quad = rectQuad(d.b);
      this.drag = { kind, corner: CORNER_INDEX[d.handle], b: d.b, q0: quad, quad, x0: d.x0, y0: d.y0, tx: ed.doc.begin(kind === 'perspective' ? 'Perspective Distort' : 'Free Distort'), originals: collectOriginals(ed.doc, ed.topSelection()) };
      this.onPointerMove(e);
      return;
    }
    if (d.kind === 'scale') {
      const { b, handle } = d;
      const side = handle.length === 1;
      const p = docToFrame(b, e.x, e.y);
      const dx = p.x - d.x0;
      const dy = p.y - d.y0;
      const horizontalEdge = handle === 'n' || handle === 's';
      // Side handle dragged along its edge (or with Cmd): shear.
      if (side && (e.mod || (horizontalEdge ? Math.abs(dx) > Math.abs(dy) * 1.5 : Math.abs(dy) > Math.abs(dx) * 1.5) || d.shearing)) {
        d.shearing = true;
        const o = e.alt ? d.center : d.origin;
        if (horizontalEdge) {
          const hgt = d.start.y - o.y || 1e-9;
          const deg = (Math.atan2(dx, hgt) * 180) / Math.PI;
          d.session.apply(frameMatrix(b, shear(deg, 0, o.x, o.y)));
          ed.feedback = { sx: e.sx, sy: e.sy, text: `Shear: ${Number(deg.toFixed(1))}°` };
        } else {
          const w = d.start.x - o.x || 1e-9;
          const deg = (Math.atan2(dy, w) * 180) / Math.PI;
          d.session.apply(frameMatrix(b, shear(0, deg, o.x, o.y)));
          ed.feedback = { sx: e.sx, sy: e.sy, text: `Shear: ${Number(deg.toFixed(1))}°` };
        }
        return;
      }
      const o = e.alt ? d.center : d.origin;
      const fx = handle.includes('e') || handle.includes('w');
      const fy = handle.includes('n') || handle.includes('s');
      let sx = 1;
      let sy = 1;
      const w0 = d.start.x - o.x;
      const h0 = d.start.y - o.y;
      if (fx && Math.abs(w0) > 1e-9) sx = (p.x - o.x) / w0;
      if (fy && Math.abs(h0) > 1e-9) sy = (p.y - o.y) / h0;
      if (e.shift || this.constrain) {
        if (fx && fy) {
          const s = Math.abs(sx) > Math.abs(sy) ? sx : sy;
          sx = Math.sign(sx || 1) * Math.abs(s);
          sy = Math.sign(sy || 1) * Math.abs(s);
        } else if (fx) sy = Math.abs(sx);
        else sx = Math.abs(sy);
      }
      if (Math.abs(sx) < 1e-3) sx = sx < 0 ? -1e-3 : 1e-3;
      if (Math.abs(sy) < 1e-3) sy = sy < 0 ? -1e-3 : 1e-3;
      d.session.apply(frameMatrix(b, scale(sx, sy, o.x, o.y)));
      ed.feedback = { sx: e.sx, sy: e.sy, text: `W: ${fmt(ed, Math.abs(b.w * sx))}\nH: ${fmt(ed, Math.abs(b.h * sy))}` };
      return;
    }
    if (d.kind === 'perspective' || d.kind === 'distort') {
      const l = docToFrame(d.b, e.x, e.y);
      const dx = l.x - d.x0;
      const dy = l.y - d.y0;
      let quad;
      if (d.kind === 'perspective') quad = perspectiveQuad(d.q0, d.corner, dx, dy);
      else {
        quad = d.q0.map((p) => ({ ...p }));
        quad[d.corner] = { x: d.q0[d.corner].x + dx, y: d.q0[d.corner].y + dy };
      }
      d.quad = quad;
      const fn = d.kind === 'perspective' ? projectiveMap(d.b, quad) : bilinearMap(d.b, quad);
      applyDistort(ed.doc, d.originals, fn, d.b);
      this.overlay();
    }
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    const ed = this.editor;
    ed.feedback = null;
    if (!d) return;
    if (d.session) d.session.commit();
    if (d.tx) d.tx.commit();
    this.overlay();
  }

  onKeyDown(ev) {
    if (ev.key === 'Escape' && this.drag) {
      this.cancel();
      return true;
    }
    return false;
  }

  cancel() {
    const d = this.drag;
    this.drag = null;
    d?.session?.cancel();
    d?.tx?.cancel();
    if (this.editor) this.editor.feedback = null;
    this.overlay();
  }

  drawOverlay(ctx, editor, colors) {
    if (!editor.selection.size) return;
    const d = this.drag;
    const b = this.bounds();
    if (!b) return;
    const quad = d?.quad || rectQuad(b);
    const hp = this.handlePoints(quad, d?.b || b);
    ctx.save();
    ctx.strokeStyle = colors.selection;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ['nw', 'ne', 'se', 'sw'].forEach((k, i) => (i ? ctx.lineTo(hp[k].x, hp[k].y) : ctx.moveTo(hp[k].x, hp[k].y)));
    ctx.closePath();
    ctx.stroke();
    const distortMode = this.mode !== 'free';
    for (const k of HANDLES) {
      if (distortMode && k.length === 1) continue;
      const p = hp[k];
      ctx.fillStyle = '#ffffff';
      if (distortMode) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(Math.round(p.x - 3.5) + 0.5, Math.round(p.y - 3.5) + 0.5, 6, 6);
        ctx.strokeRect(Math.round(p.x - 3.5) + 0.5, Math.round(p.y - 3.5) + 0.5, 6, 6);
      }
    }
    // Reference point at the center.
    const mid = frameToDoc(b, b.x + b.w / 2, b.y + b.h / 2);
    const c = editor.view.toScreen(mid.x, mid.y);
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
