// Placement math for embedded object instances (pure, no DOM). An instance is
// either a rotated rectangle (`transform`) over its content or a frame: a quad
// and optional warp mesh in document space. Frames are stored with the
// rectangle their cached render occupied, so any later rectangle edit of the
// layer (move, scale, rotate, canvas resize) composes with the frame exactly.
import { allLayers, type Layer, type PhotoDocument, type Rect, type Transform } from '../../model/document';
import { contentsOf, type EmbedFrame } from '../../model/embedded';
import type { MeshGrid } from '../../imaging/filters/mesh';
import { isRotatedRect, mapMesh, mapQuad, quadBounds, quadTransform, rectToQuad, transformQuad, type Quad } from '../transform/math';

export const toQuad = (q: [number, number][]): Quad => q.map(([x, y]) => ({ x, y })) as Quad;
export const fromQuad = (q: Quad): [number, number][] => q.map((p) => [p.x, p.y]);
export const toMesh = (m: NonNullable<EmbedFrame['mesh']>): MeshGrid => ({ cols: m.cols, rows: m.rows, points: Float64Array.from(m.points), mode: m.mode });
export const fromMesh = (m: MeshGrid): NonNullable<EmbedFrame['mesh']> => ({ cols: m.cols, rows: m.rows, points: Array.from(m.points), ...(m.mode ? { mode: m.mode } : {}) });

const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameRect = (t: Transform, r: Rect) => same(t.x, r.x) && same(t.y, r.y) && same(t.width, r.width) && same(t.height, r.height) && same(t.rotation % 360, 0);

/** Document quad and mesh of a framed instance with its current transform. */
export function effectiveFrame(l: Pick<Layer, 'transform' | 'embed'>): { quad: Quad; mesh?: MeshGrid } | undefined {
  const f = l.embed?.frame;
  if (!f) return undefined;
  const quad = toQuad(f.quad),
    mesh = f.mesh ? toMesh(f.mesh) : undefined;
  if (sameRect(l.transform, f.rect)) return { quad, mesh };
  const m = rectToQuad(f.rect, transformQuad(l.transform));
  return { quad: mapQuad(m, quad), mesh: mesh && mapMesh(m, mesh) };
}
/** Document quad of the content's corners for any image layer. */
export function instanceQuad(l: Pick<Layer, 'transform' | 'embed'>): Quad {
  return effectiveFrame(l)?.quad ?? transformQuad(l.transform);
}
/** A frame needs a new cached render: its content changed, or the layer was
 * scaled or rotated since (a whole-pixel move only shifts the cache). */
export function frameStale(l: Pick<Layer, 'transform' | 'embed'>, composite: string | undefined) {
  const f = l.embed?.frame;
  if (!f) return false;
  if (composite !== undefined && f.source !== composite) return true;
  const t = l.transform;
  if (!same(t.width, f.rect.width) || !same(t.height, f.rect.height) || !same(t.rotation % 360, 0)) return true;
  return !Number.isInteger(t.x - f.rect.x) || !Number.isInteger(t.y - f.rect.y);
}
/** A quad (and no mesh) that a plain rotated rectangle can represent. */
export function plainPlacement(quad: Quad, mesh: MeshGrid | undefined): Transform | undefined {
  if (mesh || !isRotatedRect(quad, 1e-6)) return undefined;
  return quadTransform(quad);
}
/** Frame for a quad/mesh whose render has not been made yet (`source` empty). */
export function pendingFrame(quad: Quad, mesh: MeshGrid | undefined): { frame: EmbedFrame; rect: Rect } {
  const b = quadBounds(mesh ? meshPoints(mesh) : quad);
  const rect = { x: b.x, y: b.y, width: Math.max(1e-3, b.width), height: Math.max(1e-3, b.height) };
  return { frame: { quad: fromQuad(quad), mesh: mesh && fromMesh(mesh), rect, source: '' }, rect };
}
function meshPoints(m: MeshGrid) {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < m.points.length; i += 2) out.push({ x: m.points[i], y: m.points[i + 1] });
  return out;
}
/** Keep a framed instance's scale when its content size changes: the quad
 * grows or shrinks with the content about the content's center, through the
 * same projective placement (as `rescaleTransform` for plain instances).
 * Warp meshes and pin frames keep their placement (the content is fitted). */
export function rescaleFrame(f: EmbedFrame, from: { width: number; height: number }, to: { width: number; height: number }): EmbedFrame {
  if (f.mesh || f.pins || (same(from.width, to.width) && same(from.height, to.height))) return f;
  const m = rectToQuad({ x: 0, y: 0, width: from.width, height: from.height }, toQuad(f.quad));
  const grown = { x: (from.width - to.width) / 2, y: (from.height - to.height) / 2, width: to.width, height: to.height };
  return { ...f, quad: fromQuad(mapQuad(m, transformQuad({ ...grown, rotation: 0 }))) };
}
/** Keep an instance's scale when its content size changes (center fixed). */
export function rescaleTransform(t: Transform, from: { width: number; height: number }, to: { width: number; height: number }): Transform {
  const width = (t.width * to.width) / from.width,
    height = (t.height * to.height) / from.height;
  return { x: t.x + (t.width - width) / 2, y: t.y + (t.height - height) / 2, width, height, rotation: t.rotation };
}
/** Framed instances whose cached render no longer matches. */
export function staleFrames(doc: PhotoDocument) {
  return allLayers(doc.layers).filter((l) => {
    const c = l.kind === 'image' && l.embed?.frame ? contentsOf(doc, l) : undefined;
    return !!c && frameStale(l, c.composite);
  });
}
