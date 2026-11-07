/**
 * Split windows (View ▸ Split): the window cut by a vertical bar, a horizontal
 * bar or both into panes that scroll on their own. Unlike frozen panes, a split is a distance on the
 * screen, not a count of rows or columns.
 *
 * A sheet's split is `{ x, y, r, c }`: `x` and `y` are where the bars are, in the grid's pixels at
 * 100% zoom measured from the cells' top-left corner (0 = no bar on that axis), and `r`/`c` is the
 * top-left cell of the top-left pane. The bottom-right pane's top-left cell is the sheet's view origin.
 */
import { MAX_ROW, MAX_COL } from './refs.js';

/** The largest split kept, in pixels: well past any window, but bounded whatever a file says. */
export const MAX_SPLIT = 20000;

/** Pixels at 100% to the twentieths of a point Excel writes in xSplit/ySplit (96 px = 72 pt). */
export const pxToTwips = (px) => Math.round(px * 15);
export const twipsToPx = (twips) => twips / 15;

/**
 * A saved split is measured from the window's edge, its row and column headings included. These are
 * the headings' extent assumed at 100% zoom, in pixels.
 */
export const XL_ROW_HEADING_PX = 0;
export const XL_COL_HEADING_PX = 0;

const index = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);

/** A stored split, or null when there is none (no bar on either axis, or nonsense). */
export function normalizeSplit(value) {
  if (!value || typeof value !== 'object') return null;
  const size = (v) => (Number.isFinite(v) && v > 0 ? Math.min(MAX_SPLIT, Math.round(v)) : 0);
  const x = size(value.x), y = size(value.y);
  if (!x && !y) return null;
  return { x, y, r: index(value.r, MAX_ROW), c: index(value.c, MAX_COL) };
}

/**
 * Where Split puts the bars, from the active cell's place in the window: above and left of
 * the active cell; only the bar that does not fall on the window's edge when the cell is in the first row
 * or column shown; and in the middle of the window, both ways, when the cell is the top-left one.
 * `cellX`/`cellY` are the active cell's top-left corner in the window, `width`/`height` the window's
 * cells area; `snap(axis, pos)` moves a middle split onto the nearest line between cells.
 */
export function splitAtCell({ cellX, cellY, width, height, snap = (axis, v) => v }) {
  let x = cellX > 1 && cellX < width - 1 ? cellX : 0;
  let y = cellY > 1 && cellY < height - 1 ? cellY : 0;
  if (!x && !y) { x = snap('x', width / 2); y = snap('y', height / 2); }
  return { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) };
}

/** A bar dragged within this many pixels of the window's edge goes. */
export const SPLIT_EDGE = 8;

/** Where a dragged bar lands, or 0 when it was dragged off the window's edge. */
export function dropSplit(pos, extent) {
  if (!(pos > SPLIT_EDGE) || !(pos < extent - SPLIT_EDGE)) return 0;
  return Math.round(pos);
}

/** The pane XML for a split, its distances in twentieths of a point; '' when there is none. */
export function splitPaneXml(split, { topLeftCell, activePane } = {}) {
  const s = normalizeSplit(split);
  if (!s) return '';
  const attrs = [
    s.x ? ` xSplit="${pxToTwips(s.x + XL_ROW_HEADING_PX)}"` : '',
    s.y ? ` ySplit="${pxToTwips(s.y + XL_COL_HEADING_PX)}"` : '',
    topLeftCell ? ` topLeftCell="${topLeftCell}"` : '',
    activePane ? ` activePane="${activePane}"` : '',
    ' state="split"',
  ].join('');
  return `<pane${attrs}/>`;
}

/** A split read back from a pane's xSplit and ySplit (twentieths of a point). */
export function splitFromPane(xSplit, ySplit, topLeft) {
  const px = (twips, heading) => {
    const n = Number(twips);
    return Number.isFinite(n) && n > 0 ? Math.max(0, twipsToPx(n) - heading) : 0;
  };
  return normalizeSplit({ x: px(xSplit, XL_ROW_HEADING_PX), y: px(ySplit, XL_COL_HEADING_PX), r: topLeft?.r ?? 0, c: topLeft?.c ?? 0 });
}

/** Which pane a split names as active, from the side of each bar the active cell was last used on. */
export function paneName(split, { left = false, top = false } = {}) {
  const s = normalizeSplit(split);
  if (!s) return null;
  const l = s.x ? left : true, t = s.y ? top : true;
  if (s.x && s.y) return `${t ? 'top' : 'bottom'}${l ? 'Left' : 'Right'}`;
  if (s.x) return l ? 'topLeft' : 'topRight';
  return t ? 'topLeft' : 'bottomLeft';
}
