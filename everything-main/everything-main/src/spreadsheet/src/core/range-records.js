/** Geometry for immutable sparse rectangular records. Payloads are opaque: reset
 * flags, concrete style values and other annotations share the same transforms.
 * Work scales with the records and edited lines, never with the grid's area. */
import { MAX_ROW, MAX_COL } from './refs.js';

export const GRID_RANGE = { r1: 0, c1: 0, r2: MAX_ROW, c2: MAX_COL };

export function intersection(a, b) {
  const out = { r1: Math.max(a.r1, b.r1), c1: Math.max(a.c1, b.c1), r2: Math.min(a.r2, b.r2), c2: Math.min(a.c2, b.c2) };
  return out.r1 <= out.r2 && out.c1 <= out.c2 ? out : null;
}

function outside(a, cut) {
  const out = [];
  if (a.r1 < cut.r1) out.push({ ...a, r2: cut.r1 - 1 });
  if (a.r2 > cut.r2) out.push({ ...a, r1: cut.r2 + 1 });
  if (a.c1 < cut.c1) out.push({ ...cut, c1: a.c1, c2: cut.c1 - 1 });
  if (a.c2 > cut.c2) out.push({ ...cut, c1: cut.c2 + 1, c2: a.c2 });
  return out;
}

export function rowRuns(range, include = null) {
  if (!include) return [range];
  const out = [];
  let start = null;
  for (let r = range.r1; r <= range.r2 + 1; r++) {
    if (r <= range.r2 && include(r)) { start ??= r; continue; }
    if (start != null) out.push({ ...range, r1: start, r2: r - 1 });
    start = null;
  }
  return out;
}

/** Transform just the part of each record inside a rectangle. */
export function mapRangeRecords(records, area, transform) {
  return records.flatMap((record) => {
    const cut = intersection(record.range, area);
    if (!cut) return [record];
    return [...outside(record.range, cut).map((range) => ({ ...record, range })), ...transform({ ...record, range: cut })];
  });
}

/** Remove every record inside a rectangle, retaining its outside pieces. */
export function removeRangeRecords(records, area) {
  return mapRangeRecords(records, area, () => []);
}

/** Join touching rectangles with the same payload identity. Records are immutable;
 * the caller supplies an identity for every meaningful non-geometric field.
 * This does not resolve precedence between overlapping different payloads. */
