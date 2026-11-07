import {
  vectorComponents,
  vectorMatrix,
  type VectorMask,
} from "../model/vector";
import type { Layer } from "../model/document";
const context = new OffscreenCanvas(1, 1).getContext("2d")!;
const cache = new WeakMap<
  VectorMask,
  {
    key: string;
    components: { operation: string; path: Path2D; rule: CanvasFillRule }[];
  }
>();
export function vectorContains(l: Layer, x: number, y: number) {
  const mask = l.vector!.mask;
  if (mask.disable) return true;
  const key = JSON.stringify(mask.paths),
    previous = cache.get(mask);
  let components = previous?.key === key ? previous.components : undefined;
  if (!components) {
    components = vectorComponents(mask).map((component) => {
      const path = new Path2D();
      for (const contour of component.paths) {
        const knots = contour.knots;
        if (!knots.length) continue;
        path.moveTo(knots[0].points[2], knots[0].points[3]);
        for (let i = 1; i < knots.length; i++) {
          const a = knots[i - 1].points,
            b = knots[i].points;
          path.bezierCurveTo(a[4], a[5], b[0], b[1], b[2], b[3]);
        }
        if (!contour.open) {
          const a = knots[knots.length - 1].points,
            b = knots[0].points;
          path.bezierCurveTo(a[4], a[5], b[0], b[1], b[2], b[3]);
          path.closePath();
        }
      }
      return {
        operation: component.operation,
        path,
        rule:
          component.paths[0].fillRule === "non-zero" ? "nonzero" : "evenodd",
      };
    });
    cache.set(mask, { key, components });
  }
  const m = vectorMatrix(l),
    det = m[0] * m[3] - m[1] * m[2],
    dx = x - m[4],
    dy = y - m[5];
  const px = (m[3] * dx - m[2] * dy) / det,
    py = (-m[1] * dx + m[0] * dy) / det;
  let inside =
    !!mask.fillStartsWithAllPixels ||
    ["subtract", "intersect"].includes(components[0]?.operation);
  for (const component of components) {
    const hit = context.isPointInPath(component.path, px, py, component.rule);
    if (component.operation === "combine") inside = inside || hit;
    else if (component.operation === "subtract") inside = inside && !hit;
    else if (component.operation === "intersect") inside = inside && hit;
    else inside = inside !== hit;
  }
  return mask.invert ? !inside : inside;
}
