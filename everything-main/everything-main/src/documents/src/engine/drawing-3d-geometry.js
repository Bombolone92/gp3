// Original geometry primitives for DrawingML's extruded planar shapes.
// Coordinates are points, centered on the unextruded front face; +z faces the
// viewer and extrusion extends along -z. Appearance/lighting are separate.
export function projection3d({ turn = 0, fov = 45, perspective = true } = {}) {
  if (![turn, fov].every(Number.isFinite) || typeof perspective !== 'boolean') throw new Error('Invalid 3D camera.');
  const angle = (turn % 360) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const field = Math.max(.01, Math.min(Math.PI - .01, fov * Math.PI / 180));
  // The published open specifications give the camera magnitude as 6.28 / tan(FOV/2).
  // The picture scene uses inches; the independent two-size probe verifies
  // this mapping to document points rather than fitting distance to each shape.
  const distance = 6.28 * 72 / Math.tan(field / 2);
  const rotate = ([x, y, z]) => [c * x + s * z, y, -s * x + c * z];
  const inverse = ([x, y, z]) => [c * x - s * z, y, s * x + c * z];
  return {
    distance,
    project(point) {
      if (point.length !== 3 || !point.every(Number.isFinite)) throw new Error('Invalid 3D point.');
      const [x, y, z] = rotate(point);
      if (perspective && z >= distance) throw new Error('3D geometry crosses the camera plane.');
      const scale = perspective ? distance / (distance - z) : 1;
      return [x * scale, y * scale];
    },
    ray(x, y) {
      if (![x, y].every(Number.isFinite)) throw new Error('Invalid projected point.');
      return perspective
        ? { origin: inverse([0, 0, distance]), direction: inverse([x, y, -distance]) }
        : { origin: inverse([x, y, distance]), direction: inverse([0, 0, -1]) };
    },
    rotate,
  };
}

export function intersectExtrusion(ray, { width, height, depth = 0, geometry = 'rect' }) {
  if (![width, height, depth].every(Number.isFinite) || width <= 0 || height <= 0 || depth < 0 || !['rect', 'ellipse'].includes(geometry)) throw new Error('Invalid extruded shape.');
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.direction;
  if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite) || !(Math.hypot(dx, dy, dz) > 0)) throw new Error('Invalid 3D ray.');
  const rx = width / 2, ry = height / 2, epsilon = 1e-8;
  let best = null;
  const inside = (x, y) => geometry === 'rect'
    ? Math.abs(x) <= rx + epsilon && Math.abs(y) <= ry + epsilon
    : (x / rx) ** 2 + (y / ry) ** 2 <= 1 + epsilon;
  const add = (t, normal, surface) => {
    if (!Number.isFinite(t) || t < 0 || best && t >= best.t) return;
    best = { t, point: [ox + t * dx, oy + t * dy, oz + t * dz], normal, surface };
  };
  if (dz !== 0) for (const [z, normal, surface] of [[0, [0, 0, 1], 'front'], [-depth, [0, 0, -1], 'back']]) {
    const t = (z - oz) / dz;
    if (inside(ox + t * dx, oy + t * dy)) add(t, normal, surface);
  }
  if (depth > 0 && geometry === 'rect') {
    for (const axis of [0, 1]) {
      const origin = ray.origin[axis], direction = ray.direction[axis], extent = axis === 0 ? rx : ry;
      if (direction === 0) continue;
      for (const sign of [-1, 1]) {
        const t = (sign * extent - origin) / direction, z = oz + t * dz;
        const other = axis === 0 ? oy + t * dy : ox + t * dx;
        if (z >= -depth - epsilon && z <= epsilon && Math.abs(other) <= (axis === 0 ? ry : rx) + epsilon) add(t, axis === 0 ? [sign, 0, 0] : [0, sign, 0], 'side');
      }
    }
  } else if (depth > 0) {
    const a = (dx / rx) ** 2 + (dy / ry) ** 2;
    const b = 2 * (ox * dx / rx ** 2 + oy * dy / ry ** 2);
    const c = (ox / rx) ** 2 + (oy / ry) ** 2 - 1, disc = b * b - 4 * a * c;
    if (a > 0 && disc >= 0) for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
      const z = oz + t * dz;
      if (z < -depth - epsilon || z > epsilon) continue;
      const nx = (ox + t * dx) / rx ** 2, ny = (oy + t * dy) / ry ** 2, length = Math.hypot(nx, ny);
      add(t, [nx / length, ny / length, 0], 'side');
    }
  }
  return best;
}
