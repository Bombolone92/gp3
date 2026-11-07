/**
 * Width tool (Shift+W): shape a stroke's width with width points.
 *
 *   hover a stroke        shows its width points and where a new one would go
 *   drag on the stroke    adds a width point there and sets its width
 *   drag a point's end    changes its width (both sides; Alt: one side only)
 *   drag a point's center moves it along the path (Alt: a copy)
 *   click                 selects a width point (Shift adds)
 *   double-click          edits the point's widths numerically
 *   Delete                removes the selected width points
 *
 * Widths are stored relative to the stroke weight (see width-profile.js),
 * so the profile scales with the weight and follows path edits.
 */
import { Tool, tol } from '../../tools/tool.js';
import { hitTest } from '../../render/hit.js';
import { h } from '../../lib/dom.js';
import { formatLength, parseLength } from '../../lib/units.js';
import { buildSpine, spineSampler, nearestOnSpine } from './spine.js';
import { normalizeProfile, profileFunction, insertWidthPoint, isUniformProfile } from './width-profile.js';
import { strokeGeometry } from './live-kinds.js';

const HANDLE_PX = 6;

const spineCache = new WeakMap();

/** Spines of a node's stroked subpaths (cached per node object). */
export function nodeSpines(doc, node) {
  let hit = spineCache.get(node);
  if (!hit) {
    hit = strokeGeometry(doc, node).subpaths.filter((s) => s.anchors.length > 1).map((s) => {
      const spine = buildSpine(s.anchors, s.closed);
      return { spine, at: spineSampler(spine).at };
    });
    spineCache.set(node, hit);
  }
  return hit;
}

/** Profile to edit for a node: its own, or the uniform one. */
export function editableProfile(node) {
  return normalizeProfile(node.widthProfile && !isUniformProfile(node.widthProfile) ? node.widthProfile : null);
}

/** Store a profile on a node (a uniform one is removed). Inside a transaction. */
export function setProfile(doc, id, profile) {
  doc.update(id, { widthProfile: profile && !isUniformProfile(profile) ? profile : undefined });
}

/** Document-space geometry of width point i on subpath k. */
export function widthPointGeometry(node, spines, profile, i, k = 0) {
  const sp = spines[k];
  const p = profile[i];
  const half = (node.strokeWidth || 0) / 2;
  const q = sp.at(p.t * sp.spine.length);
  const nx = q.ty;
  const ny = -q.tx;
  return { x: q.x, y: q.y, nx, ny, left: { x: q.x + nx * p.l * half, y: q.y + ny * p.l * half }, right: { x: q.x - nx * p.r * half, y: q.y - ny * p.r * half } };
}

const isStroked = (n) => n && (n.type === 'path' || n.type === 'compound') && n.stroke && n.strokeWidth > 0;

/**
 * Adjoining points follow a width change: each neighbor scales by half the
 * change, so a bulge spreads instead of making a spike.
 */
export function adjustAdjoining(profile, i, before) {
  const out = profile.map((p) => ({ ...p }));
  const cur = out[i];
  for (const j of [i - 1, i + 1]) {
    const q = out[j];
    if (!q) continue;
    for (const side of ['l', 'r']) {
      if (before[side] > 1e-9) q[side] = Math.max(0, q[side] * (1 + (cur[side] / before[side] - 1) * 0.5));
    }
  }
  return out;
}

export class WidthTool extends Tool {
  static id = 'width';
  static label = 'Width Tool';
  static shortcut = 'Shift+W';
  static icon = 'tool-width';
  static hint = 'Drag a stroke to change its width | Alt-drag changes one side | Drag a point’s center to move it | Double-click a point to edit it';

  constructor(app) {
    super(app);
    this.target = null; // node id under the pointer or being edited
    this.selected = { id: null, points: new Set() };
    this.hoverPart = null;
    this.drag = null;
  }

  activate() {
    this.setCursor('var(--cursor-width, crosshair)');
    this.status();
    this.overlay();
  }

  deactivate() {
    this.cancel();
    this.target = null;
    this.hoverPart = null;
    this.overlay();
  }

