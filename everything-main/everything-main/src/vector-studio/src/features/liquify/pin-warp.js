/**
 * Pin Warp tool: bend artwork by pins. With artwork selected, the tool
 * places three pins across it; drag a pin to bend the artwork around the
 * others, click to add a pin, Option-click a pin to remove it, Shift-click
 * to select several, and drag the dashed ring around a selected pin to turn
 * the area near it. The artwork is deformed from its state when the session
 * started, so repeated drags never accumulate error. Each drag is one undo
 * step; Enter, Escape (back to the start) or another tool ends the session.
 */
import { Tool } from '../../tools/tool.js';
import { nodeBounds, unionRect } from '../../model/geometry.js';
import { segmentCount, segmentPoints, split, isLine } from '../../model/bezier.js';
import { hitTest } from '../../render/hit.js';
import { controlPoints, rigidMLS, warpAnchors, restPoint } from './pin-warp-math.js';
import { simplifyAnchors } from './liquify-math.js';

const PIN_R = 5; // px
const RING_R = 16; // px

/** Split every segment into pieces no longer than maxLen, so bending stays smooth. */
function subdivide(anchors, closed, maxLen) {
  const n = segmentCount(anchors, closed);
  const out = [];
  let carryIn = null;
  for (let i = 0; i < anchors.length; i++) {
    const a = carryIn ? { ...anchors[i], ix: carryIn.x, iy: carryIn.y } : { ...anchors[i] };
    carryIn = null;
    if (i >= n) {
      out.push(a);
      continue;
    }
    let c = segmentPoints(anchors, i);
    if (isLine(c)) {
      // Give straight pieces handles along the line so they can bend.
      c = [c[0], c[1], c[0] + (c[6] - c[0]) / 3, c[1] + (c[7] - c[1]) / 3, c[0] + ((c[6] - c[0]) * 2) / 3, c[1] + ((c[7] - c[1]) * 2) / 3, c[6], c[7]];
    }
    const len = Math.hypot(c[6] - c[0], c[7] - c[1]) + Math.hypot(c[2] - c[0], c[3] - c[1]) + Math.hypot(c[6] - c[4], c[7] - c[5]);
    const pieces = Math.max(1, Math.min(32, Math.ceil(len / maxLen)));
    let cur = a;
    for (let k = pieces; k > 1; k--) {
      const [left, right] = split(c, 1 / k);
      cur.ox = left[2];
      cur.oy = left[3];
      out.push(cur);
      cur = { x: left[6], y: left[7], ix: left[4], iy: left[5], ox: right[2], oy: right[3] };
      c = right;
    }
    cur.ox = c[2];
    cur.oy = c[3];
    out.push(cur);
    carryIn = { x: c[4], y: c[5] };
  }
  if (carryIn) out[0] = { ...out[0], ix: carryIn.x, iy: carryIn.y };
  return out;
}

/** Path nodes inside the selection (compound children and group members included). */
function selectedPaths(editor) {
  const doc = editor.doc;
  const out = [];
  const add = (n) => {
    if (!n || n.hidden || doc.isLocked(n.id)) return;
    if (n.type === 'path') out.push(n);
    else if (n.children && n.type !== 'layer') for (const c of n.children) add(doc.get(c));
  };
  for (const id of editor.topSelection()) add(doc.get(id));
  return out;
}

export class PinWarpTool extends Tool {
  static id = 'pin-warp';
  static label = 'Pin Warp Tool';
  static icon = 'tool-pin-warp';
  static hint = 'Drag a pin to bend the artwork | Click to add a pin | Option+click a pin to remove it | Drag the ring of a selected pin to turn it | Enter to finish';

  activate() {
    this.setCursor('crosshair');
    this.status();
    this.unsub = [
      this.editor?.on('selection', () => {
        if (!this.dragging && !this.applying) this.endSession();
      }),
      this.editor?.doc.on('change', (ev) => {
        if (ev?.undo) this.endSession();
      }),
    ].filter(Boolean);
    this.startSession();
  }

  deactivate() {
    for (const u of this.unsub || []) if (typeof u === 'function') u();
    this.unsub = null;
    this.endSession();
  }

