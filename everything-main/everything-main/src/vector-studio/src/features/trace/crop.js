/**
 * Object > Crop Image: an on-canvas crop box over the selected image.
 *
 * The crop box is edited in the image's own coordinates (so rotated and
 * skewed images crop along their edges). Drag a handle to resize (Shift
 * keeps the proportions, Alt resizes from the center), drag inside to move,
 * arrow keys nudge (Shift for 10). Enter or Apply crops the image asset;
 * Escape or Cancel leaves it unchanged. A floating bar under the box and
 * the Properties panel show the size and the Apply/Cancel buttons.
 */
import { h } from '../../lib/dom.js';
import { Tool } from '../../tools/tool.js';
import { apply as applyM } from '../../lib/matrix.js';
import { formatLength } from '../../lib/units.js';
import { clampCropRect, cropImage, toLocal, headerSize, effectivePpi, naturalSize } from './image-ops.js';
import { isTrace } from './trace-live.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function handlePoint(r, k) {
  const x = k.includes('w') ? r.x : k.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = k.includes('n') ? r.y : k.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

/** Resize a rect by dragging handle `k` to local point p. */
export function resizeCrop(r0, k, p, { keepRatio = false, fromCenter = false } = {}) {
  let x0 = r0.x;
  let y0 = r0.y;
  let x1 = r0.x + r0.w;
  let y1 = r0.y + r0.h;
  const cx = r0.x + r0.w / 2;
  const cy = r0.y + r0.h / 2;
  if (k.includes('w')) x0 = p.x;
  if (k.includes('e')) x1 = p.x;
  if (k.includes('n')) y0 = p.y;
  if (k.includes('s')) y1 = p.y;
  if (fromCenter) {
    if (k.includes('w')) x1 = 2 * cx - x0;
    if (k.includes('e')) x0 = 2 * cx - x1;
    if (k.includes('n')) y1 = 2 * cy - y0;
    if (k.includes('s')) y0 = 2 * cy - y1;
  }
  let r = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
  if (keepRatio && r0.w > 0 && r0.h > 0 && k.length === 2) {
    const ratio = r0.w / r0.h;
    if (r.w / r.h > ratio) r.h = r.w / ratio;
    else r.w = r.h * ratio;
    if (k.includes('w')) r.x = (fromCenter ? cx + r.w / 2 : x1) - r.w;
    if (k.includes('n')) r.y = (fromCenter ? cy + r.h / 2 : y1) - r.h;
    if (fromCenter) {
      r.x = cx - r.w / 2;
      r.y = cy - r.h / 2;
    }
  }
  return r;
}

/** Initial crop box: the part of the image on the active artboard, else the whole image. */
export function initialCropRect(editor, img) {
  const full = { x: 0, y: 0, w: img.width, h: img.height };
  const a = editor.artboard?.();
  if (!a) return full;
  const pts = [
    [a.x, a.y],
    [a.x + a.w, a.y],
    [a.x, a.y + a.h],
    [a.x + a.w, a.y + a.h],
  ].map(([x, y]) => toLocal(img, x, y));
  const r = {
    x: Math.max(0, Math.min(...pts.map((p) => p.x))),
    y: Math.max(0, Math.min(...pts.map((p) => p.y))),
  };
  r.w = Math.min(img.width, Math.max(...pts.map((p) => p.x))) - r.x;
  r.h = Math.min(img.height, Math.max(...pts.map((p) => p.y))) - r.y;
  if (!(r.w > 1 && r.h > 1) || (r.w >= img.width - 1e-6 && r.h >= img.height - 1e-6)) return full;
  return r;
}

/** The single selected plain image that can be cropped, or null. */
export function croppableImage(editor) {
  if (!editor) return null;
  const top = editor.topSelection();
  if (top.length !== 1) return null;
  const n = editor.doc.get(top[0]);
  if (!n || n.type !== 'image' || n.locked || isTrace(editor.doc.get(n.parent))) return null;
  return n;
}

export class CropImageTool extends Tool {
  static id = 'crop-image';
  static label = 'Crop Image';
  static icon = 'image-crop';
  static hint = 'Drag the crop box or its handles. Shift keeps proportions. Enter applies, Escape cancels.';

  constructor(app) {
    super(app);
    this.session = null;
    this.drag = null;
    this.bar = null;
  }