  /** What is under the pointer: a width point's end or center, a spot on a stroke, or null. */
  partAt(e) {
    const ed = this.editor;
    const doc = ed.doc;
    const r = tol(ed, HANDLE_PX);
    const ids = [this.selected.id, this.target].filter((id, i, a) => id && a.indexOf(id) === i);
    for (const id of ids) {
      const node = doc.get(id);
      if (!isStroked(node)) continue;
      const spines = nodeSpines(doc, node);
      const prof = editableProfile(node);
      for (let k = 0; k < spines.length; k++) {
        for (let i = prof.length - 1; i >= 0; i--) {
          if (isUniformProfile(node.widthProfile)) break;
          const g = widthPointGeometry(node, spines, prof, i, k);
          if (Math.hypot(e.x - g.left.x, e.y - g.left.y) <= r) return { kind: 'side', side: 'l', id, index: i, sub: k };
          if (Math.hypot(e.x - g.right.x, e.y - g.right.y) <= r) return { kind: 'side', side: 'r', id, index: i, sub: k };
          if (Math.hypot(e.x - g.x, e.y - g.y) <= r) return { kind: 'center', id, index: i, sub: k };
        }
      }
    }
    // A stroke under the pointer: where a new point would go.
    const hit = hitTest(doc, e.x, e.y, tol(ed, 3), { filter: isStroked });
    const node = hit && isStroked(hit) ? hit : hit && isStroked(doc.get(hit.parent)) ? doc.get(hit.parent) : null;
    if (!node) return null;
    const spines = nodeSpines(doc, node);
    let best = null;
    spines.forEach((sp, k) => {
      const n = nearestOnSpine(sp.spine, e.x, e.y);
      if (n && (!best || n.d < best.d)) best = { ...n, sub: k, L: sp.spine.length };
    });
    if (!best || !(best.L > 0)) return null;
    const t = best.s / best.L;
    const w = profileFunction(editableProfile(node))(t);
    const half = node.strokeWidth / 2;
    if (best.d > Math.max(w.l, w.r) * half + tol(ed, 4)) return null;
    return { kind: 'stroke', id: node.id, t, sub: best.sub };
  }

  onHover(e) {
    const part = this.partAt(e);
    this.hoverPart = part;
    this.target = part?.id || (this.selected.id && this.editor.doc.has(this.selected.id) ? this.selected.id : null);
    this.hoverPos = { x: e.x, y: e.y };
    this.setCursor(part?.kind === 'center' ? 'move' : part ? 'var(--cursor-width, crosshair)' : 'var(--cursor-width, crosshair)');
    this.overlay();
  }