  /** Begin pinning the selected artwork: snapshot it, subdivide, and place three pins. */
  startSession() {
    const editor = this.editor;
    if (!editor) return;
    const paths = selectedPaths(editor);
    if (!paths.length) {
      this.session = null;
      this.overlay();
      return;
    }
    let bounds = null;
    for (const n of paths) bounds = unionRect(bounds, nodeBounds(editor.doc, n));
    if (!bounds) return;
    const diag = Math.hypot(bounds.w, bounds.h) || 1;
    const originals = new Map();
    for (const n of paths) originals.set(n.id, { node: n, anchors: subdivide(n.anchors, n.closed, diag / 30) });
    const pins = this.autoPins(bounds).map((p) => ({ p, q: { ...p }, angle: 0 }));
    this.session = { originals, bounds, diag, pins, selected: new Set() };
    this.overlay();
  }

  endSession() {
    this.session = null;
    this.drag = null;
    this.overlay();
  }

  /** Three pins spread across the artwork, on filled areas where possible. */
  autoPins(b) {
    const doc = this.editor.doc;
    const ids = new Set(this.session?.originals?.keys?.() || selectedPaths(this.editor).map((n) => n.id));
    const wide = b.w >= b.h;
    const out = [];
    for (const t of [0.15, 0.5, 0.85]) {
      let best = wide ? { x: b.x + b.w * t, y: b.y + b.h / 2 } : { x: b.x + b.w / 2, y: b.y + b.h * t };
      // Prefer a point that hits the artwork: search across the other axis.
      for (const s of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const cand = wide ? { x: b.x + b.w * t, y: b.y + b.h * s } : { x: b.x + b.w * s, y: b.y + b.h * t };
        const hit = hitTest(doc, cand.x, cand.y, 0.5, { filter: (n) => ids.has(n.id) });
        if (hit && ids.has(hit.id)) {
          best = cand;
          break;
        }
      }
      out.push(best);
    }
    return out;
  }

  deformation() {
    const s = this.session;
    return rigidMLS(controlPoints(s.pins, s.diag * 0.08));
  }

  /** Rewrite the artwork from the session originals through the current pins. */
  apply() {
    const s = this.session;
    const doc = this.editor.doc;
    const f = this.deformation();
    this.applying = true;
    try {
      for (const [id, o] of s.originals) if (doc.get(id)) doc.update(id, { anchors: warpAnchors(o.anchors, f), shape: undefined });
    } finally {
      this.applying = false;
    }
  }

  pinAt(e) {
    const s = this.session;
    if (!s) return null;
    const view = this.editor.view;
    const sp = view.toScreen(e.x, e.y);
    for (let i = s.pins.length - 1; i >= 0; i--) {
      const q = view.toScreen(s.pins[i].q.x, s.pins[i].q.y);
      const d = Math.hypot(q.x - sp.x, q.y - sp.y);
      if (d <= PIN_R + 3) return { index: i, part: 'pin' };
      if (s.selected.has(i) && Math.abs(d - RING_R) <= 4) return { index: i, part: 'ring' };
    }
    return null;
  }

  onHover(e) {
    const hit = this.pinAt(e);
    this.setCursor(hit?.part === 'ring' ? 'var(--cursor-rotate, crosshair)' : hit ? 'move' : 'crosshair');
  }

  onPointerDown(e) {
    if (e.button !== 0) return;
    if (!this.session) this.startSession();
    const s = this.session;
    if (!s) {
      // Nothing selected: click artwork to pick it.
      const hit = hitTest(this.editor.doc, e.x, e.y, 3 / this.editor.view.zoom);
      if (hit) {
        this.editor.select([hit.id]);
        this.startSession();
      }
      return;
    }
    const hit = this.pinAt(e);
    if (hit && e.alt && hit.part === 'pin') {
      if (s.pins.length <= 1) return;
      s.pins.splice(hit.index, 1);
      s.selected = new Set();
      this.commitStep('Remove Pin');
      return;
    }
    if (hit) {
      if (e.shift) {
        if (s.selected.has(hit.index)) s.selected.delete(hit.index);
        else s.selected.add(hit.index);
      } else if (!s.selected.has(hit.index)) s.selected = new Set([hit.index]);
      this.drag = {
        part: hit.part,
        index: hit.index,
        start: { x: e.x, y: e.y },
        from: s.pins.map((p) => ({ q: { ...p.q }, angle: p.angle })),
        tx: this.editor.doc.begin(hit.part === 'ring' ? 'Turn Pin' : 'Move Pin'),
      };
      this.dragging = true;
      this.overlay();
      return;
    }
    // Add a pin where the artwork is now.
    const p = restPoint(this.deformation(), e.x, e.y);
    s.pins.push({ p, q: { x: e.x, y: e.y }, angle: 0 });
    s.selected = new Set([s.pins.length - 1]);
    this.overlay();
  }

