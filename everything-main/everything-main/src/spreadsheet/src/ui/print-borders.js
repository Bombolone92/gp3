import { compareBorderPaint } from '../core/shared-borders.js';

/** Cell borders are vector rules in printed worksheets. CSS borders snap to
 * screen pixels before zoom, losing both physical weights and thin/medium
 * distinctions. Keep the table's existing layout, and paint its resolved edges
 * in SVG after fitting and fragmentation. */
const SVG = 'http://www.w3.org/2000/svg';
const POINT = 96 / 72;
const rank = { dotted: 1, dashed: 2, solid: 3, double: 4 };
let maskId = 0;
const mergedBorders = new WeakMap();
export const setMergedPrintBorders = (cell, borders) => mergedBorders.set(cell, borders);
export function copyMergedPrintBorders(source, target) {
  if (mergedBorders.has(source)) mergedBorders.set(target, mergedBorders.get(source));
}
const compare = (a, b) => Number(a.explicit) - Number(b.explicit) || compareBorderPaint(a, b) || a.order - b.order;

/** Split overlapping edges at every endpoint, including merged-cell sides.
 * Wider rules take priority, then double/solid/dashed/dotted, and the
 * lower/right cell wins equal rules. Implicit gridlines never obscure a rule. */
export function collapsePrintBorders(edges) {
  const groups = new Map(), result = [];
  for (const edge of edges) {
    if (!(edge.end > edge.start) || !(edge.width > 0)) continue;
    const key = `${edge.axis}:${edge.at}`;
    const group = groups.get(key) || []; group.push(edge); groups.set(key, group);
  }
  for (const group of groups.values()) {
    const events = new Map();
    for (const edge of group) for (const [at, key] of [[edge.start, 'add'], [edge.end, 'remove']]) {
      const event = events.get(at) || { add: [], remove: [] };
      event[key].push(edge); events.set(at, event);
    }
    const active = new Set(), stops = [...events.keys()].sort((a, b) => a - b);
    for (let i = 0; i < stops.length - 1; i++) {
      const start = stops[i], event = events.get(start);
      for (const edge of event.remove) active.delete(edge);
      for (const edge of event.add) active.add(edge);
      let winner;
      for (const edge of active) if (!winner || compare(edge, winner) > 0) winner = edge;
      if (winner) result.push({ ...winner, start, end: stops[i + 1] });
    }
  }
  return result.sort(compare);
}

function svgNode(tag, attrs) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Physical rules and their centerlines in a supplied coordinate system. */
export function cellPrintBorders(cell, rect, order = 0) {
  const css = getComputedStyle(cell), edges = [];
  const merged = mergedBorders.get(cell);
  for (const [side, axis, at, start, end] of [
    ['Top', 'h', rect.top, rect.left, rect.right], ['Bottom', 'h', rect.bottom, rect.left, rect.right],
    ['Left', 'v', rect.left, rect.top, rect.bottom], ['Right', 'v', rect.right, rect.top, rect.bottom],
  ]) {
    const style = css[`border${side}Style`], color = css[`border${side}Color`];
    if (!rank[style] || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') continue;
    const raw = cell.style[`border${side}Width`], explicit = !!raw;
    if (merged && explicit) continue;
    // Native thin/medium/thick rules are 1/2/3 points before print scaling
    // (measured in PDF exports at 100%, 75%, and 50%). Screen borderCss encodes
    // those weights in pixels. Implicit gridlines keep their CSS-pixel weight.
    const width = explicit ? parseFloat(raw) * POINT : 1;
    edges.push({ axis, at, start, end, width, style, color, explicit, order });
  }
  for (const segment of merged || []) {
    const horizontal = segment.side === 'bt' || segment.side === 'bb';
    const start = horizontal ? rect.left : rect.top, length = horizontal ? rect.right - rect.left : rect.bottom - rect.top;
    edges.push({ axis: horizontal ? 'h' : 'v', at: rect[{ bt: 'top', bb: 'bottom', bl: 'left', br: 'right' }[segment.side]],
      start: start + segment.start * length, end: start + segment.end * length,
      width: parseFloat(segment.width) * POINT, style: segment.style, color: segment.color || '#000', explicit: true, order });
  }
  return edges;
}

export function clipPrintBorderEdges(edges, bounds) {
  return bounds ? edges.flatMap(edge => {
    const horizontal = edge.axis === 'h';
    if (edge.at < bounds[horizontal ? 'top' : 'left'] || edge.at > bounds[horizontal ? 'bottom' : 'right']) return [];
    const start = Math.max(edge.start, bounds[horizontal ? 'left' : 'top']);
    const end = Math.min(edge.end, bounds[horizontal ? 'right' : 'bottom']);
    return end > start ? [{ ...edge, start, end }] : [];
  }) : edges;
}

/** Ink bounds include perpendicular half-strokes and solid/double end caps. */
export function printBorderInkBounds(edges) {
  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const e of edges) {
    const half = e.width / 2, cap = e.style === 'solid' || e.style === 'double' ? half : 0;
    const horizontal = e.axis === 'h';
    bounds.left = Math.min(bounds.left, horizontal ? e.start - cap : e.at - half);
    bounds.right = Math.max(bounds.right, horizontal ? e.end + cap : e.at + half);
    bounds.top = Math.min(bounds.top, horizontal ? e.at - half : e.start - cap);
    bounds.bottom = Math.max(bounds.bottom, horizontal ? e.at + half : e.end + cap);
  }
  return bounds;
}