  onPointerDown(e) {
    const ed = this.editor;
    const doc = ed.doc;
    const part = this.partAt(e);
    if (!part) {
      this.selected = { id: null, points: new Set() };
      this.overlay();
      return;
    }
    const node = doc.get(part.id);
    if (doc.isLocked(node.id)) return;
    this.target = node.id;
    let profile = editableProfile(node);
    let index = part.index;
    const tx = doc.begin('Width Point');
    if (part.kind === 'stroke') {
      ({ profile, index } = insertWidthPoint(profile, part.t));
      setProfile(doc, node.id, profile);
    } else if (part.kind === 'center' && e.alt) {
      // Alt-drag a point's center: drag out a copy.
      profile = [...profile.slice(0, index + 1), { ...profile[index] }, ...profile.slice(index + 1)];
      index += 1;
      setProfile(doc, node.id, profile);
    }
    if (e.shift && this.selected.id === node.id) this.selected.points.add(index);
    else this.selected = { id: node.id, points: new Set([index]) };
    this.drag = {
      tx,
      id: node.id,
      kind: part.kind === 'center' ? 'move' : 'width',
      side: part.side || null,
      index,
      sub: part.sub || 0,
      start: profile,
      x0: e.x,
      y0: e.y,
      // A click without a drag adds nothing (the new point is rolled back); an Alt-click copy stays.
      moved: part.kind === 'center' && e.alt,
      inserted: part.kind === 'stroke',
    };
    this.overlay();
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.x - d.x0, e.y - d.y0) < tol(this.editor, 2)) return;
    d.moved = true;
    const doc = this.editor.doc;
    const node = doc.get(d.id);
    if (!node) return;
    const spines = nodeSpines(doc, node);
    const sp = spines[d.sub] || spines[0];
    const prof = d.start.map((p) => ({ ...p }));
    const p = prof[d.index];
    if (d.kind === 'move') {
      const n = nearestOnSpine(sp.spine, e.x, e.y);
      if (!n) return;
      // A point moves between its neighbors.
      const lo = d.index > 0 ? prof[d.index - 1].t : 0;
      const hi = d.index < prof.length - 1 ? prof[d.index + 1].t : 1;
      p.t = Math.min(hi, Math.max(lo, n.s / sp.spine.length));
    } else {
      const q = sp.at(p.t * sp.spine.length);
      const half = node.strokeWidth / 2;
      // Signed distance from the path: positive on the left.
      const dist = (e.x - q.x) * q.ty - (e.y - q.y) * q.tx;
      const side = d.side || (dist >= 0 ? 'l' : 'r');
      const value = Math.max(0, (side === 'l' ? dist : -dist) / half);
      if (e.alt) p[side] = value;
      else {
        const other = side === 'l' ? 'r' : 'l';
        const delta = value - d.start[d.index][side];
        p[side] = value;
        p[other] = Math.max(0, d.start[d.index][other] + delta);
      }
    }
    setProfile(doc, d.id, prof);
    this.app.setStatusHint?.(this.describe(node, p));
    this.overlay();
  }

  describe(node, p) {
    const unit = this.editor.doc.root.units || 'pt';
    const half = node.strokeWidth / 2;
    return `Side 1: ${formatLength(p.l * half, unit)}  Side 2: ${formatLength(p.r * half, unit)}  Width: ${formatLength((p.l + p.r) * half, unit)}`;
  }

  onPointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.moved) d.tx.commit();
    else {
      d.tx.cancel();
      if (d.inserted) this.selected = { id: d.id, points: new Set() };
    }
    this.status();
    this.overlay();
  }

  cancel() {
    if (this.drag) {
      this.drag.tx.cancel();
      this.drag = null;
    }
  }

  async onDoubleClick(e) {
    const part = this.partAt(e);
    if (!part) return;
    const doc = this.editor.doc;
    const node = doc.get(part.id);
    if (!node || doc.isLocked(node.id)) return;
    let profile = editableProfile(node);
    let index = part.index;
    let inserted = false;
    if (part.kind === 'stroke') {
      ({ profile, index } = insertWidthPoint(profile, part.t));
      inserted = true;
    }
    this.selected = { id: node.id, points: new Set([index]) };
    await editWidthPointDialog(this.app, node, profile, index, { inserted });
    this.overlay();
  }

  /** Delete the selected width points. Returns true when something was removed. */
  deleteSelected() {
    const { id, points } = this.selected;
    const doc = this.editor?.doc;
    const node = id && doc?.get(id);
    if (!node || !points.size) return false;
    const prof = editableProfile(node).filter((_, i) => !points.has(i));
    doc.transact('Delete Width Point', () => setProfile(doc, id, prof.length ? normalizeProfile(prof) : null));
    this.selected = { id, points: new Set() };
    this.overlay();
    return true;
  }

  hasSelectedPoints() {
    const { id, points } = this.selected;
    return Boolean(id && points.size && this.editor?.doc.has(id) && !isUniformProfile(this.editor.doc.get(id).widthProfile));
  }

  onKeyDown(ev) {
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.hasSelectedPoints()) return this.deleteSelected();
    if (ev.key === 'Escape' && this.selected.points.size) {
      this.selected = { id: null, points: new Set() };
      this.overlay();
      return true;
    }
    return false;
  }

  drawOverlay(ctx, editor) {
    const doc = editor.doc;
    const v = editor.view;
    const ids = [this.target, this.selected.id].filter((id, i, a) => id && a.indexOf(id) === i);
    ctx.save();
    for (const id of ids) {
      const node = doc.get(id);
      if (!isStroked(node)) continue;
      const spines = nodeSpines(doc, node);
      const prof = editableProfile(node);
      const uniform = isUniformProfile(node.widthProfile);
      // The path itself.
      ctx.strokeStyle = 'rgba(61,123,253,0.9)';
      ctx.lineWidth = 1;
      for (const sp of spines) {
        ctx.beginPath();
        sp.spine.segs.forEach((seg) => seg.forEach((p, i) => {
          const s = v.toScreen(p.x, p.y);
          if (i) ctx.lineTo(s.x, s.y);
          else ctx.moveTo(s.x, s.y);
        }));
        ctx.stroke();
      }
      if (uniform) continue;
      for (let k = 0; k < spines.length; k++) {
        prof.forEach((_, i) => {
          const g = widthPointGeometry(node, spines, prof, i, k);
          const sel = this.selected.id === id && this.selected.points.has(i);
          const hot = this.hoverPart && this.hoverPart.id === id && this.hoverPart.index === i;
          drawWidthPoint(ctx, v, g, sel, hot ? this.hoverPart : null);
        });
      }
    }
    // Where a new width point would go.
    const hp = this.hoverPart;
    if (hp?.kind === 'stroke' && !this.drag) {
      const node = doc.get(hp.id);
      if (node) {
        const spines = nodeSpines(doc, node);
        const prof = editableProfile(node);
        const { profile, index } = insertWidthPoint(prof, hp.t);
        const g = widthPointGeometry(node, spines, profile, index, hp.sub);
        ctx.setLineDash([3, 3]);
        drawWidthPoint(ctx, v, g, false, null, true);
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }
}

function drawWidthPoint(ctx, v, g, selected, hot, ghost = false) {
  const c = v.toScreen(g.x, g.y);
  const a = v.toScreen(g.left.x, g.left.y);
  const b = v.toScreen(g.right.x, g.right.y);
  ctx.strokeStyle = ghost ? 'rgba(61,123,253,0.7)' : 'rgba(61,123,253,1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (const [p, side] of [[a, 'l'], [b, 'r']]) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = hot?.kind === 'side' && hot.side === side ? '#3d7bfd' : '#fff';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.strokeRect(-3, -3, 6, 6);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(c.x, c.y, hot?.kind === 'center' ? 5 : 4, 0, Math.PI * 2);
  ctx.fillStyle = selected ? '#3d7bfd' : '#fff';
  ctx.fill();
  ctx.stroke();
}

/**
 * Width Point Edit dialog: side widths, total width, whether adjoining
 * points follow, and Delete. Previews live; one undo step.
 */
export async function editWidthPointDialog(app, node, profile, index, { inserted = false } = {}) {
  const doc = app.editor.doc;
  const unit = doc.root.units || 'pt';
  const half = node.strokeWidth / 2;
  const start = profile[index];
  const tx = doc.begin(inserted ? 'Add Width Point' : 'Width Point');
  const uid = Math.random().toString(36).slice(2, 7);
  const field = (key, label, value) => {
    const input = h('input', { type: 'text', id: `wp-${key}-${uid}`, value: formatLength(value, unit), inputmode: 'decimal', spellcheck: false, autocomplete: 'off' });
    return { input, row: h('div.form-row', h('label', { for: input.id }, label), input) };
  };
  const s1 = field('s1', 'Side 1', start.l * half);
  const s2 = field('s2', 'Side 2', start.r * half);
  const total = field('total', 'Total Width', (start.l + start.r) * half);
  const linkId = `wp-link-${uid}`;
  const link = h('input', { type: 'checkbox', id: linkId, checked: Math.abs(start.l - start.r) < 1e-6 });
  const adjId = `wp-adj-${uid}`;
  const adjust = h('input', { type: 'checkbox', id: adjId });
  const error = h('p.form-error', { role: 'alert' });
  const read = (input) => parseLength(input.value, unit);
  const values = () => {
    const l = read(s1.input);
    const r = read(s2.input);
    return Number.isFinite(l) && Number.isFinite(r) && l >= 0 && r >= 0 ? { l: l / half, r: r / half } : null;
  };
  const apply = () => {
    const w = values();
    if (!w) {
      error.textContent = 'Enter widths of 0 or more.';
      return false;
    }
    error.textContent = '';
    let next = profile.map((p) => ({ ...p }));
    next[index] = { ...next[index], ...w };
    if (adjust.checked) next = adjustAdjoining(next, index, start);
    setProfile(doc, node.id, next);
    return true;
  };
  const onSide = (which) => {
    const a = read(which.input);
    if (!Number.isFinite(a)) return;
    if (link.checked) (which === s1 ? s2 : s1).input.value = formatLength(a, unit);
    const l = read(s1.input);
    const r = read(s2.input);
    if (Number.isFinite(l) && Number.isFinite(r)) total.input.value = formatLength(l + r, unit);
    apply();
  };
  s1.input.addEventListener('change', () => onSide(s1));
  s2.input.addEventListener('change', () => onSide(s2));
  total.input.addEventListener('change', () => {
    const t = read(total.input);
    const l = read(s1.input);
    const r = read(s2.input);
    if (!Number.isFinite(t) || t < 0) return;
    // A new total keeps the sides' proportions.
    const k = l + r > 0 ? t / (l + r) : 0;
    s1.input.value = formatLength(l + r > 0 ? l * k : t / 2, unit);
    s2.input.value = formatLength(l + r > 0 ? r * k : t / 2, unit);
    apply();
  });
  adjust.addEventListener('change', apply);
  const body = h(
    'div.form.width-point-form',
    s1.row,
    s2.row,
    h('div.form-row.check', link, h('label', { for: linkId }, 'Keep sides equal')),
    total.row,
    h('div.form-row.check', adjust, h('label', { for: adjId }, 'Adjust adjoining width points')),
    error,
  );
  if (inserted) apply();
  const result = await app.dialogs.open({
    title: 'Width Point',
    body,
    className: 'width-point-dialog',
    buttons: [
      ...(inserted ? [] : [{ label: 'Delete', value: 'delete', left: true, danger: true }]),
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, value: 'ok', validate: () => apply() },
    ],
  });
  if (result === 'ok') tx.commit();
  else if (result === 'delete') {
    const rest = profile.filter((_, i) => i !== index);
    setProfile(doc, node.id, rest.length ? normalizeProfile(rest) : null);
    tx.commit();
  } else tx.cancel();
  return result;
}