  onPointerMove(e) {
    const d = this.drag;
    const s = this.session;
    if (!d || !s) return;
    if (d.part === 'ring') {
      const pin = s.pins[d.index];
      const a0 = Math.atan2(d.start.y - pin.q.y, d.start.x - pin.q.x);
      const a1 = Math.atan2(e.y - pin.q.y, e.x - pin.q.x);
      let da = a1 - a0;
      if (e.shift) da = Math.round(da / (Math.PI / 12)) * (Math.PI / 12);
      for (const i of s.selected) s.pins[i].angle = d.from[i].angle + da;
    } else {
      const dx = e.x - d.start.x;
      const dy = e.y - d.start.y;
      for (const i of s.selected) s.pins[i].q = { x: d.from[i].q.x + dx, y: d.from[i].q.y + dy };
    }
    this.apply();
    this.overlay();
  }

  onPointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dragging = false;
    d.tx.commit();
    this.overlay();
  }

  commitStep(label) {
    this.editor.doc.transact(label, () => this.apply());
    this.overlay();
  }

  onKeyDown(ev) {
    const s = this.session;
    if (!s) return false;
    if (ev.key === 'Enter') {
      this.finish();
      return true;
    }
    if (ev.key === 'Escape') {
      this.cancel();
      return true;
    }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && s.selected.size && s.pins.length > s.selected.size) {
      s.pins = s.pins.filter((_, i) => !s.selected.has(i));
      s.selected = new Set();
      this.commitStep('Remove Pin');
      return true;
    }
    return false;
  }

  /** Enter: tidy the extra anchors added for bending and end the session. */
  finish() {
    const s = this.session;
    if (!s) return;
    const doc = this.editor.doc;
    doc.transact('Pin Warp', () => {
      for (const id of s.originals.keys()) {
        const n = doc.get(id);
        if (!n) continue;
        const anchors = simplifyAnchors(n.anchors, n.closed, Math.max(0.05, s.diag / 4000));
        if (anchors !== n.anchors) doc.update(id, { anchors });
      }
    });
    this.endSession();
  }

  /** Escape: put the artwork back as it was before the session. */
  cancel() {
    const s = this.session;
    if (this.drag) {
      this.drag.tx.cancel();
      this.drag = null;
      this.dragging = false;
    }
    if (!s) return;
    const doc = this.editor.doc;
    const changed = [...s.originals.values()].some((o) => doc.get(o.node.id) && doc.get(o.node.id).anchors !== o.node.anchors);
    if (changed) {
      this.applying = true;
      doc.transact('Cancel Pin Warp', () => {
        for (const o of s.originals.values()) if (doc.get(o.node.id)) doc.update(o.node.id, { anchors: o.node.anchors, shape: o.node.shape });
      });
      this.applying = false;
    }
    this.endSession();
  }

  commit() {
    if (this.session) this.finish();
  }

  drawOverlay(ctx, editor) {
    const s = this.session;
    if (!s) return;
    const view = editor.view;
    ctx.save();
    // A light mesh over the artwork shows how it bends.
    const f = this.deformation();
    const b = s.bounds;
    const N = 8;
    ctx.strokeStyle = 'rgba(79, 128, 255, 0.35)';
    ctx.lineWidth = 1;
    for (let k = 0; k <= N; k++) {
      for (const horiz of [true, false]) {
        ctx.beginPath();
        for (let j = 0; j <= 24; j++) {
          const u = horiz ? j / 24 : k / N;
          const v = horiz ? k / N : j / 24;
          const p = f(b.x + b.w * u, b.y + b.h * v);
          const sp = view.toScreen(p.x, p.y);
          if (j) ctx.lineTo(sp.x, sp.y);
          else ctx.moveTo(sp.x, sp.y);
        }
        ctx.stroke();
      }
    }
    s.pins.forEach((pin, i) => {
      const q = view.toScreen(pin.q.x, pin.q.y);
      const sel = s.selected.has(i);
      if (sel) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#4f80ff';
        ctx.beginPath();
        ctx.arc(q.x, q.y, RING_R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // A tick shows how far the pin is turned.
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x + Math.cos(pin.angle) * RING_R, q.y + Math.sin(pin.angle) * RING_R);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(q.x, q.y, PIN_R, 0, Math.PI * 2);
      ctx.fillStyle = sel ? '#4f80ff' : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = sel ? '#ffffff' : '#4f80ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = sel ? '#ffffff' : '#4f80ff';
      ctx.fill();
    });
    ctx.restore();
  }
}
