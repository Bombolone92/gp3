// Original implementation of MT19937 and the curved straight-edge construction
// and ellipse perturbation recovered from project-authored reference controls.
// No external engine code.
function randomWords(seed) {
  const state = new Uint32Array(624);
  state[0] = seed;
  for (let i = 1; i < 624; i++) state[i] = Math.imul(1812433253, state[i - 1] ^ (state[i - 1] >>> 30)) + i;
  let index = 624;
  return () => {
    if (index === 624) {
      for (let i = 0; i < 624; i++) {
        const bits = (state[i] & 0x80000000) | (state[(i + 1) % 624] & 0x7fffffff);
        state[i] = state[(i + 397) % 624] ^ (bits >>> 1) ^ (bits & 1 ? 0x9908b0df : 0);
      }
      index = 0;
    }
    let value = state[index++];
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    return (value ^ (value >>> 18)) >>> 0;
  };
}

export function curvedSketchRectangle(width, height, seed) {
  if (Math.min(width, height) < 10000) width = height = 10000;
  const next = randomWords(seed);
  const contour = () => {
    const points = [['M', 0, 0]];
    for (const [x, y, tx, ty, length] of [[0, 0, 1, 0, width], [width, 0, 0, 1, height], [width, height, -1, 0, width], [0, height, 0, -1, height]]) {
      const curve = ['C'];
      // Keep the subtraction: replacing this by .4 * length changes rounding
      // after the floating remainder, including at integer half coordinates.
      const range = .5 * length - .1 * length + 1;
      for (const start of [.1, .5]) {
        const along = start * length + next() % range;
        const normal = -.09 * length + next() % (.18 * length);
        curve.push(Math.round(x + tx * along - ty * normal), Math.round(y + ty * along + tx * normal));
      }
      curve.push(x + tx * length, y + ty * length);
      points.push(curve);
    }
    points.push(['Z']);
    return { width, height, points };
  };
  // The fill draws are consumed first but the stroke is serialized first.
  const fill = contour(), stroke = contour();
  return [{ ...stroke, fill: false, stroke: true }, { ...fill, fill: true, stroke: false }];
}

export function curvedSketchEllipse(width, height, seed) {
  const next = randomWords(seed);
  // Native arcs round the radii before forming the integer cubic controls. For
  // odd extents, the final right/bottom coordinate can exceed the viewport by 1.
  const radiusX = Math.round(width / 2), radiusY = Math.round(height / 2);
  // A small extent switches both axes to the standard 10000-unit path grid.
  const small = Math.min(width, height) < 10000;
  const pathWidth = small ? 10000 : width, pathHeight = small ? 10000 : height;
  const sx = pathWidth / width, sy = pathHeight / height;
  const rx = Math.round(radiusX * sx), ry = Math.round(radiusY * sy);
  const w = 2 * rx, h = 2 * ry;
  const k = 4 / 3 * Math.tan(Math.PI / 8);
  const x = Math.round(rx * (1 - k)), y = Math.round(ry * (1 - k));
  const segments = [[[0, y], [x, 0], [rx, 0]], [[w - x, 0], [w, y], [w, ry]], [[w, h - y], [w - x, h], [rx, h]], [[x, h], [0, h - y], [0, ry]]];
  const contour = () => {
    const points = [['M', 0, ry]];
    for (const [first, second, end] of segments) {
      const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const radiusLimit = .2 * Math.min(distance(first, second), distance(second, end)) + 1;
      const curve = ['C'];
      for (const [px, py] of [first, second]) {
        const radius = .06 * radiusLimit + next() % (.94 * radiusLimit);
        const angle = next() % (2 * Math.PI);
        curve.push(Math.round(px + radius * Math.cos(angle)), Math.round(py + radius * Math.sin(angle)));
      }
      points.push([...curve, ...end]);
    }
    points.push(['Z']);
    return { width: pathWidth, height: pathHeight, points };
  };
  const fill = contour(), stroke = contour();
  return [{ ...stroke, fill: false, stroke: true }, { ...fill, fill: true, stroke: false }];
}
