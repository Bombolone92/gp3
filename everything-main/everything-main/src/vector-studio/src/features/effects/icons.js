/**
 * Icons for the effects feature. The Warp style icons are drawn by the
 * warp itself: a small banner with a center line, bent by each style.
 */
import { registerIcons } from '../../ui/icons.js';
import { WARP_STYLES, warpSubpaths } from '../../model/warp.js';
import { rectangle } from '../../model/shapes.js';
import { anchor, segmentCount, segmentPoints, isLine } from '../../model/bezier.js';

const r2 = (v) => Math.round(v * 100) / 100;

/** SVG path data for subpaths. */
export function pathData(subs) {
  let d = '';
  for (const s of subs) {
    const a = s.anchors;
    if (!a.length) continue;
    d += `M${r2(a[0].x)} ${r2(a[0].y)}`;
    const n = segmentCount(a, s.closed);
    for (let i = 0; i < n; i++) {
      const c = segmentPoints(a, i);
      d += isLine(c) ? `L${r2(c[6])} ${r2(c[7])}` : `C${r2(c[2])} ${r2(c[3])} ${r2(c[4])} ${r2(c[5])} ${r2(c[6])} ${r2(c[7])}`;
    }
    if (s.closed) d += 'Z';
  }
  return d;
}

/** Path data of a style's icon in a 24x24 box. */
export function warpIconPath(style) {
  const box = { x: 4, y: 8, w: 16, h: 8 };
  const subs = [
    { anchors: rectangle(box.x, box.y, box.w, box.h), closed: true },
    { anchors: [anchor(box.x, box.y + box.h / 2), anchor(box.x + box.w, box.y + box.h / 2)], closed: false },
  ];
  const bent = warpSubpaths(subs, style, { bend: style === 'twist' ? 0.5 : 0.6 }, box, { tolerance: 0.05 });
  // Fit the bent banner back into the icon grid with a 2px margin.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of bent) {
    for (const p of s.anchors) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  }
  const k = Math.min(1, 20 / Math.max(x1 - x0, y1 - y0, 1));
  const ox = 12 - ((x0 + x1) / 2) * k;
  const oy = 12 - ((y0 + y1) / 2) * k;
  const fit = bent.map((s) => ({
    ...s,
    anchors: s.anchors.map((p) => ({ x: p.x * k + ox, y: p.y * k + oy, ix: p.ix * k + ox, iy: p.iy * k + oy, ox: p.ox * k + ox, oy: p.oy * k + oy })),
  }));
  return pathData(fit);
}

let done = false;

export function registerEffectIcons() {
  if (done) return;
  done = true;
  const icons = {};
  for (const s of WARP_STYLES) icons[`warp-${s.id}`] = [['path', { d: warpIconPath(s.id), 'stroke-width': '1.5' }]];
  Object.assign(icons, {
    'fx-seed': [['rect', { x: '4', y: '4', width: '16', height: '16', rx: '3' }], ['circle', { cx: '8.5', cy: '8.5', r: '1.2', fill: 'currentColor', stroke: 'none' }], ['circle', { cx: '12', cy: '12', r: '1.2', fill: 'currentColor', stroke: 'none' }], ['circle', { cx: '15.5', cy: '15.5', r: '1.2', fill: 'currentColor', stroke: 'none' }]],
    'fx-link': [['path', { d: 'M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1' }]],
    'fx-unlink': [['path', { d: 'M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1M4 4l16 16' }]],
  });
  registerIcons(icons);
}
