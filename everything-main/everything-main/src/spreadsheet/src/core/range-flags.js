/** Sparse rectangular annotations with sets of independent keys. */
import { MAX_ROW, MAX_COL } from './refs.js';
import { GRID_RANGE, rowRuns, mapRangeRecords, compactRangeRecords, shiftRangeRecords,
  permuteRangeRecords, moveLineRangeRecords, moveRangeRecords, clearRangeRecordsAtCells } from './range-records.js';
export { GRID_RANGE, intersection, rowRuns, mapRangeRecords as mapRangeFlags } from './range-records.js';

export function removeRangeFlags(records, area, keys = null, skipRow = null) {
  const removed = keys && new Set(keys);
  return mapRangeRecords(records, area, (record) => {
    const keep = removed ? record.keys.filter((k) => !removed.has(k)) : [];
    if (keep.length === record.keys.length) return [record];
    return [...(keep.length ? [{ ...record, keys: keep }] : []),
      ...(skipRow ? rowRuns(record.range, skipRow).map((range) => ({ ...record, range })) : [])];
  });
}

/** Normalize flag sets, then join rectangles carrying the same set. */
export function compactRangeFlags(records) {
  const normalized = records.filter(r => r.keys.length).map(r => ({ range: r.range, keys: [...new Set(r.keys)].sort() }));
  return compactRangeRecords(normalized, r => r.keys.join(','));
}

export const shiftRangeFlags = (records, axis, at, count, remove, band = GRID_RANGE) =>
  compactRangeFlags(shiftRangeRecords(records, axis, at, count, remove, band));
export const permuteRangeFlags = (records, area, axis, map) =>
  compactRangeFlags(permuteRangeRecords(records, area, axis, map));
export const moveLineRangeFlags = (records, axis, edges, map) =>
  compactRangeFlags(moveLineRangeRecords(records, axis, edges, map));
export const moveRangeFlags = (records, src, dst) => compactRangeFlags(moveRangeRecords(records, src, dst));

export function readRangeFlags(raw, allowedKeys) {
  if (!Array.isArray(raw)) return [];
  return compactRangeFlags(raw.flatMap((record) => {
    const g = record?.range;
    if (!g || !['r1', 'r2', 'c1', 'c2'].every((k) => Number.isInteger(g[k])) || !Array.isArray(record.keys)) return [];
    if (g.r1 < 0 || g.c1 < 0 || g.r2 > MAX_ROW || g.c2 > MAX_COL || g.r1 > g.r2 || g.c1 > g.c2) return [];
    const keys = record.keys.filter((k) => allowedKeys.includes(k));
    return keys.length ? [{ range: { r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }, keys }] : [];
  }));
}

/** Remove annotations at edited cells; an untouched list keeps its identity. */
export function clearRangeFlagsAtCells(records, cells) {
  const after = clearRangeRecordsAtCells(records, cells);
  return after === records ? records : compactRangeFlags(after);
}
