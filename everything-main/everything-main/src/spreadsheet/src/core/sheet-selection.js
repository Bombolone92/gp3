import { MAX_ROW, MAX_COL } from './refs.js';

const point = p => p && Number.isInteger(p.r) && p.r >= 0 && p.r <= MAX_ROW
  && Number.isInteger(p.c) && p.c >= 0 && p.c <= MAX_COL;
const contains = (range, p) => p.r >= range.r1 && p.r <= range.r2 && p.c >= range.c1 && p.c <= range.c2;

/** View coordinates are independent of the selected cell and contain no pixels. */
export const normalizeSheetOrigin = value => point(value) ? { r: value.r, c: value.c } : null;

/** Saved selections contain coordinates, never cell data or pixel dimensions. */
export function normalizeSheetSelection(value) {
  if (!value || !Array.isArray(value.ranges)) return null;
  const ranges = value.ranges.filter(r => r && point({ r: r.r1, c: r.c1 }) && point({ r: r.r2, c: r.c2 })
    && r.r1 <= r.r2 && r.c1 <= r.c2).map(({ r1, c1, r2, c2 }) => ({ r1, c1, r2, c2 }));
  if (!ranges.length) return null;
  let active = point(value.active) ? { r: value.active.r, c: value.active.c } : { r: ranges[0].r1, c: ranges[0].c1 };
  let index = Number.isInteger(value.activeRange) && ranges[value.activeRange] && contains(ranges[value.activeRange], active)
    ? value.activeRange : ranges.findIndex(r => contains(r, active));
  if (index < 0) { index = 0; active = { r: ranges[0].r1, c: ranges[0].c1 }; }
  return { active, ranges, activeRange: index };
}
