/**
 * Brush and width-profile previews drawn with the real renderer: a sample
 * stroke painted with the brush into a small canvas, so what the panel
 * shows is exactly what the artwork will look like.
 */
import { h } from '../../lib/dom.js';
import { anchor } from '../../model/bezier.js';
import { drawNode } from '../../render/draw.js';
import { createPath } from '../../model/nodes.js';
import { variableWidthShapes } from './generate.js';
import { tracePath } from '../../render/draw.js';
import { parseCssColor } from '../../lib/color.js';

/** The text color of an element as '#rrggbb' (previews draw in it so they read in both themes). */
export function inkColor(el) {
  const c = typeof getComputedStyle === 'function' && el ? getComputedStyle(el).color : '';
  return parseCssColor(c)?.hex || '#000000';
}

const viewCache = new WeakMap();

/** A small document-like view holding one brush (what generation needs). */
export function brushView(brush) {
  let v = viewCache.get(brush);
  if (!v) {
    v = { get: () => undefined, has: () => false, root: { brushes: [brush] }, assets: new Map(), walk: () => {} };
    viewCache.set(brush, v);
  }
  return v;
}

/** The sample stroke: a gentle S across a w x h box (document units = CSS pixels). */
export function sampleAnchors(w, h, inset = 8) {
  const x0 = inset;
  const x1 = w - inset;
  const cy = h / 2;
  const a = Math.min(h * 0.22, 8);
  const m = (x0 + x1) / 2;
  const k = (x1 - x0) / 6;
  return [anchor(x0, cy + a * 0.6, x0, cy + a * 0.6, x0 + k, cy - a), anchor(m, cy, m - k, cy + a * 1.1, m + k, cy - a * 1.1), anchor(x1, cy - a * 0.6, x1 - k, cy + a, x1, cy - a * 0.6)];
}

/** A sample with outer and inner corners (a raised step), for pattern brushes. */
export function cornerAnchors(w, h, inset = 14) {
  const x0 = inset;
  const x3 = w - inset;
  const lo = h * 0.72;
  const hi = h * 0.28;
  const a = x0 + (x3 - x0) * 0.3;
  const b = x0 + (x3 - x0) * 0.7;
  return [anchor(x0, lo), anchor(a, lo), anchor(a, hi), anchor(b, hi), anchor(b, lo), anchor(x3, lo)];
}

const nodeCache = new WeakMap();

/** A sample path painted with `brush` (cached per brush, size and color so generation is reused). */
function sampleNode(brush, w, h, color, { straight = false, corners = false, anchors = null, extra = {} } = {}) {
  let byKey = nodeCache.get(brush);
  if (!byKey) nodeCache.set(brush, (byKey = new Map()));
  const key = `${w}x${h}|${color}|${straight}|${corners}|${JSON.stringify(extra)}`;
  let n = !anchors && byKey.get(key);
  if (!n) {
    const pts = anchors || (straight ? [anchor(8, h / 2), anchor(w - 8, h / 2)] : corners ? cornerAnchors(w, h) : sampleAnchors(w, h));
    n = createPath(pts, false, { fill: null, stroke: { type: 'solid', color }, strokeWidth: 1, brush: { id: brush.id, seed: 7 }, ...extra }, { id: `thumb-${brush.id}` });
    if (!anchors) byKey.set(key, n);
  }
  return n;
}

/** Fit a brush preview into the canvas: brushes far bigger than the box are scaled down. */
function previewScale(brush, h) {
  let size = 6;
  if (brush.type === 'calligraphic') size = brush.size?.value ?? 3;
  else if (brush.type === 'bristle') size = (brush.size ?? 3) * 1.4;
  else if (brush.type === 'art' && brush.art) size = brush.art.bounds.h * ((brush.width?.value ?? 100) / 100);
  else if (brush.type === 'scatter' && brush.art) size = Math.max(brush.art.bounds.w, brush.art.bounds.h) * (1 + Math.abs(brush.scatter?.max ?? 0) / 50) * ((brush.size?.max ?? 100) / 100);
  else if (brush.type === 'pattern' && brush.tiles?.side?.bounds) size = brush.tiles.side.bounds.h * ((brush.scale?.value ?? 100) / 100);
  const room = h * 0.7;
  return size > room ? room / size : 1;
}

/** Draw a brush preview into a canvas element of w x h CSS pixels. */
export function drawBrushPreview(canvas, brush, { w, h, color = '#000000', straight = false, corners = false, overrides = null } = {}) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const def = overrides ? { ...brush, ...overrides } : brush;
  const k = previewScale(def, h);
  const view = brushView(def);
  const node = sampleNode(def, w / k, h / k, color, { straight, corners });
  ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  ctx.clearRect(0, 0, w / k, h / k);
  try {
    drawNode(ctx, view, node, { scale: dpr * k, hairline: 1 / (dpr * k) });
  } catch (err) {
    console.warn('Brush preview failed', err);
  }
  return canvas;
}

/** A new preview canvas for a brush. */
export function brushThumb(brush, opts) {
  return drawBrushPreview(h('canvas.brush-thumb', { 'aria-hidden': 'true' }), brush, opts);
}

/** A width profile preview: the profile's outline along a straight line, as an SVG path. */
export function profilePreview(points, { w = 96, h = 18, flip = false } = {}) {
  const SVG = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('profile-preview');
  const path = document.createElementNS(SVG, 'path');
  const style = { stroke: { type: 'solid', color: '#000' }, strokeWidth: h * 0.62, strokeCap: 'butt', widthProfile: points };
  let d = '';
  if (points) {
    const [shape] = variableWidthShapes([{ anchors: [anchor(3, h / 2), anchor(w - 3, h / 2)], closed: false }], style);
    const rec = { d: '' };
    const sink = {
      moveTo: (x, y) => (rec.d += `M${x.toFixed(2)} ${y.toFixed(2)}`),
      lineTo: (x, y) => (rec.d += `L${x.toFixed(2)} ${y.toFixed(2)}`),
      bezierCurveTo: (a, b, c, e, x, y) => (rec.d += `C${a.toFixed(2)} ${b.toFixed(2)} ${c.toFixed(2)} ${e.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`),
      closePath: () => (rec.d += 'Z'),
    };
    for (const s of shape?.subpaths || []) tracePath(sink, s.anchors, s.closed);
    d = rec.d;
  } else {
    const t = h * 0.31;
    d = `M3 ${h / 2 - t}H${w - 3}V${h / 2 + t}H3Z`;
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  if (flip) path.setAttribute('transform', `translate(${w} 0) scale(-1 1)`);
  svg.append(path);
  return svg;
}