  activate() {
    const ed = this.editor;
    const img = croppableImage(ed);
    if (!img) {
      queueMicrotask(() => this.app.setTool(this.app.lastSelectionTool || 'selection'));
      return;
    }
    this.session = { doc: ed.doc, imageId: img.id, rect: initialCropRect(ed, img), ppi: null, busy: false };
    this.app.cropSession = this.session;
    this.app.root?.classList.add('cropping');
    this.#showBar();
    this.status();
    this.changed();
  }

  deactivate() {
    this.session = null;
    this.drag = null;
    this.app.cropSession = null;
    this.app.root?.classList.remove('cropping');
    this.bar?.remove();
    this.bar = null;
    this.changed();
  }

  /** The image being cropped (current node). */
  image() {
    const s = this.session;
    return s ? s.doc.get(s.imageId) : null;
  }

  changed() {
    this.overlay();
    this.#positionBar();
    this.app.dock?.update?.();
  }

  setRect(r) {
    const img = this.image();
    if (!img) return;
    this.session.rect = clampCropRect(r, img, Math.min(img.width, img.height) * 0.002 || 0.01);
    this.changed();
  }

  handleAt(sx, sy) {
    const img = this.image();
    if (!img) return null;
    const view = this.editor.view;
    for (const k of HANDLES) {
      const p = handlePoint(this.session.rect, k);
      const d = applyM(img.transform, p.x, p.y);
      const s = view.toScreen(d.x, d.y);
      if (Math.abs(s.x - sx) <= 7 && Math.abs(s.y - sy) <= 7) return k;
    }
    return null;
  }

  inside(x, y) {
    const img = this.image();
    const p = toLocal(img, x, y);
    const r = this.session.rect;
    return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  }

  onHover(e) {
    if (!this.session) return;
    const k = this.handleAt(e.sx, e.sy);
    this.setCursor(k ? CURSORS[k] : this.inside(e.x, e.y) ? 'move' : 'default');
  }

  onPointerDown(e) {
    if (!this.session || this.session.busy) return;
    const k = this.handleAt(e.sx, e.sy);
    const img = this.image();
    if (k) this.drag = { kind: 'resize', k, r0: { ...this.session.rect } };
    else if (this.inside(e.x, e.y)) this.drag = { kind: 'move', p0: toLocal(img, e.x, e.y), r0: { ...this.session.rect } };
    else this.drag = null;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return this.onHover(e);
    const img = this.image();
    const p = toLocal(img, e.x, e.y);
    if (d.kind === 'move') {
      this.setRect({ ...d.r0, x: d.r0.x + p.x - d.p0.x, y: d.r0.y + p.y - d.p0.y });
    } else {
      const r = resizeCrop(d.r0, d.k, { x: Math.max(0, Math.min(img.width, p.x)), y: Math.max(0, Math.min(img.height, p.y)) }, { keepRatio: e.shift, fromCenter: e.alt });
      this.setRect(r);
    }
    d.moved = true;
  }

  onPointerUp() {
    this.drag = null;
  }

  onDoubleClick() {
    this.applyCrop();
  }

  onKeyDown(ev) {
    if (!this.session) return false;
    if (ev.key === 'Enter') {
      this.applyCrop();
      return true;
    }
    if (ev.key === 'Escape') {
      this.cancelCrop();
      return true;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[ev.key];
    if (a && !ev.metaKey && !ev.ctrlKey) {
      const img = this.image();
      // One screen-independent step: a hundredth of the image (Shift: a tenth).
      const step = (Math.max(img.width, img.height) / 100) * (ev.shiftKey ? 10 : 1);
      const r = this.session.rect;
      this.setRect({ ...r, x: r.x + a[0] * step, y: r.y + a[1] * step });
      return true;
    }
    return false;
  }

  cancel() {
    this.drag = null;
  }

  cancelCrop() {
    this.app.setTool(this.app.lastSelectionTool || 'selection');
  }

  async applyCrop() {
    const s = this.session;
    if (!s || s.busy) return;
    s.busy = true;
    try {
      await cropImage(s.doc, s.imageId, s.rect, { ppi: s.ppi });
    } catch (err) {
      this.app.notify(err?.message || 'The image could not be cropped.', { error: true });
      s.busy = false;
      return;
    }
    if (this.session === s) this.app.setTool(this.app.lastSelectionTool || 'selection');
    this.editor?.select([s.imageId]);
  }

  #showBar() {
    const host = this.app.taskbar?.parentElement;
    if (!host) return;
    this.size = h('span.crop-size');
    this.bar = h(
      'div.crop-bar',
      { role: 'toolbar', 'aria-label': 'Crop image' },
      this.size,
      h('button.btn.small', { type: 'button', onclick: () => this.cancelCrop() }, 'Cancel'),
      h('button.btn.small.primary', { type: 'button', onclick: () => this.applyCrop() }, 'Apply'),
    );
    host.append(this.bar);
  }

