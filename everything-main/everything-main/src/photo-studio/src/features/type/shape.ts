// Text outlines (quadratic contours) to an editable vector mask.

import type { PathCommand } from '../../imaging/text/outlines';
import type { VectorMask } from '../../model/vector';

type Knot = VectorMask['paths'][number]['knots'][number];

// Each glyph contour becomes one subpath; all subpaths form one component
// filled with the nonzero rule, so counters (the hole in "o") stay open.
// Quadratic segments are raised to cubics exactly (controls at 2/3).
export function contoursToVectorMask(contours: PathCommand[][]): VectorMask {
  const paths: VectorMask['paths'] = [];
  for (const contour of contours) {
    const knots: Knot[] = [];
    let cur: [number, number] | undefined;
    let start: [number, number] | undefined;
    const push = (x: number, y: number) => {
      knots.push({ linked: false, points: [x, y, x, y, x, y] });
      cur = [x, y];
    };
    for (const c of contour) {
      if (c[0] === 'M') {
        if (knots.length) break; // one contour per subpath
        push(c[1], c[2]);
        start = [c[1], c[2]];
      } else if (c[0] === 'L') push(c[1], c[2]);
      else if (c[0] === 'Q' && cur) {
        const [, qx, qy, x, y] = c;
        const prev = knots[knots.length - 1].points;
        prev[4] = cur[0] + (2 / 3) * (qx - cur[0]);
        prev[5] = cur[1] + (2 / 3) * (qy - cur[1]);
        knots.push({ linked: false, points: [x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y, x, y] });
        cur = [x, y];
      }
    }
    // A closing segment that returns to the start merges into the first knot.
    if (knots.length > 1 && start) {
      const last = knots[knots.length - 1].points;
      if (Math.abs(last[2] - start[0]) < 1e-9 && Math.abs(last[3] - start[1]) < 1e-9) {
        knots[0].points[0] = last[0];
        knots[0].points[1] = last[1];
        knots.pop();
      }
    }
    if (knots.length < 2) continue;
    paths.push({ open: false, operation: paths.length ? undefined : 'combine', knots, fillRule: 'non-zero' });
  }
  return { paths };
}
