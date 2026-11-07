/**
 * Column statistics: a summary of one column's values inside a range, for
 * the Column stats panel. Pure: takes computed values from the workbook.
 */

import { cellKey } from './cell.js';
import { isError } from './formula/functions.js';
import { midpoint, meanFromSum, sumFromTotal } from './numeric.js';

/**
 * { count, empty, numbers, textCount, errors, sum, avg, min, max, median,
 *   unique, top: [{ value, count }], buckets: [{ from, to, count }] }
 */
export function columnStats(wb, sheetId, col, range, { topN = 8, bucketCount = 10 } = {}) {
  const sheet = wb.sheet(sheetId);
  if (!sheet) return null;
  const r1 = range.r1;
  const r2 = range.r2;
  let count = 0;
  let empty = 0;
  let errors = 0;
  let textCount = 0;
  const nums = [];
  const freq = new Map();
  for (let r = r1; r <= r2; r++) {
    if (sheet.filterHidden?.has(r)) continue; // rows a filter hides are not part of the column's statistics
    const cell = sheet.cells.get(cellKey(r, col));
    const has = cell && (cell.v != null || cell.f != null);
    const v = has ? wb.getValue(sheetId, r, col) : wb.spillAt(sheetId, r, col)?.value ?? null;
    if (v == null || v === '') { empty++; continue; }
    count++;
    if (isError(v)) { errors++; continue; }
    if (typeof v === 'number') nums.push(v);
    else if (typeof v === 'string') textCount++;
    // The number 1, the text "1" and TRUE are three different values, as in every spreadsheet's distinct count.
    const key = typeof v === 'string' ? `s:${v.trim().toLowerCase()}` : `${typeof v}:${String(v)}`;
    const entry = freq.get(key) || { value: wb.getDisplay(sheetId, r, col), count: 0 };
    entry.count++;
    freq.set(key, entry);
  }
  const sorted = nums.slice().sort((a, b) => a - b);
  const sum = nums.reduce((a, b) => a + b, 0);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : midpoint(sorted[sorted.length / 2 - 1], sorted[sorted.length / 2])) : null;
  const top = [...freq.values()].sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))).slice(0, topN);
  let buckets = [];
  if (sorted.length >= 2 && sorted[0] !== sorted[sorted.length - 1]) {
    const lo = sorted[0];
    const hi = sorted[sorted.length - 1];
    const n = Math.min(bucketCount, Math.max(2, Math.ceil(Math.sqrt(sorted.length))));
    const width = (hi - lo) / n;
    // Finite endpoints can have an infinite span or a width that rounds to
    // zero. Normalize only those extremes so ordinary bucket edges stay put.
    const scaled = !Number.isFinite(width) || width === 0;
    const scale = scaled ? Math.max(Math.abs(lo), Math.abs(hi)) : 1;
    const low = lo / scale;
    const span = hi / scale - low;
    const edge = (i) => i === 0 ? lo : i === n ? hi
      : scaled ? lo * (1 - i / n) + hi * (i / n) : lo + width * i;
    buckets = Array.from({ length: n }, (_, i) => ({ from: edge(i), to: edge(i + 1), count: 0 }));
    for (const v of sorted) {
      const position = scaled ? ((v / scale - low) / span) * n : (v - lo) / width;
      buckets[Math.max(0, Math.min(n - 1, Math.floor(position)))].count++;
    }
  }
  return {
    count, empty, errors, textCount, numbers: nums.length,
    sum: nums.length ? sumFromTotal(sum, nums) : null, avg: nums.length ? meanFromSum(sum, nums.length, nums) : null,
    min: sorted.length ? sorted[0] : null, max: sorted.length ? sorted[sorted.length - 1] : null, median,
    unique: freq.size, top, buckets,
  };
}