  #positionBar() {
    const bar = this.bar;
    const img = this.image();
    const ed = this.editor;
    if (!bar || !img || !ed) return;
    const r = this.session.rect;
    const unit = ed.doc.root.units;
    const k = Math.hypot(img.transform[0], img.transform[1]);
    const k2 = Math.hypot(img.transform[2], img.transform[3]);
    const nat = headerSize(ed.doc, img.asset);
    const px = nat ? ` (${Math.round((r.w * nat.width) / img.width)} × ${Math.round((r.h * nat.height) / img.height)} px)` : '';
    this.size.textContent = `${formatLength(r.w * k, unit)} × ${formatLength(r.h * k2, unit)}${px}`;
    const pts = [
      [r.x, r.y],
      [r.x + r.w, r.y],
      [r.x, r.y + r.h],
      [r.x + r.w, r.y + r.h],
    ].map(([x, y]) => {
      const d = applyM(img.transform, x, y);
      return ed.view.toScreen(d.x, d.y);
    });
    const host = this.app.canvasHost?.getBoundingClientRect?.();
    const stack = bar.parentElement?.getBoundingClientRect?.();
    if (!host || !stack) return;
    const cx = (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2 + host.left - stack.left;
    let y = Math.max(...pts.map((p) => p.y)) + host.top - stack.top + 16;
    const bw = bar.offsetWidth || 260;
    const bh = bar.offsetHeight || 36;
    if (y + bh > stack.height - 8) y = Math.min(...pts.map((p) => p.y)) + host.top - stack.top - bh - 16;
    bar.style.left = `${Math.round(Math.max(8, Math.min(stack.width - bw - 8, cx - bw / 2)))}px`;
    bar.style.top = `${Math.round(Math.max(8, Math.min(stack.height - bh - 8, y)))}px`;
  }

  drawOverlay(ctx, editor) {
    const img = this.image();
    if (!img) return;
    const view = editor.view;
    const toS = (x, y) => {
      const d = applyM(img.transform, x, y);
      return view.toScreen(d.x, d.y);
    };
    const quad = (r) => [toS(r.x, r.y), toS(r.x + r.w, r.y), toS(r.x + r.w, r.y + r.h), toS(r.x, r.y + r.h)];
    const r = this.session.rect;
    const outer = quad({ x: 0, y: 0, w: img.width, h: img.height });
    const inner = quad(r);
    ctx.save();
    // Dim what will be cut away.
    ctx.beginPath();
    outer.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    inner.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fill('evenodd');
    // Box: a light and a dark line so it shows on any image.
    const box = () => {
      ctx.beginPath();
      inner.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    };
    ctx.lineWidth = 1;
    box();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    box();
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.setLineDash([]);
    // Thirds while dragging.
    if (this.drag?.moved) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      for (const t of [1 / 3, 2 / 3]) {
        const a = toS(r.x + r.w * t, r.y);
        const b = toS(r.x + r.w * t, r.y + r.h);
        const c = toS(r.x, r.y + r.h * t);
        const d = toS(r.x + r.w, r.y + r.h * t);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
    }
    // Handles.
    for (const k of HANDLES) {
      const p = handlePoint(r, k);
      const s = toS(p.x, p.y);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#1f1f1f';
      ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 8, 8);
      ctx.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7);
    }
    ctx.restore();
  }
}

/** Start cropping the selected image. */
export function startCrop(app) {
  if (!croppableImage(app.editor)) return false;
  app.setTool('crop-image');
  return true;
}

/** Resolution choices for a crop: [{ value, label }] at or below the image's current ppi. */
export async function resolutionChoices(doc, img) {
  const nat = (await naturalSize(doc, img.asset)) || null;
  const cur = effectivePpi(img, nat);
  const out = [{ value: '', label: cur ? `Keep (${Math.round(cur)} ppi)` : 'Keep' }];
  for (const v of [300, 150, 96, 72]) if (cur && v < cur - 0.5) out.push({ value: String(v), label: `${v} ppi` });
  return out;
}
