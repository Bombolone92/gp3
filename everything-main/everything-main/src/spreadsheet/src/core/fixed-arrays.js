import { MAX_ROW, MAX_COL } from './refs.js';

/** A legacy CSE array owns a fixed rectangle, independent of its result. */
export function fixedArraySize(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isInteger(value.rows) || !Number.isInteger(value.cols)
    || value.rows < 1 || value.rows > MAX_ROW + 1 || value.cols < 1 || value.cols > MAX_COL + 1) return null;
  return { rows: value.rows, cols: value.cols };
}

/**
 * CSE results broadcast singleton axes, truncate at the selected boundary,
 * and pad a shorter non-singleton axis with #N/A. Keep the original result
 * compact: a scalar selected across a million rows needs no million-row copy.
 */
export function fixedArrayValue(result, row, col) {
  if (!result?.range) return result?.lambda ? { error: '#CALC!' } : result ?? 0;
  const values = result.values;
  const rows = values.length, cols = values[0]?.length || 0;
  const r = rows === 1 ? 0 : row, c = cols === 1 ? 0 : col;
  return r < rows && c < cols ? values[r]?.[c] ?? 0 : { error: '#N/A' };
}

/**
 * Sparse lookup of fixed array rectangles. Prefix row bounds skip rectangles
 * ending before the requested point without indexing every output cell.
 */
export class FixedArrayIndex {
  constructor(cells) {
    this.ranges = [];
    for (const [key, cell] of cells) {
      if (typeof cell?.f !== 'string') continue;
      const size = fixedArraySize(cell.array);
      if (!size) continue;
      const [r, c] = key.split(',').map(Number);
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0
        || r + size.rows > MAX_ROW + 1 || c + size.cols > MAX_COL + 1) continue;
      this.ranges.push({ key, r, c, ...size, r1: r, c1: c, r2: r + size.rows - 1, c2: c + size.cols - 1 });
    }
    this.ranges.sort((a, b) => a.r - b.r || a.c - b.c);
    this.ends = [];
    let end = -1;
    for (const range of this.ranges) this.ends.push(end = Math.max(end, range.r2));
  }

  get size() { return this.ranges.length; }

  *overlapping({ r1, c1, r2, c2 }) {
    let lo = 0, hi = this.ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.ranges[mid].r1 <= r2) lo = mid + 1; else hi = mid;
    }
    for (let i = lo - 1; i >= 0 && this.ends[i] >= r1; i--) {
      const range = this.ranges[i];
      if (range.r2 >= r1 && range.c1 <= c2 && range.c2 >= c1) yield range;
    }
  }

  at(r, c) {
    return this.overlapping({ r1: r, c1: c, r2: r, c2: c }).next().value ?? null;
  }

  *cells(area) {
    for (const a of this.overlapping(area)) {
      const r1 = Math.max(a.r1, area.r1), r2 = Math.min(a.r2, area.r2);
      const c1 = Math.max(a.c1, area.c1), c2 = Math.min(a.c2, area.c2);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        if (r !== a.r || c !== a.c) yield `${r},${c}`;
      }
    }
  }
}
