import { MAX_ROW, MAX_COL } from './refs.js';
import { intersection } from './style-resets.js';

const valid = a => a && ['r1', 'c1', 'r2', 'c2'].every(k => Number.isInteger(a[k]))
  && a.r1 >= 0 && a.c1 >= 0 && a.r1 <= a.r2 && a.c1 <= a.c2 && a.r2 <= MAX_ROW && a.c2 <= MAX_COL;
const contains = (a, b) => a.r1 <= b.r1 && a.c1 <= b.c1 && a.r2 >= b.r2 && a.c2 >= b.c2;
const key = (r, c) => r * (MAX_COL + 1) + c;

/** Merges cleared by the source side of a preflighted move do not obstruct its destination. */
export function remainingPasteMerges(existing, cleared) {
  if (!cleared?.length) return existing;
  const name = m => `${m.r1},${m.c1},${m.r2},${m.c2}`;
  const names = new Set(cleared.map(name));
  return existing.filter(m => !names.has(name(m)));
}

/** Map source-relative merge geometry through tiling, transposition and grid clipping. */
export function mapPasteMerges(merges, height, width, r0, c0, repeat, transpose, limit) {
  if (!Array.isArray(merges)) return null;
  const mapped = [];
  for (const m of merges) {
    if (!valid(m) || m.r2 >= height || m.c2 >= width || r0 < 0 || c0 < 0) return null;
    for (let ry = 0; ry < repeat.rows && r0 + ry * height < limit.rows; ry++) {
      for (let rx = 0; rx < repeat.cols && c0 + rx * width < limit.cols; rx++) {
        const r = r0 + ry * height, c = c0 + rx * width;
        const next = { r1: r + (transpose ? m.c1 : m.r1), c1: c + (transpose ? m.r1 : m.c1),
          r2: Math.min(limit.rows - 1, r + (transpose ? m.c2 : m.r2)),
          c2: Math.min(limit.cols - 1, c + (transpose ? m.r2 : m.c2)) };
        if (next.r1 > next.r2 || next.c1 > next.c2 || next.r1 === next.r2 && next.c1 === next.c2) continue;
        mapped.push(next);
      }
    }
  }
  return mapped;
}

/**
 * Plan before touching cells. Index only incoming merged cells, whose area is
 * bounded by the copied block; scan existing merges once rather than comparing
 * every pasted merge with every existing merge.
 */
export function planPasteMerges(existing, incoming) {
  if (!incoming?.length) return { next: existing, ranges: [] };
  const occupied = new Map();
  const bounds = { r1: Infinity, c1: Infinity, r2: -1, c2: -1 };
  for (const m of incoming) {
    if (!valid(m)) return { error: 'invalid' };
    bounds.r1 = Math.min(bounds.r1, m.r1); bounds.c1 = Math.min(bounds.c1, m.c1);
    bounds.r2 = Math.max(bounds.r2, m.r2); bounds.c2 = Math.max(bounds.c2, m.c2);
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) {
      const k = key(r, c);
      if (occupied.has(k)) return { error: 'overlap' };
      occupied.set(k, m);
    }
  }
  const removed = new Set(), retained = new Set(), overlaps = [];
  let displacedAnchor = false;
  for (const old of existing) {
    const hit = intersection(old, bounds);
    if (!hit) continue;
    const touched = new Set();
    for (let r = hit.r1; r <= hit.r2; r++) for (let c = hit.c1; c <= hit.c2; c++) {
      const m = occupied.get(key(r, c));
      if (m) touched.add(m);
    }
    for (const m of touched) {
      // A paste at an existing merge's anchor is a paste into
      // that cell, retaining its dimensions even for a larger source.
      // Merges elsewhere wholly covered by the source give way; crossing
      // edges refuse. A source fitting inside a larger merge also keeps it.
      if (old.r1 === m.r1 && old.c1 === m.c1 || contains(old, m)) {
        retained.add(m);
        displacedAnchor ||= old.r1 !== m.r1 || old.c1 !== m.c1;
      }
      overlaps.push([old, m]);
    }
  }
  for (const [old, m] of overlaps) {
    if (retained.has(m)) continue;
    if (contains(m, old)) removed.add(old);
    else return { error: 'overlap' };
  }
  const ranges = incoming.filter(m => !retained.has(m));
  const remaining = existing.filter(m => !removed.has(m));
  return { next: [...remaining, ...ranges], remaining, ranges, displacedAnchor,
    retainedBody: (r, c) => { const m = occupied.get(key(r, c)); return !!m && retained.has(m) && (r !== m.r1 || c !== m.c1); } };
}


/** Formats replace the layout of the whole copied rectangle, including unmerged cells. */
export function planFormatPasteMerges(existing, incoming, block) {
  if (!valid(block)) return { error: 'invalid' };
  const remaining = [];
  for (const m of existing) {
    if (!intersection(m, block)) remaining.push(m);
    else if (!contains(block, m)) return { error: 'overlap' };
  }
  const plan = planPasteMerges(remaining, incoming);
  if (plan.error) return plan;
  const name = m => `${m.r1},${m.c1},${m.r2},${m.c2}`;
  const previous = new Set(existing.map(name));
  return { ...plan, changed: plan.next.length !== existing.length || plan.next.some(m => !previous.has(name(m))) };
}
