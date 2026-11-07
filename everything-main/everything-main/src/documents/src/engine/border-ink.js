// Intersect a convex border corner with an ink band before rasterization.
// Clipping an already bounded fill through the same antialiased outline would
// multiply edge coverage and make thin borders lighter than their source color.
export function borderInkPolygon(polygon, box, cellClip) {
  const { x, y, width, height } = box;
  let points = polygon || [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
  const top = Math.max(y, cellClip?.top ?? y), bottom = Math.min(y + height, cellClip?.bottom ?? y + height);
  if (width <= 0 || bottom <= top) return [];
  for (const [axis, edge, direction] of [[0, x, 1], [0, x + width, -1], [1, top, 1], [1, bottom, -1]]) {
    const output = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      const aInside = direction * (a[axis] - edge) >= 0, bInside = direction * (b[axis] - edge) >= 0;
      if (aInside) output.push(a);
      if (aInside !== bInside) {
        const ratio = (edge - a[axis]) / (b[axis] - a[axis]), other = 1 - axis;
        const point = []; point[axis] = edge; point[other] = a[other] + ratio * (b[other] - a[other]); output.push(point);
      }
    }
    points = output;
  }
  return points;
}

export function containsBorderDot(points, x, y, radius) {
  if (points.length < 3) return false;
  const area = points.reduce((n, a, i) => { const b = points[(i + 1) % points.length]; return n + a[0] * b[1] - b[0] * a[1]; }, 0);
  if (!area) return false;
  const direction = Math.sign(area);
  // Only absorb floating-point error at a tangent; do not enlarge ink geometry.
  const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(x), Math.abs(y), radius);
  return points.every((a, i) => {
    const b = points[(i + 1) % points.length], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    return !length || direction * (dx * (y - a[1]) - dy * (x - a[0])) / length >= radius - tolerance;
  });
}