export function compactRangeRecords(records, identity) {
  let out = records;
  for (const axis of ['row', 'col']) {
    const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
    const a = axis === 'row' ? 'c1' : 'r1', b = axis === 'row' ? 'c2' : 'r2';
    const groups = new Map();
    for (const r of out) {
      const key = JSON.stringify([identity(r), r.range[a], r.range[b]]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    out = [];
    for (const group of groups.values()) {
      group.sort((x, y) => x.range[lo] - y.range[lo]);
      let prev;
      for (const record of group) {
        if (prev && record.range[lo] <= prev.range[hi] + 1) prev.range = { ...prev.range, [hi]: Math.max(prev.range[hi], record.range[hi]) };
        else { prev = { ...record }; out.push(prev); }
      }
    }
  }
  return out;
}

/** Insert/delete cells in a band, or whole lines when band is omitted. */
export function shiftRangeRecords(records, axis, at, count, remove, band = GRID_RANGE) {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
  return mapRangeRecords(records, band, (record) => {
    const g = { ...record.range };
    if (remove) {
      g[lo] = g[lo] >= at + count ? g[lo] - count : g[lo] >= at ? at : g[lo];
      g[hi] = g[hi] >= at + count ? g[hi] - count : g[hi] >= at ? at - 1 : g[hi];
    } else if (g[lo] >= at) { g[lo] += count; g[hi] += count; }
    else if (g[hi] >= at) {
      const shifted = intersection({ ...g, [lo]: at + count, [hi]: g[hi] + count }, GRID_RANGE);
      return [{ ...record, range: { ...g, [hi]: at - 1 } }, ...(shifted ? [{ ...record, range: shifted }] : [])];
    }
    const range = intersection(g, GRID_RANGE);
    return range ? [{ ...record, range }] : [];
  });
}

/** A finite permutation/compaction, such as a sort, shuffle or duplicate removal. */
export function permuteRangeRecords(records, area, axis, map) {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
  return mapRangeRecords(records, area, (record) => {
    const moved = [];
    for (let i = record.range[lo]; i <= record.range[hi]; i++) {
      const next = map(i);
      if (next != null) moved.push({ ...record, range: { ...record.range, [lo]: next, [hi]: next } });
    }
    return moved;
  });
}

/** Piecewise translation of whole rows/columns, without visiting each cell or line. */
export function moveLineRangeRecords(records, axis, edges, map) {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
  return records.flatMap((record) => {
    const g = record.range;
    const points = [...new Set([g[lo], ...edges.filter((e) => e > g[lo] && e <= g[hi]), g[hi] + 1])].sort((a, b) => a - b);
    return points.slice(0, -1).map((p, i) => ({ ...record, range: { ...g, [lo]: map(p), [hi]: map(points[i + 1] - 1) } }));
  });
}

export function moveRangeRecords(records, src, dst) {
  const dr = dst.r1 - src.r1, dc = dst.c1 - src.c1;
  const moved = records.flatMap((record) => {
    const cut = intersection(record.range, src);
    return cut ? [{ ...record, range: { r1: cut.r1 + dr, c1: cut.c1 + dc, r2: cut.r2 + dr, c2: cut.c2 + dc } }] : [];
  });
  return [...removeRangeRecords(removeRangeRecords(records, src), dst), ...moved];
}

/** Remove records at changed cells without repeatedly fragmenting a large range.
 * Sweep only edited rows/columns; a full-sheet annotation remains sparse. */
export function clearRangeRecordsAtCells(records, cells) {
  if (!records.length || !cells.length) return records;
  const rows = new Map();
  for (const { r, c } of cells) {
    if (!rows.has(r)) rows.set(r, new Set());
    rows.get(r).add(c);
  }
  const edits = [...rows].sort(([a], [b]) => a - b).map(([r, cols]) => [r, [...cols].sort((a, b) => a - b)]);
  const lower = (list, value, key = x => x) => {
    let lo = 0, hi = list.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (key(list[mid]) < value) lo = mid + 1; else hi = mid; }
    return lo;
  };
  let changed = false;
  const out = [];
  for (const record of records) {
    const g = record.range;
    let start = g.r1;
    for (let i = lower(edits, g.r1, x => x[0]); i < edits.length && edits[i][0] <= g.r2; i++) {
      const [r, cols] = edits[i], first = lower(cols, g.c1);
      if (first === cols.length || cols[first] > g.c2) continue;
      changed = true;
      if (start < r) out.push({ ...record, range: { ...g, r1: start, r2: r - 1 } });
      let c1 = g.c1;
      for (let j = first; j < cols.length && cols[j] <= g.c2; j++) {
        if (c1 < cols[j]) out.push({ ...record, range: { r1: r, r2: r, c1, c2: cols[j] - 1 } });
        c1 = cols[j] + 1;
      }
      if (c1 <= g.c2) out.push({ ...record, range: { r1: r, r2: r, c1, c2: g.c2 } });
      start = r + 1;
    }
    if (start <= g.r2) out.push({ ...record, range: { ...g, r1: start } });
  }
  return changed ? out : records;
}

/** Visit containing records through a cached spatial index. Visit order is
 * unspecified; the original array index is supplied for ordered payloads.
 * Records, ranges and the array must remain immutable while indexed. */
const indexes = new WeakMap();
function rangeIndex(records) {
  let root = indexes.get(records);
  if (!root) {
    const sorted = records.map((_, index) => index).sort((a, b) => records[a].range.r1 - records[b].range.r1 || records[a].range.c1 - records[b].range.c1);
    const build = (start, end) => {
      if (start >= end) return null;
      const mid = (start + end) >>> 1, index = sorted[mid], record = records[index];
      const left = build(start, mid), right = build(mid + 1, end);
      const box = { ...record.range };
      for (const child of [left, right]) if (child) {
        box.r1 = Math.min(box.r1, child.box.r1); box.r2 = Math.max(box.r2, child.box.r2);
        box.c1 = Math.min(box.c1, child.box.c1); box.c2 = Math.max(box.c2, child.box.c2);
      }
      return { record, index, left, right, box };
    };
    root = build(0, sorted.length);
    indexes.set(records, root);
  }
  return root;
}

export function forEachRangeRecordAt(records, r, c, visitRecord) {
  if (!records.length) return;
  const root = rangeIndex(records);
  const contains = (g) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
  const visit = (node) => {
    if (!node || !contains(node.box)) return;
    if (contains(node.record.range)) visitRecord(node.record, node.index);
    visit(node.left); visit(node.right);
  };
  visit(root);
}

/** Query only records intersecting a rectangle, using the same immutable index. */
export function forEachRangeRecordIn(records, area, visitRecord) {
  if (!records.length) return;
  const intersects = g => g.r1 <= area.r2 && g.r2 >= area.r1 && g.c1 <= area.c2 && g.c2 >= area.c1;
  const visit = node => {
    if (!node || !intersects(node.box)) return;
    if (intersects(node.record.range)) visitRecord(node.record, node.index);
    visit(node.left); visit(node.right);
  };
  visit(rangeIndex(records));
}

/** Compact the exact cells accepted by a paste into sparse coverage rectangles. */
export function rangesCoveringCells(cells) {
  const rows = new Map(), ranges = [];
  for (const { r, c } of cells) { if (!rows.has(r)) rows.set(r, []); rows.get(r).push(c); }
  for (const [r, cols] of rows) {
    cols.sort((a, b) => a - b);
    let start = cols[0], end = start;
    for (let i = 1; i <= cols.length; i++) {
      if (i < cols.length && cols[i] <= end + 1) { end = Math.max(end, cols[i]); continue; }
      ranges.push({ range: { r1: r, r2: r, c1: start, c2: end } }); start = end = cols[i];
    }
  }
  return compactRangeRecords(ranges, () => 0);
}
