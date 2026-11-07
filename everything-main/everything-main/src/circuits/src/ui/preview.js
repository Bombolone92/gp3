// Canvas 2D previews of a component's symbol and footprint (component
// browser, component editor thumbnails). Small and static, so a 2D canvas is
// the right tool here rather than another WebGL context.

import { placeSymbol, placeFootprint } from '../model/place.js';
import { symbolBox } from '../model/sch.js';
import { footprintBox } from '../model/pcb.js';
import { textStrokes } from '../render/font.js';
import { SCH_PALETTES, PCB_PALETTES, layerColor } from '../render/palette.js';
import { mil } from '../core/units.js';

function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width, hgt = canvas.clientHeight || canvas.height;
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(hgt * dpr));
  let ctx = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hgt };
}

function fit(box, w, h, pad = 12) {
  const bw = Math.max(box.maxX - box.minX, 1), bh = Math.max(box.maxY - box.minY, 1);
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
  return { s, tx: (x) => w / 2 + (x - cx) * s, ty: (y) => h / 2 - (y - cy) * s };
}

function strokeText(ctx, m, text, x, y, size, opts = {}) {
  for (const pl of textStrokes(text, x, y, size, opts.rot || 0, opts.align, false)) {
    ctx.beginPath();
    for (let i = 0; i < pl.length; i += 2) {
      const X = m.tx(pl[i]), Y = m.ty(pl[i + 1]);
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
}

function graphic(ctx, m, g, stroke, fillBody) {
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  switch (g.t) {
    case 'line': ctx.moveTo(m.tx(g.x1), m.ty(g.y1)); ctx.lineTo(m.tx(g.x2), m.ty(g.y2)); break;
    case 'polyline': case 'poly':
      for (let i = 0; i < g.pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, m.tx(g.pts[i]), m.ty(g.pts[i + 1]));
      if (g.t === 'poly') ctx.closePath();
      break;
    case 'rect': ctx.rect(m.tx(Math.min(g.x1, g.x2)), m.ty(Math.max(g.y1, g.y2)), Math.abs(g.x2 - g.x1) * m.s, Math.abs(g.y2 - g.y1) * m.s); break;
    case 'circle': ctx.arc(m.tx(g.cx), m.ty(g.cy), g.r * m.s, 0, Math.PI * 2); break;
    case 'arc': ctx.arc(m.tx(g.cx), m.ty(g.cy), g.r * m.s, -g.a0 * Math.PI / 180, -(g.a0 + g.sweep) * Math.PI / 180, true); break;
    case 'text': strokeText(ctx, m, g.text, g.x, g.y, g.size || mil(60), { rot: g.rot, align: g.align }); return;
    default: return;
  }
  if (g.fill === 'body') { ctx.fillStyle = fillBody; ctx.fill(); }
  else if (g.fill) { ctx.fillStyle = stroke; ctx.fill(); }
  ctx.stroke();
}

export function drawSymbolPreview(canvas, def, theme = 'light') {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const pal = SCH_PALETTES[theme];
  ctx.fillStyle = pal.paper;
  ctx.fillRect(0, 0, w, h);
  if (!def?.symbol) return;
  const part = { x: 0, y: 0, rot: 0 };
  const pl = placeSymbol(def, part);
  const m = fit(symbolBox(def), w, h, 16);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, mil(8) * m.s);
  for (const g of pl.graphics) if (g.fill === 'body') graphic(ctx, m, g, pal.body, pal.bodyFill);
  for (const g of pl.graphics) if (g.fill !== 'body') graphic(ctx, m, g, pal.body, pal.bodyFill);
  for (const p of pl.pins) {
    if (p.hidden) continue;
    ctx.strokeStyle = pal.pin;
    ctx.beginPath();
    ctx.moveTo(m.tx(p.x), m.ty(p.y));
    ctx.lineTo(m.tx(p.bx), m.ty(p.by));
    ctx.stroke();
    const size = mil(50);
    if (size * m.s >= 4 && p.name && !p.hideName) {
      const dx = Math.sign(p.bx - p.x), dy = Math.sign(p.by - p.y);
      const vertical = p.rot === 90 || p.rot === 270;
      ctx.lineWidth = Math.max(0.8, size * 0.12 * m.s);
      ctx.strokeStyle = pal.pinName;
      strokeText(ctx, m, p.name, p.bx + dx * mil(40), p.by + dy * mil(40), size, { rot: vertical ? 90 : 0, align: { h: p.rot === 0 || p.rot === 90 ? 'left' : 'right', v: 'middle' } });
      ctx.lineWidth = Math.max(1, mil(8) * m.s);
    }
  }
}

export function drawFootprintPreview(canvas, def, theme = 'light') {
  const s = setup(canvas);
  if (!s) return;
  const { ctx, w, h } = s;
  const pal = PCB_PALETTES[theme];
  ctx.fillStyle = pal.boardFill;
  ctx.fillRect(0, 0, w, h);
  if (!def?.footprint) {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No footprint', w / 2, h / 2);
    return;
  }
  const comp = { x: 0, y: 0, rot: 0, side: 'top', padNets: {} };
  const placed = placeFootprint(def, comp);
  const m = fit(footprintBox(def), w, h, 14);
  ctx.lineCap = 'round';
  for (const g of placed.graphics) {
    if (g.layer === 'courtyard' || g.layer === 'mech1') continue;
    ctx.lineWidth = Math.max(1, (g.w || 150_000) * m.s);
    graphic(ctx, m, g, layerColor(g.layer || 'topOverlay'), layerColor(g.layer || 'topOverlay'));
  }
  for (const p of placed.pads) {
    ctx.fillStyle = p.side === 'thru' ? pal.multi : layerColor(p.side);
    ctx.save();
    ctx.translate(m.tx(p.x), m.ty(p.y));
    ctx.rotate(-(p.rot || 0) * Math.PI / 180);
    const pw = p.w * m.s, ph = (p.shape === 'round' ? p.w : p.h) * m.s;
    const r = p.shape === 'round' || p.shape === 'oval' ? Math.min(pw, ph) / 2 : p.shape === 'roundrect' ? Math.min(pw, ph) * (p.radius ?? 0.25) : 0;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-pw / 2, -ph / 2, pw, ph, r); else ctx.rect(-pw / 2, -ph / 2, pw, ph);
    ctx.fill();
    if (p.drill) {
      ctx.fillStyle = pal.hole;
      ctx.beginPath();
      ctx.arc(0, 0, (p.drill / 2) * m.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
