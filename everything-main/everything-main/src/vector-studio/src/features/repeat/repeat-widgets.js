/**
 * On-canvas controls for a selected repeat (Selection tool):
 *
 *  - Radial: a radius handle on the source, an instance-count slider on the
 *    opposite side of the circle and a span handle on an outer ring.
 *  - Grid: spacing handles on the top and left edges, column and row
 *    handles on the right and bottom edges (dragging adds or removes
 *    whole columns/rows).
 *  - Mirror: axis end handles turn the axis about its middle; the middle
 *    handle moves it.
 *
 * Every drag is one undo step; Escape cancels it.
 */
import { canvasWidgets } from '../../tools/widgets.js';
import { overlayHooks } from '../../render/overlay.js';
import { fmt } from '../../tools/tool.js';
import { apply, translate } from '../../lib/matrix.js';
import { collectOriginals, transformFromOriginals } from '../../model/geometry.js';
import { isRepeat, radialGeometry, gridLayout, MAX_INSTANCES, MAX_GRID } from './repeat-model.js';

const R = 5; // handle radius in CSS pixels
const RING = 18; // span ring distance outside the circle, CSS pixels
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The repeat whose widgets show: the single selected repeat, or the isolated one. */
export function activeRepeat(editor) {
  const doc = editor.doc;
  if (editor.textEdit || editor.dragPreview) return null;
  const top = editor.topSelection();
  if (top.length === 1) {
    const n = doc.get(top[0]);
    if (isRepeat(n) && !doc.isLocked(n.id) && !doc.isHidden(n.id)) return n;
  }
  const iso = editor.isolation && doc.get(editor.isolation);
  return isRepeat(iso) ? iso : null;
}

/** Handles of the active repeat in screen space: [{ id, x, y, kind, ... }]. */
export function repeatHandles(editor) {
  const g = activeRepeat(editor);
  if (!g) return { g: null, handles: [] };
  const { view, doc } = editor;
  const L = g.live;
  const handles = [];
  if (L.mode === 'radial') {
    const geo = radialGeometry(doc, g);
    const c = view.toScreen(L.cx, L.cy);
    const s = view.toScreen(geo.src.x, geo.src.y);
    const rpx = Math.hypot(s.x - c.x, s.y - c.y);
    const a = Math.atan2(s.y - c.y, s.x - c.x);
    const span = clamp(L.span ?? 360, 0, 360);
    const dir = L.ccw ? -1 : 1;
    const ea = a + dir * toRad(span >= 360 ? 360 : span);
    handles.push({ id: 'radius', kind: 'dot', x: s.x, y: s.y, cursor: 'move', tip: 'Drag to change the radius' });
    handles.push({ id: 'count', kind: 'slider', x: c.x - Math.cos(a) * rpx, y: c.y - Math.sin(a) * rpx, angle: a, cursor: 'ew-resize', tip: 'Drag along the circle to add or remove instances' });
    handles.push({ id: 'span', kind: 'diamond', x: c.x + Math.cos(ea) * (rpx + RING), y: c.y + Math.sin(ea) * (rpx + RING), cursor: 'grab', tip: 'Drag around the circle to change the angle the instances span | Shift: 15° steps' });
    return { g, handles, radial: { c, rpx, a, ea, dir, span } };
  }
  if (L.mode === 'grid') {
    const lay = gridLayout(doc, g);
    if (!lay) return { g, handles };
    const { box, F } = lay;
    const P = (x, y) => {
      const d = apply(F, x, y);
      return view.toScreen(d.x, d.y);
    };
    const corners = [P(box.x, box.y), P(box.x + box.w, box.y), P(box.x + box.w, box.y + box.h), P(box.x, box.y + box.h)];
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const top = mid(corners[0], corners[1]);
    const left = mid(corners[0], corners[3]);
    const right = mid(corners[1], corners[2]);
    const bottom = mid(corners[3], corners[2]);
    const ux = Math.atan2(corners[1].y - corners[0].y, corners[1].x - corners[0].x);
    handles.push({ id: 'hspace', kind: 'dot', x: top.x, y: top.y, cursor: 'ew-resize', tip: 'Drag to change the horizontal spacing' });
    handles.push({ id: 'vspace', kind: 'dot', x: left.x, y: left.y, cursor: 'ns-resize', tip: 'Drag to change the vertical spacing' });
    handles.push({ id: 'cols', kind: 'bar', x: right.x, y: right.y, angle: ux + Math.PI / 2, cursor: 'ew-resize', tip: 'Drag to add or remove columns' });
    handles.push({ id: 'rows', kind: 'bar', x: bottom.x, y: bottom.y, angle: ux, cursor: 'ns-resize', tip: 'Drag to add or remove rows' });
    return { g, handles, grid: { corners, lay } };
  }
  if (L.mode === 'mirror') {
    const a = view.toScreen(L.x1, L.y1);
    const b = view.toScreen(L.x2, L.y2);
    handles.push({ id: 'axis-a', kind: 'dot', x: a.x, y: a.y, cursor: 'grab', tip: 'Drag to turn the mirror axis | Shift: 15° steps' });
    handles.push({ id: 'axis-b', kind: 'dot', x: b.x, y: b.y, cursor: 'grab', tip: 'Drag to turn the mirror axis | Shift: 15° steps' });
    handles.push({ id: 'axis-mid', kind: 'diamond', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, cursor: 'move', tip: 'Drag to move the mirror axis | Shift: across the axis only' });
    return { g, handles, mirror: { a, b } };
  }
  return { g, handles };
}

