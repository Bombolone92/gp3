// Rendering of a pin-warped embedded object from its content: the frame's
// pins are solved on a mesh over the content and the result is placed by the
// frame's quad. Used when the cached render of the frame is stale.
import type { PhotoDocument } from '../../model/document';
import type { PinFrame } from '../../model/pin-warp';
import type { IRect, RGBA8 } from '../../imaging/types';
import { applyMat3 } from '../../imaging/filters/warp';
import type { Interp } from '../../imaging/filters/sampling';
import { ArapSolver, triangleOrder, type ArapPin } from '../../imaging/warp/arap';
import { buildPinMesh, locateInMesh } from '../../imaging/warp/pin-mesh';
import { renderTriangles, triangleBounds } from '../../imaging/warp/triangles';
import { rectToQuad, type Quad } from '../transform/math';
import { intersect, scaledLimit } from '../transform/render';

/** Render `src` (the content) through `pins`, placed by `quad` (document
 * points of the content's corners). Undefined when nothing is visible. */
export function renderPinFrame(src: RGBA8, quad: Quad, pins: PinFrame, doc: Pick<PhotoDocument, 'width' | 'height'>, method: Interp = 'bicubic'): { image: RGBA8; rect: IRect } | undefined {
  const mesh = buildPinMesh(src, pins.density, pins.expansion);
  if (!mesh) return;
  // Pins scale with content that changed size since they were placed.
  const sx = src.width / pins.width,
    sy = src.height / pins.height;
  const solver = new ArapSolver(mesh);
  solver.mode = pins.mode;
  const placed: ArapPin[] = [];
  const rest: { x: number; y: number; depth: number }[] = [];
  for (const p of pins.pins) {
    const hit = locateInMesh(mesh.rest, mesh.tris, p.x * sx, p.y * sy, mesh.spacing * 0.5);
    if (!hit) continue;
    placed.push({ tri: hit.tri, bary: hit.bary, x: p.tx * sx, y: p.ty * sy, angle: p.angle });
    rest.push({ x: p.x * sx, y: p.y * sy, depth: p.depth });
  }
  solver.settle(placed);
  const M = rectToQuad({ x: 0, y: 0, width: src.width, height: src.height }, quad);
  const dst = new Float64Array(solver.pos.length);
  for (let i = 0; i < dst.length; i += 2) {
    const q = applyMat3(M, solver.pos[i], solver.pos[i + 1]);
    dst[i] = q.x;
    dst[i + 1] = q.y;
  }
  const out = intersect(triangleBounds(dst, mesh.tris), scaledLimit(doc, 1));
  if (out.width <= 0 || out.height <= 0) return;
  const image = renderTriangles(src, { src: mesh.rest, dst, tris: mesh.tris, order: triangleOrder(mesh, rest) }, out, method);
  return { image, rect: out };
}
