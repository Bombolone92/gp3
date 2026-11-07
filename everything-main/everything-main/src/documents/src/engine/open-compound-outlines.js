// Directed compound bands use physical coordinates. Offset each side of an
// open contour independently; closing its centerline invents an extra edge.
function side(path, points, offset, outline, reverse = false) {
  const p = reverse ? [...points].reverse() : points;
  const distance = reverse ? -offset : offset;
  const edges = p.slice(1).map((q, i) => {
    const dx = q[0] - p[i][0], dy = q[1] - p[i][1], length = Math.hypot(dx, dy);
    return { x: dx / length, y: dy / length };
  });
  const shifted = (v, e) => [v[0] - e.y * distance, v[1] + e.x * distance];
  const start = shifted(p[0], edges[0]);
  path[reverse ? 'lineTo' : 'moveTo'](...start);
  for (let i = 1; i < p.length - 1; i++) {
    const a = edges[i - 1], b = edges[i], v = p[i];
    const from = shifted(v, a), to = shifted(v, b);
    const cross = a.x * b.y - a.y * b.x, dot = a.x * b.x + a.y * b.y;
    if (Math.abs(cross) < 1e-10 && dot > 0) { path.lineTo(...to); continue; }
    const t = Math.abs(cross) > 1e-10 ? ((to[0] - from[0]) * b.y - (to[1] - from[1]) * b.x) / cross : Infinity;
    const intersection = [from[0] + t * a.x, from[1] + t * a.y];
    const outer = cross * distance < 0 || dot < -1 + 1e-10;
    if (!outer && Number.isFinite(t)) path.lineTo(...intersection);
    else if ((outline.join || 'round') === 'round' && distance) {
      path.lineTo(...from);
      path.arc(v[0], v[1], Math.abs(distance), Math.atan2(from[1] - v[1], from[0] - v[0]),
        Math.atan2(to[1] - v[1], to[0] - v[0]), distance > 0);
    } else if (outline.join === 'miter' && Number.isFinite(t) &&
      Math.hypot(intersection[0] - v[0], intersection[1] - v[1]) <= Math.abs(distance) * (outline.miterLimit || 10)) {
      path.lineTo(...intersection);
    } else { path.lineTo(...from); path.lineTo(...to); }
  }
  path.lineTo(...shifted(p.at(-1), edges.at(-1)));
}

export function openCompoundPath(contours, outline, pen) {
  const result = new Path2D();
  const bands = { dbl: [[-.5, -1/6], [1/6, .5]], tri: [[-.5, -1/3], [-1/6, 1/6], [1/3, .5]],
    thickThin: [[-.5, .1], [.3, .5]], thinThick: [[-.5, -.3], [-.1, .5]] }[outline.compound];
  for (const { points: raw, direction = 1 } of contours) {
    const points = raw.filter((p, i) => !i || Math.hypot(p[0] - raw[i-1][0], p[1] - raw[i-1][1]) > 1e-8).map(p => [...p]);
    if (points.length < 2) continue;
    const original = [points[0].slice(), points.at(-1).slice()];
    const unit = (a, b) => { const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy);return [dx/l,dy/l]; };
    const vectors = [unit(points[0], points[1]), unit(points.at(-2), points.at(-1))];
    if (outline.cap === 'sq') {
      for (const axis of [0, 1]) {
        points[0][axis] -= vectors[0][axis] * pen / 2;
        points.at(-1)[axis] += vectors[1][axis] * pen / 2;
      }
    }
    for (const band of bands) {
      const [low, high] = band.map(x => x * pen * direction).sort((a,b) => a-b);
      side(result, points, low, outline);
      side(result, points, high, outline, true);
      result.closePath();
    }
    if (outline.cap === 'rnd') {
      // A single outer semicircle closes all bands. Internal gaps end flat.
      for (let i=0;i<2;i++) {
        const [x,y]=original[i], [dx,dy]=vectors[i], angle=Math.atan2(dy,dx);
        const start=angle+(i ? -Math.PI/2 : Math.PI/2);
        result.moveTo(x+Math.cos(start)*pen/2,y+Math.sin(start)*pen/2);
        result.arc(x,y,pen/2,start,start+Math.PI);
        result.closePath();
      }
    }
  }
  return result;
}
