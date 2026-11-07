import { joinTableBorderCorner, joinTableBorderCrossing } from './table-border-corners.js';

// Display geometry only. Authored widths still decide intersection ownership;
// two unequal declarations can round to the same device-pixel thickness.
export function deviceTableBorders(ctx, borders) {
  const m = ctx.getTransform?.();
  if (!m || m.b || m.c || !(m.a > 0 && m.d > 0)) return borders;
  const sx = v => Number.isFinite(v) ? (Math.round(v * m.a + m.e) - m.e) / m.a : v;
  const sy = v => Number.isFinite(v) ? (Math.round(v * m.d + m.f) - m.f) / m.d : v;
  const key = (s, p) => [s.tableId, s.pageStory, s.page, s.column ?? 0,
    Math.round((s.x + p.x) * 1e6), Math.round((s.y + p.y) * 1e6)].join(':');
  const corners = new Map(), caps = [];
  const result = borders.map(s => {
    if (s.guide) return s;
    const r = { ...s, logicalThickness: s.horizontal ? s.height : s.width };
    // Copy mutable join geometry even for compound borders adjoining a single.
    if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => [...pair]);
    if (s.bandCaps) r.bandCaps = { ...s.bandCaps };
    delete r.crossingCuts;
    if (s.border.style === 'single') {
      r.x = sx(s.x); r.y = sy(s.y);
      r.width = s.horizontal ? sx(s.x + s.width) - r.x : Math.max(1, Math.floor(s.width * m.a + 1e-6)) / m.a;
      r.height = s.horizontal ? Math.max(1, Math.floor(s.height * m.d + 1e-6)) / m.d : sy(s.y + s.height) - r.y;
      if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? sx(s.x + v) - r.x : sy(s.y + v) - r.y));
      if (s.cellClip) r.cellClip = Object.fromEntries(Object.entries(s.cellClip).map(([k, v]) => [k, ['left', 'right'].includes(k) ? sx(v) : sy(v)]));
    }
    for (const p of s.junctions || []) {
      const k = key(s, p);
      if (!corners.has(k)) corners.set(k, []);
      corners.get(k).push({ stroke: r, first: p.first });
    }
    if (s.junctionCap) caps.push({ stroke: r, key: key(s, s.junctionCap) });
    return r;
  });
  for (const edges of corners.values()) {
    joinTableBorderCorner(edges);
    joinTableBorderCrossing(edges);
  }
  // Hidden merged-cell transitions have a short horizontal cap rather than a
  // full logical edge. Rebuild its subtraction mask using the same painted box.
  for (const { stroke: cap, key } of caps) for (const { stroke } of corners.get(key) || []) if (!stroke.horizontal) {
    (stroke.crossingCuts ||= []).push({ x: cap.x - stroke.x, y: cap.y - stroke.y, width: cap.width, height: cap.height });
  }
  return result;
}
