/**
 * Character Edit tool (Shift+T): pick one character of a type object and
 * move, scale or rotate it with a small bounding box. The changes are the
 * character's own attributes, so the text stays live type:
 *   move sideways   kerning before the character (the next character's
 *                   kerning compensates, so the rest of the line stays put)
 *   move up/down    baseline shift
 *   corner handles  vertical scale (top left), horizontal scale (bottom
 *                   right), both (top right)
 *   round handle    character rotation
 * Arrow keys nudge (Shift for 10x); Tab and Shift+Tab select the next or
 * previous character; Escape deselects.
 */
import { Tool, tol } from '../../tools/tool.js';
import { hitTest } from '../../render/hit.js';
import { layoutText, glyphPlacements } from '../../model/text-layout.js';
import { applyRunStyle, styleAt } from '../../model/text-runs.js';
import { multiply, apply as applyM, invert } from '../../lib/matrix.js';
import { headOf, threadFrames } from './thread-model.js';

const HANDLE = 7;
const KNOB = 18;

const isBlank = (c) => c === ' ' || c === '\n' || c === '\t' || c === '　' || c === ' ' || c === '­';

/** The frame showing story character i and its placement there, or null. */
export function placementOf(doc, storyId, i) {
  const head = doc.get(storyId);
  if (!head) return null;
  for (const f of threadFrames(doc, head)) {
    const lay = layoutText(f);
    const g = glyphPlacements(lay).find((p) => p.i === i && !p.extra);
    if (g) return { frame: f, lay, g };
  }
  return null;
}

/** Corners of a placement's box in document space: [tl, tr, br, bl] plus the glyph-to-document matrix. */
export function charBox(frame, lay, g) {
  const M = multiply(frame.transform, g.m);
  const top = -lay.chars.asc[g.i] / Math.max(1e-6, Math.hypot(g.m[2], g.m[3]));
  const bottom = lay.chars.desc[g.i] / Math.max(1e-6, Math.hypot(g.m[2], g.m[3]));
  const w = Math.max(g.w, 1e-3);
  const pts = [
    [0, top],
    [w, top],
    [w, bottom],
    [0, bottom],
  ].map(([x, y]) => applyM(M, x, y));
  return { pts, M, w, top, bottom };
}

export class CharEditTool extends Tool {
  static id = 'character-edit';
  static label = 'Character Edit Tool';
  static shortcut = 'Shift+T';
  static icon = 'tool-character-edit';
  static hint = 'Click a character to select it | Drag it to move | Drag a corner to scale, the circle to rotate | Arrows nudge, Tab selects the next character';

  constructor(app) {
    super(app);
    this.target = null; // { id: story id, i }
    this.drag = null;
    this.hover = null;
  }

  activate() {
    this.setCursor('default');
    this.status();
  }

  deactivate() {
    this.cancel();
    this.target = null;
    this.hover = null;
  }

  cancel() {
    if (this.drag?.tx) this.drag.tx.cancel();
    this.drag = null;
    this.overlay();
  }

  current() {
    const ed = this.editor;
    if (!ed || !this.target) return null;
    const p = placementOf(ed.doc, this.target.id, this.target.i);
    if (!p) return null;
    return { ...p, box: charBox(p.frame, p.lay, p.g) };
  }

