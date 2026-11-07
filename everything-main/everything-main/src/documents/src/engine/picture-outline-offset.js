import { compoundContourPoints } from './compound-outlines.js';

const area = points => points.reduce((sum, p, i) => {
  const q = points[(i + 1) % points.length];
  return sum + p[0] * q[1] - q[0] * p[1];
}, 0);
function contains(points, [x, y]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// A picture's outline centerline is offset by half a physical pen width.
// Offset edges, not the bounding rectangle: triangles and holes differ.
export function offsetPictureContours(contours, distance) {
  return contours.map((raw, index) => {
    const points = raw.filter((p, i) => {
      const q = raw[(i + raw.length - 1) % raw.length];
      return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-8;
    });
    if (points.length < 3 || !distance) return points;
    const depth = contours.filter((other, i) => i !== index && Math.abs(area(other)) > Math.abs(area(points)) && contains(other, points[0])).length;
    const direction = (area(points) >= 0 ? 1 : -1) * (depth % 2 ? -1 : 1);
    const edges = points.map((p, i) => {
      const q = points[(i + 1) % points.length], dx = q[0] - p[0], dy = q[1] - p[1], length = Math.hypot(dx, dy);
      return { x: dx / length, y: dy / length, nx: direction * dy / length * distance, ny: -direction * dx / length * distance };
    });
    return points.flatMap((p, i) => {
      const a = edges[(i + edges.length - 1) % edges.length], b = edges[i];
      const cross = a.x * b.y - a.y * b.x;
      if (Math.abs(cross) < 1e-10) return [[p[0] + b.nx, p[1] + b.ny]];
      const t = ((b.nx - a.nx) * b.y - (b.ny - a.ny) * b.x) / cross;
      return [[p[0] + a.nx + t * a.x, p[1] + a.ny + t * a.y]];
    });
  });
}

export function pictureOutlineContours(path, width, height, matrix, pixelsPerPoint, pen) {
  return offsetPictureContours(compoundContourPoints(path, width, height, matrix, pixelsPerPoint), pen / 2);
}
