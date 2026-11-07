import { joinTableBorderCorner, joinTableBorderCrossing } from './table-border-corners.js';

// Paint geometry only. Authored widths still decide intersection ownership;
// two unequal declarations can round to the same screen or physical pen width.
export function deviceTableBorders(ctx, borders, printing = false, pageGeometry) {
  const m = ctx.getTransform?.();
  if (!m || m.b || m.c || !(m.a > 0 && m.d > 0)) return borders;
  const sx = v => Number.isFinite(v) ? (Math.round(v * m.a + m.e) - m.e) / m.a : v;
  const sy = v => Number.isFinite(v) ? (Math.round(v * m.d + m.f) - m.f) / m.d : v;
  // Native reference screen positions precede the authored whole-twip boundary. Logical
  // layout rounds coordinates to 1e-6 CSS px; tolerate that representation
  // error at an exact twip rather than selecting the following boundary.
  const preceding = v => (Math.ceil(v * 15 - 1e-5) - 1) / 15;
  const px = v => sx(preceding(v)), py = v => sy(preceding(v));
  const originKey = s => [s.tableId, s.pageStory, s.page, s.column ?? 0].join(':');
  const origins = new Map();
  for (const s of borders) if (!s.guide) {
    const k = originKey(s);
    origins.set(k, Math.min(origins.get(k) ?? Infinity, s.y));
  }
  const printWidth = printing ? pageGeometry?.width ?? ctx.canvas?.width / m.a : 0;
  const printXScale = printWidth > 0 ? 1 + .16 / printWidth : 1;
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
      if (printing) {
        // Native intermediate-width controls establish whole-twip truncation
        // before 600dpi pen quantization (3/8pt paints .24pt, not .36pt).
        // Source layout is retained. Vertical physical flow remains a separate
        // gap; screen snapping/clipping must not set physical pens.
        const wholeTwips = Math.floor(r.logicalThickness * 15 + 1e-5);
        const units = Math.max(1, Math.floor(wholeTwips / 2.4 + 1e-6));
        const thickness = units * .16;
        if (s.horizontal) r.height = thickness;
        else {
          // The inclusive 600dpi paper grid maps to 3000dpi coordinates
          // before removing the integral leading half of a vertical pen.
          // Paper-size/wide-grid controls disprove a fixed trailing twip.
          // Keep physical pen widths fixed rather than scaling both endpoints.
          const offset = m.e / m.a;
          const center = Math.round((s.x + s.width / 2 + offset) / .16) * .16;
          const projected = printWidth > 0 ? Math.round(center * printXScale / .032 + 1e-5) * .032 : center;
          const leading = projected - Math.ceil(units / 2) * .16;
          // Native PDF rectangle coordinates retain five significant digits
          // in points (36.024 is retained; 468.096 becomes 468.1).
          const point = leading * .75;
          const magnitude = Math.abs(point);
          const precision = magnitude >= 10 && magnitude < 1000 ? magnitude < 100 ? 1000 : 100
            : 10 ** (4 - Math.floor(Math.log10(magnitude || 1)));
          r.x = (printWidth > 0 ? Math.round(point * precision) / precision / .75 : leading) - offset;
          r.width = thickness;
        }
      } else {
        const pen = Math.floor((s.horizontal ? s.height * m.d : s.width * m.a) + 1e-6);
        r.x = px(s.x); r.y = py(s.y);
        // Horizontal grid bands advance from the rounded table frame,
        // rounding cumulative row offsets rather than each absolute boundary.
        if (s.horizontal) {
          const start = origins.get(originKey(s));
          r.y = py(start) + Math.round((s.y - start) * m.d) / m.d;
        }
        // A minimum-width vertical pen grows toward the leading side.
        if (!s.horizontal && pen === 0) r.x -= 1 / m.a;
        r.width = s.horizontal ? px(s.x + s.width) - r.x : Math.max(1, pen) / m.a;
        r.height = s.horizontal ? Math.max(1, pen) / m.d : py(s.y + s.height) - r.y;
        if (s.exposedBottom && s.horizontal) {
          const start = origins.get(originKey(s));
          if (pen > 1) {
            // Wide bodies advance from the rounded frame origin. The trailing
            // reference-grid clip can shorten a bottom without changing its top.
            r.y = py(start) + Math.round((s.y - start) * m.d) / m.d;
            const end = sy(Math.floor((s.y + s.height) / .16 + 1e-6) * .16);
            r.height = Math.max(1 / m.d, Math.min(r.height, end - r.y));
          } else if (pen === 0) {
            // Minimum-width bottom ink grows inward. Both absolute placement and
            // the rounded frame extent constrain it, including fractional zoom.
            // Layout stores 1e-6 px coordinates; retain an exact half-pixel tie.
            const end = Math.min(py(s.y + s.height), py(start) + Math.round((s.y + s.height - start) * m.d + 1e-6) / m.d);
            r.y = end - r.height;
          }
        }
        if (s.bandEnds) r.bandEnds = s.bandEnds.map(pair => pair.map(v => s.horizontal ? px(s.x + v) - r.x : py(s.y + v) - r.y));
        if (s.cellClip) r.cellClip = Object.fromEntries(Object.entries(s.cellClip).map(([k, v]) => [k, ['left', 'right'].includes(k) ? sx(v) : sy(v)]));
      }
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

/** Project solid cell shading with its painted frame. Borderless grid edges
 * advance from the rounded frame origin; source geometry is never mutated. */
export function deviceTableFillRects(ctx, cells, sourceBorders, paintedBorders, printing = false) {
  const filled = new Map(cells.filter(c => c.fill).map(c => [c.id, c])), result = new Map();
  if (!filled.size) return result;
  const m = printing ? null : ctx.getTransform?.();
  const aligned = m && !m.b && !m.c && m.a > 0 && m.d > 0;
  const frameKey = c => [c.tableId ?? c.id, c.pageStory, c.page, c.column ?? 0].join(':');
  const frameTops = new Map();
  if (aligned) for (const cell of cells) {
    const key = frameKey(cell);
    frameTops.set(key, Math.min(frameTops.get(key) ?? Infinity, cell.y));
  }
  const limits = new Map();
  if (aligned) for (const [i, s] of sourceBorders.entries()) if (!s.guide) {
    const r = paintedBorders[i];
    const boundary = s.horizontal ? s.y + (s.junctions?.[0]?.y ?? s.height / 2) : s.x + s.width / 2;
    for (const id of s.cellIds) {
      const cell = filled.get(id); if (!cell) continue;
      const bounds = limits.get(id) ?? {}; limits.set(id, bounds);
      if (s.horizontal) {
        if (Math.abs(boundary - cell.y) < 1e-6) bounds.top = Math.max(bounds.top ?? -Infinity, r.y);
        if (Math.abs(boundary - cell.y - cell.height) < 1e-6) bounds.bottom = Math.min(bounds.bottom ?? Infinity, r.y + r.height);
      } else {
        if (Math.abs(boundary - cell.x) < 1e-6) {
          bounds.left = Math.max(bounds.left ?? -Infinity, r.x);
          // The minimum vertical pen grows leftward. Its inner edge can be a
          // pixel before the independently rounded writing centerline. Shading
          // must meet that opaque edge, including on a shared cell boundary.
          if (s.border.style === 'single') bounds.leftInner = Math.min(bounds.leftInner ?? Infinity, r.x + r.width);
        }
        if (Math.abs(boundary - cell.x - cell.width) < 1e-6) bounds.right = Math.min(bounds.right ?? Infinity, r.x + r.width);
      }
    }
  }
  for (const [id, cell] of filled) {
    // The same logical shading interval as before display projection, including
    // wider opposing horizontal borders, explicit reserves and parent clips.
    let left = Math.max(cell.x, cell.cellClip?.left ?? -Infinity), right = Math.min(cell.x + cell.width, cell.cellClip?.right ?? Infinity);
    let top = Math.max(cell.y - (cell.borderInsets?.top || 0) + (cell.fillTopInset || 0), cell.cellClip?.top ?? -Infinity);
    let bottom = Math.min(cell.y + cell.height - (cell.borderInsets?.bottom || 0) - (cell.fillBottomInset || 0), cell.cellClip?.bottom ?? Infinity);
    if (aligned) {
      const sx = v => (Math.round(v * m.a + m.e) - m.e) / m.a, sy = v => (Math.round(v * m.d + m.f) - m.f) / m.d;
      const bounds = limits.get(id);
      if (!bounds) {
        // The borderless table origin is rounded before advancing along its
        // grid. Round cumulative offsets so adjacent cells share one edge,
        // including when a preceding column is unfilled or omitted in a row.
        const preceding = v => (Math.ceil(v * 15 - 1e-5) - 1) / 15;
        const offset = cell.tableOffsetX ?? 0, origin = sx(preceding(cell.x - offset));
        left = origin + Math.round(offset * m.a) / m.a;
        right = origin + Math.round((offset + cell.width) * m.a) / m.a;
        const start = cell.y - (cell.borderInsets?.top || 0) + (cell.fillTopInset || 0);
        const end = cell.y + cell.height - (cell.borderInsets?.bottom || 0) - (cell.fillBottomInset || 0);
        const frameTop = frameTops.get(frameKey(cell)), originY = sy(preceding(frameTop));
        const edgeY = v => Math.min(sy(preceding(v)), originY + Math.round((v - frameTop) * m.d) / m.d);
        top = edgeY(start); bottom = edgeY(end);
        left = Math.max(left, cell.cellClip?.left === undefined ? -Infinity : sx(cell.cellClip.left));
        right = Math.min(right, cell.cellClip?.right === undefined ? Infinity : sx(cell.cellClip.right));
        top = Math.max(top, cell.cellClip?.top === undefined ? -Infinity : sy(cell.cellClip.top));
        bottom = Math.min(bottom, cell.cellClip?.bottom === undefined ? Infinity : sy(cell.cellClip.bottom));
      }
      left = Math.max(Math.min(sx(left), bounds?.leftInner ?? Infinity), bounds?.left ?? -Infinity,
        cell.cellClip?.left === undefined ? -Infinity : sx(cell.cellClip.left));
      right = Math.min(sx(right), bounds?.right ?? Infinity);
      top = Math.max(sy(top), bounds?.top ?? -Infinity); bottom = Math.min(sy(bottom), bounds?.bottom ?? Infinity);
    }
    result.set(id, { x: left, y: top, width: right - left, height: bottom - top });
  }
  return result;
}