  /** The character under a document point: { id (story), i, frame }. */
  charAt(e) {
    const ed = this.editor;
    const hit = hitTest(ed.doc, e.x, e.y, tol(ed, 3), { filter: (n) => n.type === 'text' });
    if (!hit || hit.type !== 'text' || ed.doc.isLocked(hit.id)) return null;
    const lay = layoutText(hit);
    const local = applyM(invert(hit.transform), e.x, e.y);
    let best = null;
    let bestD = Infinity;
    for (const g of glyphPlacements(lay)) {
      if (g.extra) continue;
      const inv = invert(g.m);
      const q = applyM(inv, local.x, local.y);
      const top = -lay.chars.asc[g.i] / Math.max(1e-6, Math.hypot(g.m[2], g.m[3]));
      const bottom = lay.chars.desc[g.i] / Math.max(1e-6, Math.hypot(g.m[2], g.m[3]));
      const dx = q.x < 0 ? -q.x : q.x > g.w ? q.x - g.w : 0;
      const dy = q.y < top ? top - q.y : q.y > bottom ? q.y - bottom : 0;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    if (!best || bestD > tol(ed, 4) * 2) return null;
    return { id: headOf(ed.doc, hit).id, i: best.i, frame: hit.id };
  }

  /** What a screen point is over: 'rotate' | 'tl' | 'tr' | 'br' | 'move' | null. */
  partAt(sx, sy) {
    const c = this.current();
    if (!c) return null;
    const view = this.editor.view;
    const s = c.box.pts.map((p) => view.toScreen(p.x, p.y));
    const knob = this.knobPos(s);
    if (Math.hypot(knob.x - sx, knob.y - sy) <= HANDLE) return 'rotate';
    const names = ['tl', 'tr', 'br'];
    for (let k = 0; k < 3; k++) if (Math.abs(s[k].x - sx) <= HANDLE && Math.abs(s[k].y - sy) <= HANDLE) return names[k];
    // Inside the box (screen polygon).
    let inside = false;
    for (let a = 0, b = 3; a < 4; b = a++) {
      if (s[a].y > sy !== s[b].y > sy && sx < ((s[b].x - s[a].x) * (sy - s[a].y)) / (s[b].y - s[a].y) + s[a].x) inside = !inside;
    }
    return inside ? 'move' : null;
  }

  knobPos(s) {
    const mx = (s[0].x + s[1].x) / 2;
    const my = (s[0].y + s[1].y) / 2;
    const bx = (s[3].x + s[2].x) / 2;
    const by = (s[3].y + s[2].y) / 2;
    const l = Math.hypot(mx - bx, my - by) || 1;
    return { x: mx + ((mx - bx) / l) * KNOB, y: my + ((my - by) / l) * KNOB };
  }

  onHover(e) {
    const part = this.partAt(e.sx, e.sy);
    const cursors = { rotate: 'grab', tl: 'ns-resize', tr: 'nesw-resize', br: 'ew-resize', move: 'move' };
    this.setCursor(cursors[part] || 'default');
    const h = part ? null : this.charAt(e);
    const key = h ? `${h.frame}:${h.i}` : '';
    if (key !== (this.hover ? `${this.hover.frame}:${this.hover.i}` : '')) {
      this.hover = h;
      this.overlay();
    }
  }

  onPointerDown(e) {
    const part = this.partAt(e.sx, e.sy);
    const ed = this.editor;
    if (!part) {
      const c = this.charAt(e);
      this.target = c ? { id: c.id, i: c.i } : null;
      if (c) ed.select([c.frame]);
      this.overlay();
      if (!c) return;
    }
    const cur = this.current();
    if (!cur) return;
    const node = ed.doc.get(this.target.id);
    const st = styleAt(node, this.target.i);
    const next = this.target.i + 1 < node.text.length ? styleAt(node, this.target.i + 1) : null;
    const view = ed.view;
    const s = cur.box.pts.map((p) => view.toScreen(p.x, p.y));
    this.drag = {
      part: part || 'move',
      x0: e.x,
      y0: e.y,
      sx0: e.sx,
      sy0: e.sy,
      st,
      next,
      T: cur.frame.transform,
      gm: cur.g.m,
      w: cur.box.w,
      h: cur.box.bottom - cur.box.top,
      center: { x: (s[0].x + s[2].x) / 2, y: (s[0].y + s[2].y) / 2 },
      vertical: cur.lay.vertical,
      tx: ed.doc.begin('Character Edit'),
      moved: false,
    };
  }

  /**
   * Drag delta along the character's own axes, in the text's local units:
   * { du (along its x axis), dv (along its y axis, down), ax, ay (the
   * glyph-to-local scale of each axis) }.
   */
  localDelta(d, e) {
    const inv = invert(d.T);
    const dx = e.x - d.x0;
    const dy = e.y - d.y0;
    const lx = inv[0] * dx + inv[2] * dy;
    const ly = inv[1] * dx + inv[3] * dy;
    const m = d.gm;
    const ax = Math.hypot(m[0], m[1]) || 1;
    const ay = Math.hypot(m[2], m[3]) || 1;
    return { du: (lx * m[0] + ly * m[1]) / ax, dv: (lx * m[2] + ly * m[3]) / ay, ax, ay };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (Math.hypot(e.sx - d.sx0, e.sy - d.sy0) > 2) d.moved = true;
    if (!d.moved) return;
    const { du, dv, ax, ay } = this.localDelta(d, e);
    const st = d.st;
    const size = st.fontSize || 12;
    const patch = {};
    let nextPatch = null;
    if (d.part === 'move') {
      // Along the line: kerning (thousandths of an em); across it: baseline shift.
      const along = d.vertical ? dv : du;
      const across = d.vertical ? du : -dv;
      let kern = Math.round(((st.kerning || 0) + (along / size) * 1000) * 10) / 10;
      if (e.shift) kern = st.kerning || 0;
      patch.kerning = kern;
      patch.baselineShift = Math.round(((st.baselineShift || 0) + (e.shift && Math.abs(along) > Math.abs(across) ? 0 : across)) * 100) / 100;
      if (d.next) nextPatch = { kerning: Math.round(((d.next.kerning || 0) - (kern - (st.kerning || 0))) * 10) / 10 };
    } else if (d.part === 'rotate') {
      const a0 = Math.atan2(d.sy0 - d.center.y, d.sx0 - d.center.x);
      const a1 = Math.atan2(e.sy - d.center.y, e.sx - d.center.x);
      let deg = (st.rotation || 0) - ((a1 - a0) * 180) / Math.PI;
      if (e.shift) deg = Math.round(deg / 15) * 15;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      patch.rotation = Math.round(deg * 100) / 100;
    } else {
      const w = d.w * ax;
      const h = d.h * ay;
      const hs = st.horizontalScale ?? 100;
      const vs = st.verticalScale ?? 100;
      const fx = Math.max(0.01, (w + du) / Math.max(1e-6, w));
      const fy = Math.max(0.01, (h - dv) / Math.max(1e-6, h));
      if (d.part === 'br') patch.horizontalScale = Math.round(hs * fx * 10) / 10;
      else if (d.part === 'tl') patch.verticalScale = Math.round(vs * fy * 10) / 10;
      else {
        const f = e.shift ? Math.max(fx, fy) : (fx + fy) / 2;
        patch.horizontalScale = Math.round(hs * f * 10) / 10;
        patch.verticalScale = Math.round(vs * f * 10) / 10;
      }
      for (const k of ['horizontalScale', 'verticalScale']) if (k in patch) patch[k] = Math.max(1, Math.min(10000, patch[k]));
    }
    this.applyPatch(patch, nextPatch);
  }

  applyPatch(patch, nextPatch = null) {
    const { doc } = this.editor;
    const id = this.target.id;
    const i = this.target.i;
    let node = doc.get(id);
    let runs = applyRunStyle(node, i, i + 1, patch);
    if (nextPatch && i + 1 < node.text.length) {
      node = { ...node, runs };
      runs = applyRunStyle(node, i + 1, i + 2, nextPatch);
    }
    doc.update(id, { runs });
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved) d.tx.commit();
    else d.tx.cancel();
    this.overlay();
  }

