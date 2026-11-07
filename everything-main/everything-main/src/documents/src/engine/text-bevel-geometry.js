// Geometry for the text 3D path. This does not change ordinary text painting,
// glyph advances, shaping, or the font's saved outline data.
const clamp = value => Math.max(-1, Math.min(1, value));

// Paired crossings describe even-odd filled spans, including concave or
// self-intersecting offset faces. Horizontal edges use the same half-open
// vertex convention as the point-in-polygon rule.
export function bevelScanlineCrossings(polygon, y) {
  const crossings = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.y > y) !== (b.y > y)) crossings.push((b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x);
  }
  return crossings.sort((a, b) => a - b);
}

function checkedContours(contours) {
  if (!Array.isArray(contours) || contours.some(c => !Array.isArray(c) || c.length < 2 ||
    c.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || typeof p.onCurve !== 'boolean')))
    throw new Error('Invalid glyph contours.');
}

// Apply the directional expansion to the actual font points, including the
// off-curve controls. An implied on-curve midpoint is formed AFTER expansion;
// expanding that midpoint independently changes quadratic curves.
// Coordinates point downwards. interiorLeft identifies the font's contour
// convention, shared by outer contours and their oppositely wound holes.
export function emboldenGlyphContours(contours, { scale = 1, strengthX, strengthY, interiorLeft = true }) {
  checkedContours(contours);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(strengthX) || strengthX < 0 ||
      !Number.isFinite(strengthY) || strengthY < 0 || typeof interiorLeft !== 'boolean')
    throw new Error('Invalid glyph expansion.');
  const sign = interiorLeft ? 1 : -1;
  return contours.map(contour => contour.map((point, i) => {
    const direction = step => {
      for (let j = 1; j < contour.length; j++) {
        const other = contour[(i + step * j + contour.length) % contour.length];
        const x = (other.x - point.x) * step, y = (other.y - point.y) * step;
        const length = Math.hypot(x, y);
        if (length) return [sign * y / length, -sign * x / length];
      }
      return [0, 0];
    };
    const before = direction(-1), after = direction(1);
    const denominator = 1 + before[0] * after[0] + before[1] * after[1];
    // A reversal has no finite miter. Keep its averaged direction bounded,
    // as at an ordinary sharp corner; never introduce an infinite spike.
    const divisor = Math.max(denominator, 1e-12);
    const x = clamp((before[0] + after[0]) / divisor);
    const y = clamp((before[1] + after[1]) / divisor);
    return { ...point, x: point.x * scale + (x + 1) * strengthX / 2,
      y: point.y * scale + (y - 1) * strengthY / 2 };
  }));
}

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// Decode TrueType's explicit/off-curve point sequence without inventing a
// corner at each quadratic segment. Returns closed polygon contours with no
// duplicate closing vertex. Tolerance is in the input coordinate system.
export function flattenGlyphContours(contours, tolerance) {
  checkedContours(contours);
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Invalid curve tolerance.');
  return contours.map(contour => {
    const first = contour[0], last = contour.at(-1);
    const start = first.onCurve ? first : last.onCurve ? last : midpoint(last, first);
    const points = [{ x: start.x, y: start.y }];
    const append = p => { const previous = points.at(-1); if (p.x !== previous.x || p.y !== previous.y) points.push({ x: p.x, y: p.y }); };
    const quadratic = (a, control, b, depth = 0) => {
      // The quadratic-to-chord midpoint displacement bounds the maximum
      // deviation. Subdivision also handles coincident start/end points.
      if (depth === 20 || Math.hypot(a.x - 2 * control.x + b.x, a.y - 2 * control.y + b.y) / 4 <= tolerance) { append(b); return; }
      const left = midpoint(a, control), right = midpoint(control, b), center = midpoint(left, right);
      quadratic(a, left, center, depth + 1); quadratic(center, right, b, depth + 1);
    };
    const remaining = first.onCurve ? contour.slice(1) : last.onCurve ? contour.slice(0, -1) : contour.slice();
    remaining.push({ ...start, onCurve: true });
    let previous = start, control;
    for (const point of remaining) {
      if (point.onCurve) {
        if (control) quadratic(previous, control, point); else append(point);
        previous = point; control = undefined;
      } else {
        if (control) { const end = midpoint(control, point); quadratic(previous, control, end); previous = end; }
        control = point;
      }
    }
    if (points.length > 1 && points.at(-1).x === points[0].x && points.at(-1).y === points[0].y) points.pop();
    return points;
  });
}
