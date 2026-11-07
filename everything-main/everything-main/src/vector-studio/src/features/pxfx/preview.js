/**
 * A zoomable, pannable preview of objects with effects, for the Effect
 * Gallery and the SVG filter dialog. It renders a document view in which
 * the target objects carry the effect list being edited, so it stays live
 * whether or not the canvas previews.
 *
 * Keyboard: + / - zoom, 0 fits, arrow keys pan. Wheel zooms at the
 * pointer; dragging pans.
 */
import { h } from '../../lib/dom.js';
import { drawNode } from '../../render/draw.js';
import { selectionBounds } from '../../model/geometry.js';
import { onRefine } from './core.js';

const ZOOMS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16];

/** A read-only document view where `overrides` (id -> node) replace stored nodes. */
export function overlayDoc(doc, overrides) {
  return {
    get: (id) => overrides.get(id) || doc.get(id),
    has: (id) => doc.has(id),
    get assets() {
      return doc.assets;
    },
    get root() {
      return doc.root;
    },
    get name() {
      return doc.name;
    },
    get artboards() {
      return doc.artboards;
    },
    get tx() {
      return doc.tx;
    },
    walk: (fn, id, depth) => doc.walk(fn, id, depth),
  };
}

export class EffectPreview {
  /** source() -> { doc, ids } (ids in paint order). */
  constructor({ source, label = 'Preview' }) {
    this.source = source;
    this.zoom = 1;
    this.cx = 0;
    this.cy = 0;
    this.fitted = false;
    this.frame = 0;
    this.canvas = h('canvas.pxp-canvas', { 'aria-hidden': 'true' });
    this.zoomLabel = h('span.pxp-zoom', { 'aria-live': 'polite' }, '100%');
    const btn = (label2, text, fn) => h('button.btn.pxp-btn', { type: 'button', 'aria-label': label2, 'data-tip': label2, onclick: fn }, text);
    this.stage = h('div.pxp-stage', { tabindex: '0', role: 'img', 'aria-label': label }, this.canvas);
    this.el = h(
      'div.pxp',
      this.stage,
      h('div.pxp-bar', btn('Zoom out', '−', () => this.step(-1)), this.zoomLabel, btn('Zoom in', '+', () => this.step(1)), btn('Fit in preview', 'Fit', () => this.fit())),
    );
    this.#wire();
    this.unsubscribe = onRefine(() => this.redraw());
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => (this.fitted ? this.fit() : this.redraw()));
      this.ro.observe(this.stage);
    }
  }

  dispose() {
    this.unsubscribe?.();
    this.ro?.disconnect();
    cancelAnimationFrame(this.frame);
  }

  #wire() {
    let drag = null;
    this.stage.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, cx: this.cx, cy: this.cy };
      this.stage.setPointerCapture?.(e.pointerId);
      this.stage.classList.add('dragging');
    });
    this.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.cx = drag.cx - (e.clientX - drag.x) / this.zoom;
      this.cy = drag.cy - (e.clientY - drag.y) / this.zoom;
      this.fitted = false;
      this.redraw();
    });
    const end = () => {
      drag = null;
      this.stage.classList.remove('dragging');
    };
    this.stage.addEventListener('pointerup', end);
    this.stage.addEventListener('pointercancel', end);
    this.stage.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.stage.getBoundingClientRect();
        const px = e.clientX - r.left - r.width / 2;
        const py = e.clientY - r.top - r.height / 2;
        const before = { x: this.cx + px / this.zoom, y: this.cy + py / this.zoom };
        this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
        this.cx = before.x - px / this.zoom;
        this.cy = before.y - py / this.zoom;
        this.redraw();
      },
      { passive: false },
    );
    this.stage.addEventListener('keydown', (e) => {
      const pan = 40 / this.zoom;
      if (e.key === '+' || e.key === '=') this.step(1);
      else if (e.key === '-' || e.key === '_') this.step(-1);
      else if (e.key === '0') this.fit();
      else if (e.key === 'ArrowLeft') this.cx -= pan;
      else if (e.key === 'ArrowRight') this.cx += pan;
      else if (e.key === 'ArrowUp') this.cy -= pan;
      else if (e.key === 'ArrowDown') this.cy += pan;
      else return;
      e.preventDefault();
      e.stopPropagation();
      this.fitted = false;
      this.redraw();
    });
  }

  setZoom(z) {
    this.zoom = Math.min(32, Math.max(0.02, z));
    this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  step(dir) {
    const next = dir > 0 ? ZOOMS.find((z) => z > this.zoom * 1.001) : [...ZOOMS].reverse().find((z) => z < this.zoom / 1.001);
    this.setZoom(next ?? this.zoom * (dir > 0 ? 2 : 0.5));
    this.fitted = false;
    this.redraw();
  }

  /** Show the objects (with their effects) whole. */
  fit() {
    const { doc, ids } = this.source();
    const b = ids.length ? selectionBounds(doc, ids, true) : null;
    const W = this.stage.clientWidth || 400;
    const H = this.stage.clientHeight || 300;
    if (b && b.w > 0 && b.h > 0) {
      this.setZoom(Math.min(4, (Math.min(W / b.w, H / b.h) || 1) * 0.88));
      this.cx = b.x + b.w / 2;
      this.cy = b.y + b.h / 2;
    }
    this.fitted = true;
    this.redraw();
  }

  redraw() {
    if (this.frame) return;
    const run = () => {
      this.frame = 0;
      this.draw();
    };
    this.frame = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(run) : setTimeout(run, 0);
  }

  draw() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const W = Math.max(1, Math.round((this.stage.clientWidth || 400) * dpr));
    const H = Math.max(1, Math.round((this.stage.clientHeight || 300) * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { doc, ids } = this.source();
    const s = this.zoom * dpr;
    ctx.setTransform(s, 0, 0, s, W / 2 - this.cx * s, H / 2 - this.cy * s);
    const viewRect = { x: this.cx - W / 2 / s, y: this.cy - H / 2 / s, w: W / s, h: H / s };
    for (const id of ids) {
      const n = doc.get(id);
      if (n) drawNode(ctx, doc, n, { viewRect, outline: false, hairline: 1 / this.zoom, scale: s });
    }
  }
}