  /** Nudge or step through characters from the keyboard. */
  onKeyDown(e) {
    if (!this.target) return false;
    const ed = this.editor;
    const node = ed.doc.get(this.target.id);
    if (!node) return false;
    if (e.key === 'Escape') {
      this.target = null;
      this.overlay();
      return true;
    }
    if (e.key === 'Tab') {
      const dir = e.shiftKey ? -1 : 1;
      let i = this.target.i + dir;
      while (i >= 0 && i < node.text.length && isBlank(node.text[i])) i += dir;
      if (i >= 0 && i < node.text.length) this.target = { ...this.target, i };
      this.overlay();
      return true;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const a = arrows[e.key];
    if (!a || e.metaKey || e.ctrlKey || e.altKey) return false;
    const st = styleAt(node, this.target.i);
    const next = this.target.i + 1 < node.text.length ? styleAt(node, this.target.i + 1) : null;
    const step = e.shiftKey ? 10 : 1;
    const vertical = layoutText(node).vertical;
    const [along, across] = vertical ? [-a[1], a[0]] : a;
    ed.doc.transact(
      'Character Edit',
      () => {
        if (along) {
          const dk = along * step * 10;
          this.applyPatch({ kerning: (st.kerning || 0) + dk }, next ? { kerning: (next.kerning || 0) - dk } : null);
        }
        if (across) this.applyPatch({ baselineShift: (st.baselineShift || 0) + across * step });
      },
      { coalesce: `char-edit-${this.target.id}-${this.target.i}` },
    );
    this.overlay();
    return true;
  }

  drawOverlay(ctx, editor) {
    const view = editor.view;
    if (this.hover && (!this.target || this.hover.id !== this.target.id || this.hover.i !== this.target.i)) {
      const p = placementOf(editor.doc, this.hover.id, this.hover.i);
      if (p) {
        const s = charBox(p.frame, p.lay, p.g).pts.map((q) => view.toScreen(q.x, q.y));
        ctx.save();
        ctx.strokeStyle = 'rgba(79, 128, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        s.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }
    }
    const c = this.current();
    if (!c) return;
    const s = c.box.pts.map((q) => view.toScreen(q.x, q.y));
    ctx.save();
    ctx.strokeStyle = '#4f80ff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    s.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    const knob = this.knobPos(s);
    ctx.beginPath();
    ctx.moveTo((s[0].x + s[1].x) / 2, (s[0].y + s[1].y) / 2);
    ctx.lineTo(knob.x, knob.y);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(knob.x, knob.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const q of [s[0], s[1], s[2]]) {
      ctx.fillRect(Math.round(q.x - 3) + 0.5, Math.round(q.y - 3) + 0.5, 6, 6);
      ctx.strokeRect(Math.round(q.x - 3) + 0.5, Math.round(q.y - 3) + 0.5, 6, 6);
    }
    // The origin on the baseline: a filled dot (move by dragging the character).
    ctx.fillStyle = '#4f80ff';
    const o = view.toScreen(applyM(c.box.M, 0, 0).x, applyM(c.box.M, 0, 0).y);
    ctx.beginPath();
    ctx.arc(o.x, o.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