/** Start a drag on a handle: returns { move, end, cancel }. */
function beginDrag(app, g, handle, e0) {
  const editor = app.editor;
  const doc = editor.doc;
  const L0 = g.live;
  const labels = { radius: 'Repeat Radius', count: 'Repeat Instances', span: 'Repeat Span', hspace: 'Repeat Spacing', vspace: 'Repeat Spacing', cols: 'Repeat Columns', rows: 'Repeat Rows', 'axis-a': 'Mirror Axis', 'axis-b': 'Mirror Axis', 'axis-mid': 'Mirror Axis' };
  const tx = doc.begin(labels[handle.id] || 'Repeat');
  const setLive = (patch) => doc.update(g.id, { live: { ...L0, ...patch } });
  const feedback = (e, text) => {
    editor.feedback = { sx: e.sx, sy: e.sy, text };
  };
  let move = () => {};
  if (handle.id === 'radius') {
    const geo = radialGeometry(doc, g);
    const originals = collectOriginals(doc, g.children);
    const ux = geo.radius > 1e-9 ? (geo.src.x - L0.cx) / geo.radius : 0;
    const uy = geo.radius > 1e-9 ? (geo.src.y - L0.cy) / geo.radius : -1;
    move = (e) => {
      const r = Math.max(0, (e.x - L0.cx) * ux + (e.y - L0.cy) * uy);
      transformFromOriginals(doc, originals, translate(ux * (r - geo.radius), uy * (r - geo.radius)));
      feedback(e, `Radius: ${fmt(editor, r)}`);
    };
  } else if (handle.id === 'count') {
    // The circle's tangent at the slider, oriented so dragging right (or down) adds instances.
    let tx0 = Math.sin(handle.angle);
    let ty0 = -Math.cos(handle.angle);
    if (tx0 < -1e-6 || (Math.abs(tx0) <= 1e-6 && ty0 < 0)) {
      tx0 = -tx0;
      ty0 = -ty0;
    }
    move = (e) => {
      const d = (e.sx - e0.sx) * tx0 + (e.sy - e0.sy) * ty0;
      const count = clamp(Math.round((L0.count || 1) + d / 10), 1, MAX_INSTANCES);
      setLive({ count });
      feedback(e, `Instances: ${count}`);
    };
  } else if (handle.id === 'span') {
    const geo = radialGeometry(doc, g);
    const dir = L0.ccw ? -1 : 1;
    move = (e) => {
      const a = toDeg(Math.atan2(e.y - L0.cy, e.x - L0.cx));
      let span = (((a - geo.angle) * dir) % 360 + 360) % 360;
      if (e.shift) span = Math.round(span / 15) * 15;
      if (span < 1 || span > 355) span = 360;
      setLive({ span });
      feedback(e, `Span: ${Number(span.toFixed(1))}°`);
    };
  } else if (handle.id === 'hspace' || handle.id === 'vspace') {
    const lay = gridLayout(doc, g);
    const horiz = handle.id === 'hspace';
    const n = horiz ? lay.cols : lay.rows;
    const key = horiz ? 'hSpacing' : 'vSpacing';
    const base = L0[key] ?? 0;
    const p0 = apply(lay.Fi, e0.x, e0.y);
    const min = -(horiz ? lay.tile.w : lay.tile.h) + 0.5;
    move = (e) => {
      const p = apply(lay.Fi, e.x, e.y);
      const d = horiz ? p.x - p0.x : p.y - p0.y;
      // The handle sits mid-edge: it moves half as far as the far edge.
      const v = Math.max(min, base + (n > 1 ? (2 * d) / (n - 1) : d));
      setLive({ [key]: v });
      feedback(e, `${horiz ? 'Horizontal' : 'Vertical'} spacing: ${fmt(editor, v)}`);
    };
  } else if (handle.id === 'cols' || handle.id === 'rows') {
    const lay = gridLayout(doc, g);
    const horiz = handle.id === 'cols';
    move = (e) => {
      const p = apply(lay.Fi, e.x, e.y);
      const extent = horiz ? p.x - lay.box.x : p.y - lay.box.y;
      const cell = horiz ? lay.cellW : lay.cellH;
      const size = horiz ? lay.tile.w : lay.tile.h;
      const n = clamp(Math.round((extent - size) / cell + 1), 1, MAX_GRID);
      setLive({ [horiz ? 'cols' : 'rows']: n });
      feedback(e, `${horiz ? 'Columns' : 'Rows'}: ${n}`);
    };
  } else if (handle.id === 'axis-a' || handle.id === 'axis-b') {
    const mx = (L0.x1 + L0.x2) / 2;
    const my = (L0.y1 + L0.y2) / 2;
    const half = Math.hypot(L0.x2 - L0.x1, L0.y2 - L0.y1) / 2;
    move = (e) => {
      // Direction from the first end to the second, whichever end is dragged.
      let a = handle.id === 'axis-b' ? Math.atan2(e.y - my, e.x - mx) : Math.atan2(my - e.y, mx - e.x);
      if (e.shift) a = toRad(Math.round(toDeg(a) / 15) * 15);
      const dx = Math.cos(a) * half;
      const dy = Math.sin(a) * half;
      setLive({ x1: mx - dx, y1: my - dy, x2: mx + dx, y2: my + dy });
      const shown = ((-toDeg(a) % 180) + 180) % 180;
      feedback(e, `Axis: ${Number(shown.toFixed(1))}°`);
    };
  } else if (handle.id === 'axis-mid') {
    const len = Math.hypot(L0.x2 - L0.x1, L0.y2 - L0.y1) || 1;
    const nx = -(L0.y2 - L0.y1) / len;
    const ny = (L0.x2 - L0.x1) / len;
    move = (e) => {
      let dx = e.x - e0.x;
      let dy = e.y - e0.y;
      if (e.shift) {
        const d = dx * nx + dy * ny;
        dx = nx * d;
        dy = ny * d;
      }
      setLive({ x1: L0.x1 + dx, y1: L0.y1 + dy, x2: L0.x2 + dx, y2: L0.y2 + dy });
      feedback(e, `dX: ${fmt(editor, dx)}\ndY: ${fmt(editor, dy)}`);
    };
  }
  return {
    move,
    end: () => {
      editor.feedback = null;
      tx.commit();
    },
    cancel: () => {
      editor.feedback = null;
      tx.cancel();
    },
  };
}

