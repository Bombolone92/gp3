/**
 * Pattern Tile tool (pattern editing mode only): drag the tile's edges or
 * corners to resize it, or inside it to move it over the art. Shift keeps
 * the proportions; Alt resizes around the center. The overlay hook below
 * also draws the tile edge and swatch bounds for every tool.
 */
import { Tool } from '../../tools/tool.js';
import { lattice, tileOutline } from './model.js';
import { editLayer, editTile, editDef, layerArtBounds } from './edit.js';

const EDGE_PX = 6;

/** Tile part under a screen point: 'nw', 'n', ..., 'move', or null. */
export function tilePartAt(editor, tile, sx, sy) {
  const v = editor.view;
  const pts = { nw: [tile.x, tile.y], ne: [tile.x + tile.w, tile.y], se: [tile.x + tile.w, tile.y + tile.h], sw: [tile.x, tile.y + tile.h] };
  for (const [k, [x, y]] of Object.entries(pts)) {
    const s = v.toScreen(x, y);
    if (Math.hypot(s.x - sx, s.y - sy) <= EDGE_PX + 2) return k;
  }
  const p = v.toDoc(sx, sy);
  const tol = EDGE_PX / v.zoom;
  const inY = p.y > tile.y - tol && p.y < tile.y + tile.h + tol;
  const inX = p.x > tile.x - tol && p.x < tile.x + tile.w + tol;
  if (inY && Math.abs(p.x - tile.x) < tol) return 'w';
  if (inY && Math.abs(p.x - (tile.x + tile.w)) < tol) return 'e';
  if (inX && Math.abs(p.y - tile.y) < tol) return 'n';
  if (inX && Math.abs(p.y - (tile.y + tile.h)) < tol) return 's';
  if (p.x > tile.x && p.x < tile.x + tile.w && p.y > tile.y && p.y < tile.y + tile.h) return 'move';
  return null;
}

const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

/** New tile rect for a drag of `part` by (dx, dy). */
export function dragTile(t0, part, dx, dy, { shift = false, alt = false } = {}) {
  if (part === 'move') return { ...t0, x: t0.x + dx, y: t0.y + dy };
  let { x, y, w, h } = t0;
  const k = alt ? 2 : 1;
  if (part.includes('e')) w = t0.w + dx * k;
  if (part.includes('w')) w = t0.w - dx * k;
  if (part.includes('s')) h = t0.h + dy * k;
  if (part.includes('n')) h = t0.h - dy * k;
  w = Math.max(1, w);
  h = Math.max(1, h);
  if (shift) {
    const r = part === 'n' || part === 's' ? h / t0.h : part === 'e' || part === 'w' ? w / t0.w : Math.max(w / t0.w, h / t0.h);
    w = t0.w * r;
    h = t0.h * r;
  }
  if (alt) {
    x = t0.x + (t0.w - w) / 2;
    y = t0.y + (t0.h - h) / 2;
  } else {
    x = part.includes('w') ? t0.x + t0.w - w : part.includes('e') ? t0.x : t0.x + (t0.w - w) / 2;
    y = part.includes('n') ? t0.y + t0.h - h : part.includes('s') ? t0.y : t0.y + (t0.h - h) / 2;
  }
  return { x, y, w, h };
}

export class PatternTileTool extends Tool {
  static id = 'pattern-tile';
  static label = 'Pattern Tile Tool';
  static icon = 'pattern-tile-tool';
  static hint = 'Drag the tile edges to resize it | Drag inside to move it | Shift keeps proportions | Option resizes from the center';

  activate() {
    this.setCursor('default');
    this.status();
  }

  layer() {
    return this.editor ? editLayer(this.editor.doc) : null;
  }

  onHover(e) {
    const layer = this.layer();
    const part = layer ? tilePartAt(this.editor, editTile(this.editor.doc, layer), e.sx, e.sy) : null;
    this.setCursor(part ? CURSORS[part] : layer ? 'default' : 'not-allowed');
  }

  onPointerDown(e) {
    const layer = this.layer();
    if (!layer) {
      this.app.notify('The Pattern Tile tool works in pattern editing mode.');
      return;
    }
    const doc = this.editor.doc;
    const t0 = editTile(doc, layer);
    const part = tilePartAt(this.editor, t0, e.sx, e.sy);
    if (!part) return;
    this.drag = { part, t0, x0: e.x, y0: e.y, tx: doc.begin(part === 'move' ? 'Move Tile' : 'Resize Tile'), layerId: layer.id };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const doc = this.editor.doc;
    const layer = doc.get(d.layerId);
    if (!layer) return;
    const t = dragTile(d.t0, d.part, e.x - d.x0, e.y - d.y0, e);
    const art = layerArtBounds(doc, layer);
    const cx = t.x + t.w / 2;
    const cy = t.y + t.h / 2;
    doc.update(layer.id, {
      pattern: { ...layer.pattern, sizeToArt: false, width: t.w, height: t.h, cx, cy, offset: art ? { x: cx - (art.x + art.w / 2), y: cy - (art.y + art.h / 2) } : { x: 0, y: 0 } },
    });
    this.editor.feedback = { sx: e.sx, sy: e.sy, text: `W: ${Number(t.w.toFixed(2))}\nH: ${Number(t.h.toFixed(2))}` };
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    this.editor.feedback = null;
    if (d) d.tx.commit();
    this.overlay();
  }

  cancel() {
    if (this.drag) this.drag.tx.cancel();
    this.drag = null;
  }

  commit() {
    if (this.drag) this.onPointerUp();
  }
}

/** Overlay: tile edge, swatch bounds and (for the tile tool) the tile handles. */
export function drawTileOverlay(ctx, editor, edgeColor) {
  const layer = editLayer(editor.doc);
  if (!layer) return;
  const p = layer.pattern;
  const t = editTile(editor.doc, layer);
  const v = editor.view;
  const tool = editor.tool;
  ctx.save();
  if (p.showSwatchBounds) {
    const { cell } = lattice(editDef(editor.doc, layer));
    const pts = [[0, 0], [cell.w, 0], [cell.w, cell.h], [0, cell.h]].map(([x, y]) => v.toScreen(t.x + cell.x + x, t.y + cell.y + y));
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (p.showTileEdge || tool?.id === 'pattern-tile') {
    const pts = tileOutline({ ...p, width: t.w, height: t.h }).map(([x, y]) => v.toScreen(t.x + x, t.y + y));
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.stroke();
  }
  if (tool?.id === 'pattern-tile') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = edgeColor;
    ctx.lineWidth = 1;
    const hs = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
    for (const [fx, fy] of hs) {
      const q = v.toScreen(t.x + t.w * fx, t.y + t.h * fy);
      ctx.fillRect(Math.round(q.x - 3.5) + 0.5, Math.round(q.y - 3.5) + 0.5, 7, 7);
      ctx.strokeRect(Math.round(q.x - 3.5) + 0.5, Math.round(q.y - 3.5) + 0.5, 7, 7);
    }
  }
  ctx.restore();
}
