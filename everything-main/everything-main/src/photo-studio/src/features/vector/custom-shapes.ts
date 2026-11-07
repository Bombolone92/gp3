import type { VectorMask } from '../../model/vector';
import { commandsToPaths, maskToSvg, parseSvgPath, transformMask, type PathOp, type SubPath } from './geometry';
import { vectorBounds } from '../../model/vector';

// Custom shapes: the built-in library (model/shape-library) plus user-defined
// shapes (Edit > Define Custom Shape) kept in local storage.
import { builtinShapes, type CustomShape } from '../../model/shape-library';
export { builtinShapes, type CustomShape };

const storageKey = 'photo-studio-custom-shapes';
export function userShapes(): CustomShape[] {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.d === 'string').map((s) => ({ ...s, user: true })) : [];
  } catch {
    return [];
  }
}
export function setUserShapes(list: CustomShape[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(list.map(({ user: _u, ...s }) => s)));
  } catch {
    /* Optional. */
  }
}
export function allShapes(): CustomShape[] {
  return [...builtinShapes, ...userShapes()];
}
export function saveUserShape(name: string, d: string) {
  const list = userShapes().map(({ user: _u, ...s }) => s);
  const shape = { id: `user-${crypto.randomUUID()}`, name, d };
  list.push(shape);
  try {
    localStorage.setItem(storageKey, JSON.stringify(list));
  } catch {
    /* Optional storage; the shape stays available until reload. */
  }
  return shape;
}
/** Normalize a document-space path into the 100 x 100 custom shape grid. */
export function shapeFromMask(mask: VectorMask): string | undefined {
  const b = vectorBounds(mask);
  if (!b || (!b.width && !b.height)) return;
  const copy = structuredClone(mask);
  const s = 100 / Math.max(b.width, b.height);
  transformMask(copy, s, 0, 0, s, -b.x * s, -b.y * s);
  return maskToSvg(copy);
}
export function shapeAspect(shape: CustomShape) {
  const paths = commandsToPaths(parseSvgPath(shape.d), 'even-odd');
  const b = vectorBounds({ paths });
  return b && b.height ? b.width / b.height : 1;
}
/** Custom shape subpaths fitted to a box. */
export function customShapePaths(shape: CustomShape, x: number, y: number, w: number, h: number, operation: PathOp = 'combine'): SubPath[] {
  const paths = commandsToPaths(parseSvgPath(shape.d), 'even-odd', operation, true);
  const b = vectorBounds({ paths });
  if (!b) return [];
  const sx = b.width ? w / b.width : 1, sy = b.height ? h / b.height : 1;
  const m: VectorMask = { paths };
  transformMask(m, sx, 0, 0, sy, x - b.x * sx, y - b.y * sy);
  return m.paths;
}
