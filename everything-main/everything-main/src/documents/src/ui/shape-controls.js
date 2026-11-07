import { el } from './dom.js';
import { openMenu, closeMenu } from './menu.js';
import { SHAPE_PRESETS, buildShape, EMU_PER_INCH } from '../engine/authored-shapes.js';

/** A preset's outline drawn into a small canvas from the same geometry the document uses. */
export function drawShapeThumbnail(canvas, preset, { size = 22 } = {}) {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.height = Math.round(size * ratio);
  canvas.style.width = canvas.style.height = `${size}px`;
  // A browser may refuse another 2D context (canvas memory limits); leave the thumbnail blank.
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const entry = SHAPE_PRESETS.find(([p]) => p === preset);
  let scene;
  try { scene = buildShape({ id: 1, name: 'thumb', preset, width: Math.round(entry[3] * EMU_PER_INCH), height: Math.round(entry[4] * EMU_PER_INCH), fill: 'D9E3F0', line: '44546A', lineWidth: 12700, assetId: 'thumb' }).asset.scene; }
  catch { return; }
  const w = scene.width || 1, h = scene.height || 1, scale = (size - 4) / Math.max(w, h || w), ox = (size - w * scale) / 2, oy = (size - (h || 0) * scale) / 2;
  ctx.lineWidth = 1.25; ctx.strokeStyle = '#44546A'; ctx.fillStyle = '#D9E3F0'; ctx.lineJoin = 'round';
  let from = null, to = null; // the last segment drawn, for a line's arrowhead
  // A line has no fill to stand on, so it takes the theme's line colour to show on a dark menu too.
  if (!scene.height) ctx.strokeStyle = getComputedStyle(canvas.isConnected ? canvas : document.documentElement).getPropertyValue('--ed-shape-line').trim() || '#44546A';
  for (const path of scene.paths || []) {
    // Each path has its own coordinate space, stretched over the shape's frame.
    const px = w / (path.width || w) * scale, py = (h || 0) / (path.height || h || 1) * scale;
    ctx.beginPath();
    for (const [op, ...args] of path.points) {
      const p = args.map((v, i) => i % 2 ? oy + v * py : ox + v * px);
      if (op === 'E') ctx.ellipse(ox + w * scale / 2, oy + h * scale / 2, w * scale / 2, h * scale / 2, 0, 0, Math.PI * 2);
      else if (op === 'M') { ctx.moveTo(p[0], p[1]); to = p; }
      else if (op === 'L') { ctx.lineTo(p[0], p[1]); from = to; to = p; }
      else if (op === 'C') ctx.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
      else if (op === 'Q') ctx.quadraticCurveTo(p[0], p[1], p[2], p[3]);
      else if (op === 'Z') ctx.closePath();
    }
    if (path.fill !== false && h) ctx.fill();
    if (path.stroke !== false) ctx.stroke();
  }
  // A line's arrowhead is part of its outline, not its paths: draw it at the line's end.
  if (scene.outline?.tailEnd && from && to) {
    const angle = Math.atan2(to[1] - from[1], to[0] - from[0]), length = 6, spread = 0.45;
    ctx.beginPath();
    ctx.moveTo(to[0], to[1]);
    ctx.lineTo(to[0] - length * Math.cos(angle - spread), to[1] - length * Math.sin(angle - spread));
    ctx.lineTo(to[0] - length * Math.cos(angle + spread), to[1] - length * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }
}

/** Insert → Shapes: every preset, grouped by category, as thumbnails. */
export function openShapeGallery({ anchor, onPick, onClose, pointer = false }) {
  const groups = [...new Set(SHAPE_PRESETS.map(([, , group]) => group))];
  const items = groups.flatMap(group => [{ header: group }, { custom: el('div.menu-custom-grid.shape-gallery', { role: 'group', 'aria-label': group },
    ...SHAPE_PRESETS.filter(([, , g]) => g === group).map(([preset, name]) => {
      const canvas = el('canvas', { 'aria-hidden': 'true' });
      drawShapeThumbnail(canvas, preset);
      return el('button.shape-gallery-item', { type: 'button', role: 'menuitem', tabindex: -1, 'aria-label': name, title: name, onclick: () => { closeMenu(); onPick(preset); } }, canvas);
    })) }]);
  return openMenu({ anchor, label: 'Shapes', className: 'shape-gallery-menu', items, onClose, pointer });
}

export const LINE_WEIGHTS = [['¼ pt', 3175], ['½ pt', 6350], ['¾ pt', 9525], ['1 pt', 12700], ['1½ pt', 19050], ['2¼ pt', 28575], ['3 pt', 38100], ['4½ pt', 57150], ['6 pt', 76200]];
