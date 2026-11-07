import { shapePathScale } from './shape-path-scale.js';

// An open path whose line/Bezier controls all coincide still has a round cap
// in the native reference. Canvas discards these zero-length strokes. Do not confuse a curve
// returning to its origin with a point: every control must coincide as well.
export function pointOutlinePosition(path, width, height) {
  let point, segment = false;
  for (const [op, ...values] of path.points) {
    if (op === 'Z' || op === 'E') return null;
    if (!point) {
      if (op !== 'M') return null;
      point = values;
    }
    if (op !== 'M') segment = true;
    for (let i = 0; i < values.length; i += 2) {
      if (values[i] !== point[0] || values[i + 1] !== point[1]) return null;
    }
  }
  return segment ? [point[0] * shapePathScale(width, path.width), point[1] * shapePathScale(height, path.height)] : null;
}
