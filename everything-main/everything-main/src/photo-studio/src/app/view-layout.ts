// Arrangement of document windows in the canvas area: tabbed, tiled, n-up
// layouts and floating windows. Pure geometry; `src/app/views.ts` builds the
// DOM from it.

export type LayoutKind =
  | 'tabs'
  | 'tile-grid'
  | 'tile-vertical'
  | 'tile-horizontal'
  | '2-up-vertical'
  | '2-up-horizontal'
  | '3-up-vertical'
  | '3-up-horizontal'
  | '3-up-stacked'
  | '4-up'
  | '6-up';
export const layoutKinds: LayoutKind[] = ['tabs', 'tile-grid', 'tile-vertical', 'tile-horizontal', '2-up-vertical', '2-up-horizontal', '3-up-vertical', '3-up-horizontal', '3-up-stacked', '4-up', '6-up'];
// Cell rectangles as fractions of the docked area.
export type Cell = { x: number; y: number; width: number; height: number };
export type Rect = Cell;

/** Side-by-side columns. */
export function columns(count: number): Cell[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => ({ x: i / n, y: 0, width: 1 / n, height: 1 }));
}
/** Stacked rows. */
export function rows(count: number): Cell[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, i) => ({ x: 0, y: i / n, width: 1, height: 1 / n }));
}
/** A grid with `cols` columns; a short last row stretches across the width. */
export function grid(count: number, cols: number): Cell[] {
  const n = Math.max(1, count),
    c = Math.max(1, Math.min(cols, n)),
    r = Math.ceil(n / c);
  const out: Cell[] = [];
  for (let row = 0; row < r; row++) {
    const inRow = row === r - 1 ? n - c * (r - 1) : c;
    for (let col = 0; col < inRow; col++) out.push({ x: col / inRow, y: row / r, width: 1 / inRow, height: 1 / r });
  }
  return out;
}
/** Number of windows a layout shows side by side for `views` open views. */
export function cellCount(kind: LayoutKind, views: number) {
  const n = Math.max(1, views);
  switch (kind) {
    case 'tabs':
      return 1;
    case 'tile-grid':
    case 'tile-vertical':
    case 'tile-horizontal':
      return n;
    case '2-up-vertical':
    case '2-up-horizontal':
      return Math.min(n, 2);
    case '3-up-vertical':
    case '3-up-horizontal':
    case '3-up-stacked':
      return Math.min(n, 3);
    case '4-up':
      return Math.min(n, 4);
    case '6-up':
      return Math.min(n, 6);
  }
}
/** Cells for a layout holding `views` open views. */
export function layoutCells(kind: LayoutKind, views: number): Cell[] {
  const n = cellCount(kind, views);
  switch (kind) {
    case 'tabs':
      return [{ x: 0, y: 0, width: 1, height: 1 }];
    case 'tile-grid':
      return grid(n, Math.ceil(Math.sqrt(n)));
    case 'tile-vertical':
    case '2-up-vertical':
    case '3-up-vertical':
      return columns(n);
    case 'tile-horizontal':
    case '2-up-horizontal':
    case '3-up-horizontal':
      return rows(n);
    case '3-up-stacked':
      // One large window on the left, the others stacked on the right.
      return n < 3 ? columns(n) : [{ x: 0, y: 0, width: 0.5, height: 1 }, { x: 0.5, y: 0, width: 0.5, height: 0.5 }, { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }];
    case '4-up':
      return grid(n, 2);
    case '6-up':
      return grid(n, 3);
  }
}
/** Distribute views over cells in order; extra views become tabs of the last cell. */
export function distribute<T>(views: T[], cells: number): T[][] {
  const n = Math.max(1, Math.min(cells, views.length || 1));
  const frames: T[][] = Array.from({ length: n }, () => []);
  views.forEach((v, i) => frames[Math.min(i, n - 1)].push(v));
  return frames;
}
/** Pixel rectangle of a cell inside an area, rounded to whole pixels without gaps. */
export function cellRect(cell: Cell, area: { width: number; height: number }): Rect {
  const x0 = Math.round(cell.x * area.width),
    y0 = Math.round(cell.y * area.height);
  const x1 = Math.round((cell.x + cell.width) * area.width),
    y1 = Math.round((cell.y + cell.height) * area.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
/** Cascaded position for the index-th floating window. */
export function cascade(index: number, area: { width: number; height: number }): Rect {
  const width = Math.max(220, Math.round(area.width * 0.6)),
    height = Math.max(160, Math.round(area.height * 0.6));
  const step = 26,
    span = Math.max(1, Math.floor(Math.min(area.width - width, area.height - height) / step) + 1);
  const k = index % span;
  return clampFloat({ x: 24 + k * step, y: 16 + k * step, width, height }, area);
}
/** Keep a floating window's title bar reachable and its size sensible. */
export function clampFloat(r: Rect, area: { width: number; height: number }, min = { width: 180, height: 120 }): Rect {
  const width = Math.max(min.width, Math.min(r.width, Math.max(min.width, area.width))),
    height = Math.max(min.height, Math.min(r.height, Math.max(min.height, area.height)));
  const x = Math.max(-width + 60, Math.min(r.x, area.width - 60)),
    y = Math.max(0, Math.min(r.y, area.height - 28));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
