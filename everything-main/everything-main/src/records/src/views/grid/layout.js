/**
 * Grid geometry: columns (frozen ones first), display rows (records, group
 * headers, add-record lines), their offsets, and hit testing. Offsets live
 * in typed arrays so finding the row under a pointer is a binary search,
 * even with hundreds of thousands of rows.
 */
import { ROW_HEIGHTS, visibleFields } from '../../data/views.js';

export const HEADER_H = 32;
export const FOOTER_H = 32;
export const ADD_COL_W = 92;
export const MIN_COL_W = 60;
export const DEFAULT_COL_W = 180;
export const PRIMARY_COL_W = 240;
export const GROUP_H = 44;
export const ADD_ROW_H = 32;
export const GROUP_GAP = 12;
export const GROUP_INDENT = 0;

export function gutterWidth(compact) {
  return compact ? 44 : 72;
}

export class Layout {
  constructor() {
    this.cols = [];
    this.rows = [];
    this.recRow = new Int32Array(0);
    this.ys = new Float64Array(1);
    this.records = [];
  }

  /**
   * Build columns. Widths come from the view; the first `frozen` columns
   * (at least the primary field) stay put while the rest scroll.
   */
  buildColumns(table, view, { compact = false, maxFrozenW = Infinity } = {}) {
    const fields = visibleFields(table, view);
    const gutter = gutterWidth(compact);
    let x = gutter;
    this.gutter = gutter;
    this.cols = fields.map((f, i) => {
      const fallback = i === 0 ? (compact ? 160 : PRIMARY_COL_W) : DEFAULT_COL_W;
      const w = Math.max(MIN_COL_W, Math.round(view.widths?.[f.id] || fallback));
      const col = { field: f, x, w, i };
      x += w;
      return col;
    });
    const maxFrozen = compact ? 1 : Math.max(1, this.cols.length);
    this.frozen = Math.max(1, Math.min(view.frozen ?? 1, maxFrozen, this.cols.length));
    // Frozen columns never fill the whole width, or the rest could not be reached.
    while (this.frozen > 1 && this.cols[this.frozen - 1].x + this.cols[this.frozen - 1].w > maxFrozenW) this.frozen--;
    // A first column wider than that shows narrower (its saved width stays).
    const first = this.cols[0];
    if (first && first.x + first.w > maxFrozenW) {
      first.w = Math.max(MIN_COL_W, Math.floor(maxFrozenW - first.x));
      x = first.x;
      for (const col of this.cols) {
        col.x = x;
        x += col.w;
      }
    }
    this.frozenW = this.cols.length ? this.cols[this.frozen - 1].x + this.cols[this.frozen - 1].w : gutter;
    this.contentW = x + ADD_COL_W;
  }

  /**
   * Build display rows from view results. With groups, each group gets a
   * header, its records (unless collapsed), an add line and a gap.
   */
  buildRows(result, view, { collapsed = new Set(), canAdd = true } = {}) {
    const rowH = ROW_HEIGHTS[view.rowHeight]?.px || ROW_HEIGHTS.short.px;
    this.rowH = rowH;
    const rows = [];
    const records = [];
    let y = 0;
    const pushRec = (rec) => {
      records.push(rec);
      rows.push({ k: 'rec', rec, ri: records.length - 1, y, h: rowH });
      y += rowH;
    };
    if (result.tree) {
      const walk = (nodes, depth, path) => {
        for (const node of nodes) {
          const isCollapsed = collapsed.has(node.path);
          if (depth === 0 && rows.length) {
            rows.push({ k: 'gap', y, h: GROUP_GAP });
            y += GROUP_GAP;
          }
          rows.push({ k: 'group', node, depth, y, h: GROUP_H - depth * 6, collapsed: isCollapsed, count: countRecords(node) });
          y += GROUP_H - depth * 6;
          if (isCollapsed) continue;
          if (node.children) walk(node.children, depth + 1, [...path, node]);
          else {
            for (const rec of node.records) pushRec(rec);
            if (canAdd) {
              rows.push({ k: 'add', groups: [...path, node], y, h: ADD_ROW_H });
              y += ADD_ROW_H;
            }
          }
        }
      };
      walk(result.tree, 0, []);
      // Records hidden in collapsed groups still count for selection order.
    } else {
      for (const rec of result.records) pushRec(rec);
      if (canAdd) {
        rows.push({ k: 'add', groups: [], y, h: ADD_ROW_H });
        y += ADD_ROW_H;
      }
    }
    this.rows = rows;
    this.records = records;
    this.bodyH = y;
    this.ys = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) this.ys[i] = rows[i].y;
    this.ys[rows.length] = y;
    this.recRow = new Int32Array(records.length);
    for (let i = 0; i < rows.length; i++) if (rows[i].k === 'rec') this.recRow[rows[i].ri] = i;
    this.grouped = !!result.tree;
  }

  /** Index of the display row at body offset y (or -1). */
  rowAt(y) {
    const ys = this.ys;
    const n = this.rows.length;
    if (y < 0 || y >= ys[n]) return -1;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ys[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Column index at content x for a given horizontal scroll, or -1. */
  colAt(x, scrollX) {
    if (x < this.gutter) return -2;
    if (x < this.frozenW) {
      for (let i = 0; i < this.frozen; i++) {
        const c = this.cols[i];
        if (x >= c.x && x < c.x + c.w) return i;
      }
      return -1;
    }
    const cx = x + scrollX;
    for (let i = this.frozen; i < this.cols.length; i++) {
      const c = this.cols[i];
      if (cx >= c.x && cx < c.x + c.w) return i;
    }
    const last = this.cols[this.cols.length - 1];
    if (last && cx >= last.x + last.w && cx < last.x + last.w + ADD_COL_W) return -3;
    return -1;
  }

  /** Screen x of a column (in viewport coordinates). */
  colX(i, scrollX) {
    const c = this.cols[i];
    return i < this.frozen ? c.x : c.x - scrollX;
  }

  /** Visible display row range for a scroll position. */
  visibleRows(scrollY, viewH) {
    const top = Math.max(0, scrollY);
    const first = Math.max(0, this.rowAt(top));
    let last = this.rowAt(top + viewH);
    if (last < 0) last = this.rows.length - 1;
    return [first, last];
  }

  /** Visible scrolled column range. */
  visibleCols(scrollX, viewW) {
    let first = this.frozen;
    let last = this.cols.length - 1;
    for (let i = this.frozen; i < this.cols.length; i++) {
      const c = this.cols[i];
      if (c.x + c.w - scrollX > this.frozenW) {
        first = i;
        break;
      }
      first = i + 1;
    }
    for (let i = first; i < this.cols.length; i++) {
      if (this.cols[i].x - scrollX > viewW) {
        last = i - 1;
        break;
      }
    }
    return [first, last];
  }
}

function countRecords(node) {
  return node.records.length;
}