function drawWidgets(ctx, editor, colors) {
  if (editor.tool?.id !== 'selection') return;
  const info = repeatHandles(editor);
  if (!info.g) return;
  const accent = colors.selection || '#4f80ff';
  const hover = editor.widgetHover;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = accent;
  if (info.radial) {
    const { c, rpx, a, ea, dir, span } = info.radial;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(c.x, c.y, rpx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // The span ring: a thin arc from the source to the last instance.
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    if (span >= 360) ctx.arc(c.x, c.y, rpx + RING, 0, Math.PI * 2);
    else ctx.arc(c.x, c.y, rpx + RING, a, ea, dir < 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Center mark.
    ctx.beginPath();
    ctx.moveTo(c.x - 4, c.y);
    ctx.lineTo(c.x + 4, c.y);
    ctx.moveTo(c.x, c.y - 4);
    ctx.lineTo(c.x, c.y + 4);
    ctx.stroke();
  }
  if (info.mirror) {
    const { a, b } = info.mirror;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  for (const h of info.handles) drawHandle(ctx, h, accent, hover === `repeat:${h.id}`);
  ctx.restore();
}

function drawHandle(ctx, h, accent, hot) {
  const r = hot ? R + 1.5 : R;
  ctx.save();
  ctx.translate(Math.round(h.x) + 0.5, Math.round(h.y) + 0.5);
  ctx.fillStyle = hot ? accent : '#ffffff';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (h.kind === 'diamond') {
    ctx.moveTo(0, -r - 1);
    ctx.lineTo(r + 1, 0);
    ctx.lineTo(0, r + 1);
    ctx.lineTo(-r - 1, 0);
    ctx.closePath();
  } else if (h.kind === 'bar' || h.kind === 'slider') {
    ctx.rotate(h.kind === 'slider' ? h.angle + Math.PI / 2 : h.angle);
    const w = h.kind === 'slider' ? 22 : 18;
    const ht = 7;
    roundRect(ctx, -w / 2, -ht / 2, w, ht, ht / 2);
  } else ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (h.kind === 'slider') {
    // Grip lines.
    ctx.strokeStyle = hot ? '#ffffff' : accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of [-2.5, 0.5, 3.5]) {
      ctx.moveTo(x - 0.5, -2);
      ctx.lineTo(x - 0.5, 2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
}

export function installRepeatWidgets(app) {
  canvasWidgets.add({
    hit(editor, e) {
      const info = repeatHandles(editor);
      if (!info.g) return null;
      for (let i = info.handles.length - 1; i >= 0; i--) {
        const h = info.handles[i];
        const reach = h.kind === 'bar' || h.kind === 'slider' ? 11 : R + 3;
        if (Math.hypot(e.sx - h.x, e.sy - h.y) <= reach) {
          const g = info.g;
          return { id: `repeat:${h.id}`, cursor: h.cursor, tip: h.tip, begin: (ev) => beginDrag(app, g, h, ev) };
        }
      }
      return null;
    },
  });
  overlayHooks.add(drawWidgets);
}