/** Paint only laid-out page fragments; never mutate workbook/style data. */
export function paintPrintBorders(sheet) {
  const table = sheet.querySelector('.print-table.has-print-borders');
  if (!table || table.classList.contains('print-vector-borders')) return;
  const frame = table.getBoundingClientRect(), origin = sheet.getBoundingClientRect();
  if (!(frame.width > 0 && frame.height > 0)) return;
  const scale = Number(sheet.style.zoom) || 1, edges = [];
  const clip = sheet.parentElement?.matches('.print-page-clip') ? sheet.parentElement : null;
  const clipRect = clip?.getBoundingClientRect();
  const bounds = clipRect && { left: (clipRect.left - frame.left) / scale, right: (clipRect.right - frame.left) / scale,
    top: (clipRect.top - frame.top) / scale, bottom: (clipRect.bottom - frame.top) / scale };
  let order = 0;
  for (const row of table.rows) for (const cell of row.cells) {
    const r = cell.getBoundingClientRect();
    edges.push(...cellPrintBorders(cell, { left: (r.left - frame.left) / scale, right: (r.right - frame.left) / scale,
      top: (r.top - frame.top) / scale, bottom: (r.bottom - frame.top) / scale }, order++));
  }
  const resolved = collapsePrintBorders(clipPrintBorderEdges(edges, bounds));
  if (!resolved.length) return;
  // Keep every SVG and its mask limited to this fragment's painted bounds.
  const pad = resolved.reduce((max, edge) => Math.max(max, edge.width / 2), 0);
  const left = bounds?.left || 0, top = bounds?.top || 0, x = left - pad, y = top - pad;
  const width = (bounds ? bounds.right - bounds.left : frame.width / scale) + pad * 2;
  const height = (bounds ? bounds.bottom - bounds.top : frame.height / scale) + pad * 2;
  const svg = svgNode('svg', { class: 'print-cell-borders', width, height, viewBox: `${x} ${y} ${width} ${height}`,
    'aria-hidden': 'true', focusable: 'false' });
  Object.assign(svg.style, { position: 'absolute', left: `${(frame.left - origin.left) / scale + x}px`,
    top: `${(frame.top - origin.top) / scale + y}px`,
    overflow: 'hidden', pointerEvents: 'none' });
  // One path per paint style keeps large bordered sheets compact. Each edge
  // remains an independent subpath, preserving dash starts at cell boundaries.
  const groups = new Map();
  for (const edge of resolved) {
    const key = JSON.stringify([edge.width, edge.style, edge.color, edge.explicit]);
    const group = groups.get(key) || { ...edge, parts: [] };
    group.parts.push(edge.axis === 'h' ? `M${edge.start} ${edge.at}H${edge.end}` : `M${edge.at} ${edge.start}V${edge.end}`);
    groups.set(key, group);
  }
  for (const group of [...groups.values()].sort(compare)) {
    const attrs = { d: group.parts.join(''), fill: 'none', stroke: group.color, 'stroke-width': group.width,
      'stroke-linecap': group.style === 'solid' || group.style === 'double' ? 'square' : 'butt' };
    if (group.style === 'dashed' || group.style === 'dotted') attrs['stroke-dasharray'] =
      `${group.width * (group.style === 'dashed' ? 3 : 1)} ${group.width}`;
    if (group.style === 'double') {
      // Subtract a transparent middle stripe from the joined outer strokes.
      // This preserves cell fills through the gap, including boxed corners.
      const id = `print-double-border-${++maskId}`, mask = svgNode('mask', { id, maskUnits: 'userSpaceOnUse',
        x: x - group.width, y: y - group.width, width: width + group.width * 2, height: height + group.width * 2 });
      mask.append(svgNode('rect', { x: x - group.width, y: y - group.width, width: width + group.width * 2,
        height: height + group.width * 2, fill: 'white' }),
      svgNode('path', { ...attrs, stroke: 'black', 'stroke-width': group.width / 3 }));
      const defs = svgNode('defs', {}); defs.append(mask); svg.append(defs);
      attrs.mask = `url(#${id})`;
    }
    svg.append(svgNode('path', attrs));
  }
  if (clipRect) {
    // A rule is centered on a cell edge, so its outer half may extend past
    // the fragment. Clip content/drawings separately, and restrict border
    // centerlines above; clipping the whole fragment cuts double rules in half.
    for (const child of sheet.children) {
      const rect = child.getBoundingClientRect();
      child.style.clipPath = `inset(${(clipRect.top - rect.top) / scale}px ${(rect.right - clipRect.right) / scale}px ${(rect.bottom - clipRect.bottom) / scale}px ${(clipRect.left - rect.left) / scale}px)`;
    }
    // Keep large off-page table spacers out of print shrink-to-fit geometry.
    // Only the border paint can reach this derived half-stroke allowance.
    clip.style.contain = 'strict';
    clip.style.overflow = 'clip';
    clip.style.overflowClipMargin = `${pad * scale}px`;
  }
  // Retain the collapsed table geometry without painting CSS's snapped rules.
  for (const row of table.rows) for (const cell of row.cells) cell.style.borderColor = 'transparent';
  table.classList.add('print-vector-borders');
  table.after(svg);
}
