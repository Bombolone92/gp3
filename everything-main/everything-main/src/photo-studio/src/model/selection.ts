import type { IRect, Mask8 } from '../imaging/types';
import type { PhotoDocument, Rect } from './document';
import {
  TILE,
  allMask,
  emptyGrid,
  filledMask,
  gridDocBounds,
  intersectRect,
  readMask,
  writeRect,
  type TileGrid,
  type TileStore,
} from './tiles';

// Selections are document-space coverage grids (origin 0). The legacy
// `selection` rectangle is kept equal to their bounds, clipped to the canvas.
export type SelectionOp = 'replace' | 'add' | 'subtract' | 'intersect';

export function canvasRect(doc: Pick<PhotoDocument, 'width' | 'height'>): IRect {
  return { x: 0, y: 0, width: doc.width, height: doc.height };
}
/** The active selection as a coverage grid, or null when nothing is selected. */
export function selectionGrid(doc: PhotoDocument, store: TileStore): TileGrid | null {
  if (doc.selectionMask) return doc.selectionMask;
  if (doc.selection) return filledMask(store, roundRect(doc.selection));
  return null;
}
export function roundRect(r: Rect): IRect {
  const x = Math.floor(r.x),
    y = Math.floor(r.y);
  return { x, y, width: Math.max(0, Math.ceil(r.x + r.width) - x), height: Math.max(0, Math.ceil(r.y + r.height) - y) };
}
/** Bounds of a selection grid within the canvas. */
export function selectionBounds(doc: Pick<PhotoDocument, 'width' | 'height'>, grid: TileGrid | null): IRect | null {
  if (!grid) return null;
  const b = grid.fill ? canvasRect(doc) : gridDocBounds(grid);
  return b ? intersectRect(b, canvasRect(doc)) : null;
}
/** Store a selection on a document (mutates `doc`, for use inside commands). */
export function applySelection(doc: PhotoDocument, grid: TileGrid | null) {
  const bounds = selectionBounds(doc, grid);
  if (!grid || !bounds) {
    doc.selection = null;
    doc.selectionMask = null;
    return;
  }
  doc.selectionMask = grid;
  doc.selection = { ...bounds };
}
/** Combine a new shape with the existing selection. */
export function combineSelection(
  store: TileStore,
  doc: PhotoDocument,
  current: TileGrid | null,
  shape: TileGrid,
  op: SelectionOp,
): TileGrid | null {
  if (op === 'replace') return shape;
  // Subtracting from or intersecting with nothing leaves nothing selected.
  if (!current) return op === 'add' ? shape : null;
  const area = canvasRect(doc);
  const a = readMask(store, current, area).data,
    b = readMask(store, shape, area).data;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++)
    out[i] =
      op === 'add'
        ? Math.max(a[i], b[i])
        : op === 'subtract'
          ? Math.min(a[i], 255 - b[i])
          : Math.min(a[i], b[i]);
  return maskGrid(store, { width: area.width, height: area.height, data: out });
}
/** A selection grid from a canvas-sized mask (or null when empty). */
export function maskGrid(store: TileStore, mask: Mask8, x = 0, y = 0): TileGrid | null {
  const g = writeRect(store, emptyGrid(1), x, y, mask);
  return g.bounds ? g : null;
}
export function selectAllGrid(): TileGrid {
  return allMask(255);
}
export function invertSelection(store: TileStore, doc: PhotoDocument, grid: TileGrid | null): TileGrid | null {
  if (!grid) return selectAllGrid();
  const area = canvasRect(doc);
  const m = readMask(store, grid, area);
  for (let i = 0; i < m.data.length; i++) m.data[i] = 255 - m.data[i];
  return maskGrid(store, m);
}
/** Canvas-sized coverage of the active selection (all 255 when none). */
export function selectionCoverage(doc: PhotoDocument, store: TileStore, rect: IRect = canvasRect(doc)): Mask8 {
  const grid = selectionGrid(doc, store);
  return grid ? readMask(store, grid, rect) : { width: rect.width, height: rect.height, data: new Uint8Array(rect.width * rect.height).fill(255) };
}

/** Closed outlines of the 50% coverage boundary, as SVG path data in document
 * units. Large selections are traced on a coarser grid to keep redraws cheap. */
export function selectionOutline(doc: Pick<PhotoDocument, 'width' | 'height'>, store: TileStore, grid: TileGrid, maxCells = 1_500_000): string {
  const b = selectionBounds(doc, grid);
  if (!b) return '';
  if (grid.fill && !Object.keys(grid.tiles).length)
    return `M${b.x} ${b.y}H${b.x + b.width}V${b.y + b.height}H${b.x}Z`;
  const step = Math.max(1, Math.ceil(Math.sqrt((b.width * b.height) / maxCells)));
  const w = Math.ceil(b.width / step) + 2,
    h = Math.ceil(b.height / step) + 2;
  const src = readMask(store, grid, b);
  // Inside test per coarse cell (sampled at its center), padded by one cell.
  const inside = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const sy = Math.min(b.height - 1, (y - 1) * step + (step >> 1));
    for (let x = 1; x < w - 1; x++) {
      const sx = Math.min(b.width - 1, (x - 1) * step + (step >> 1));
      inside[y * w + x] = src.data[sy * b.width + sx] >= 128 ? 1 : 0;
    }
  }
  // Collect boundary edges between inside and outside cells, oriented so the
  // inside is on the left, then chain them into loops.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = next.get(k);
    if (list) list.push(key(x1, y1));
    else next.set(k, [key(x1, y1)]);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside[y * w + x]) continue;
      if (!inside[(y - 1) * w + x]) edge(x, y, x + 1, y);
      if (!inside[y * w + x + 1]) edge(x + 1, y, x + 1, y + 1);
      if (!inside[(y + 1) * w + x]) edge(x + 1, y + 1, x, y + 1);
      if (!inside[y * w + x - 1]) edge(x, y + 1, x, y);
    }
  const parts: string[] = [];
  const px = (k: number) => b.x + ((k % (w + 1)) - 1) * step;
  const py = (k: number) => b.y + (Math.floor(k / (w + 1)) - 1) * step;
  for (const [start] of next) {
    if (!next.get(start)?.length) continue;
    let k = start;
    const pts: number[] = [];
    let guard = 0;
    while (guard++ < 10_000_000) {
      const list = next.get(k);
      if (!list?.length) break;
      const n = list.pop()!;
      pts.push(k);
      k = n;
      if (k === start) break;
    }
    if (pts.length < 3) continue;
    // Drop collinear points to keep paths short.
    let d = `M${px(pts[0])} ${py(pts[0])}`;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        c = pts[(i + 1) % pts.length],
        p = pts[i];
      const collinear = (px(a) === px(p) && px(p) === px(c)) || (py(a) === py(p) && py(p) === py(c));
      if (!collinear) d += `L${px(p)} ${py(p)}`;
    }
    parts.push(d + 'Z');
  }
  return parts.join('');
}
export const selectionTile = TILE;
