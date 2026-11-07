import { borderBands } from './border-patterns.js';

const compoundFamily = {
  thinThickSmallGap: 'small', thickThinSmallGap: 'small',
  thinThickMediumGap: 'medium', thickThinMediumGap: 'medium',
};

// The wider single border gets the cross-junction area. Equal widths
// belong to the horizontal border, independently of the two colors. Remove
// that area from the losing ink rather than relying on stroke insertion order.
export function joinTableBorderCrossing(edges) {
  if (![3, 4].includes(edges.length) || edges.some(e => e.stroke.guide || e.stroke.border.style !== 'single')) return;
  const horizontal = edges.filter(e => e.stroke.horizontal), vertical = edges.filter(e => !e.stroke.horizontal);
  if (!horizontal.length || !vertical.length || horizontal.length > 2 || vertical.length > 2 ||
    horizontal.length === 2 && horizontal[0].first === horizontal[1].first ||
    vertical.length === 2 && vertical[0].first === vertical[1].first) return;
  // An unchanged vertical border remains continuous at a T-junction. When
  // its format changes, the horizontal cap extends across the transition.
  if (horizontal.length === 1) {
    const {stroke: h, first} = horizontal[0];
    const [a,b] = vertical.map(e=>e.stroke);
    const continuous = (a.logicalThickness ?? a.width) === (b.logicalThickness ?? b.width) && ['style','color','frame','shadow'].every(key=>a.border[key]===b.border[key]);
    h.bandEnds ||= [[0, h.width]];
    h.bandEnds[0][first ? 0 : 1] = (continuous ? first ? a.x+a.width : a.x : first ? Math.min(a.x,b.x) : Math.max(a.x+a.width,b.x+b.width)) - h.x;
    if (continuous) return;
  }
  // The same continuity rule applies to an outer horizontal edge: a wider
  // interior vertical border ends at its inside edge rather than cutting it.
  if (vertical.length === 1) {
    const {stroke: v, first} = vertical[0];
    const [a,b] = horizontal.map(e=>e.stroke);
    const continuous = (a.logicalThickness ?? a.height) === (b.logicalThickness ?? b.height) && ['style','color','frame','shadow'].every(key=>a.border[key]===b.border[key]);
    if (continuous) {
      v.bandEnds ||= [[0, v.height]];
      v.bandEnds[0][first ? 0 : 1] = a.y + (first ? a.height : 0) - v.y;
      return;
    }
  }
  for (const {stroke: h} of horizontal) for (const {stroke: v} of vertical) {
    const [winner, loser] = (h.logicalThickness ?? h.height) >= (v.logicalThickness ?? v.width) ? [h, v] : [v, h];
    const clip = winner.cellClip;
    const left = Math.max(winner.x + (winner.horizontal ? winner.bandEnds?.[0]?.[0] || 0 : 0), clip?.left ?? -Infinity), right = Math.min(winner.x + (winner.horizontal ? winner.bandEnds?.[0]?.[1] ?? winner.width : winner.width), clip?.right ?? Infinity);
    const top = Math.max(winner.y, clip?.top ?? -Infinity), bottom = Math.min(winner.y + winner.height, clip?.bottom ?? Infinity);
    // Store cuts relative to the stroke so header/footer translation preserves them.
    if (right > left && bottom > top) (loser.crossingCuts ||= []).push({x: left-loser.x, y: top-loser.y, width: right-left, height: bottom-top});
  }
}

/** Join corresponding continuous bands at a two-edge table corner. Keep each
 * stroke's layout box intact; band endpoints describe only the painted ink. */
export function joinTableBorderCorner(edges) {
  if (edges.length !== 2 || edges.some(e => e.stroke.guide) || edges[0].stroke.horizontal === edges[1].stroke.horizontal) return;
  const h = edges.find(e => e.stroke.horizontal), v = edges.find(e => !e.stroke.horizontal);
  const a = h.stroke, b = v.stroke, hb = borderBands(a.border, a.height, a.side);
  // In table corners the horizontal flag determines the right cap's
  // direction, independently of the vertical edge's own straight-body flag.
  const capBorder = b.bodyBands && b.side === 'right' ? { ...b.border, frame: a.border.frame } : b.border;
  const vb = borderBands(capBorder, b.width, b.side);
  if (!hb || !vb) return;
  if (b.bodyBands) (b.bandCaps ||= {})[v.first ? 'first' : 'last'] = { bands: vb, at: a.y + (v.first ? a.height : 0) - b.y };
  a.bandEnds ||= hb.map(() => [0, a.width]);
  b.bandEnds ||= vb.map(() => [0, b.height]);
  // Reversing thin/thick order preserves the pattern family: corners still join
  // outer and inner bands. Unrelated patterns or sizes retain square caps.
  const samePattern = a.border.style === b.border.style ||
    compoundFamily[a.border.style] && compoundFamily[a.border.style] === compoundFamily[b.border.style];
  if (!samePattern || a.border.size !== b.border.size) {
    for (const ends of a.bandEnds) ends[h.first ? 0 : 1] = b.x + (h.first ? 0 : b.width) - a.x;
    for (const ends of b.bandEnds) ends[v.first ? 0 : 1] = a.y + (v.first ? a.height : 0) - b.y;
    return;
  }
  for (let i = 0; i < hb.length; i++) {
    // Match outer to outer and inner to inner, regardless of global band order
    // or frame reversal. Compound strokes retain rectangular ink corners.
    const ring = v.first ? i : hb.length - 1 - i;
    const j = h.first ? ring : vb.length - 1 - ring;
    a.bandEnds[i][h.first ? 0 : 1] = b.x + vb[j][0] + (h.first ? 0 : vb[j][1]) - a.x;
    // Horizontal color owns the overlap, as the colored reference controls show.
    b.bandEnds[j][v.first ? 0 : 1] = a.y + hb[i][0] + (v.first ? hb[i][1] : 0) - b.y;
  }
}
