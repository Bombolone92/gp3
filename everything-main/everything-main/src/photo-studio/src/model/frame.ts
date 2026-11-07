import { allLayers, layer, type Layer, type PhotoDocument, type Rect } from './document';
import type { IRect } from '../imaging/types';

// A frame is a group whose rectangle or ellipse masks the content placed in
// it. An empty frame is a placeholder: it draws nothing in the image and shows
// an outline on screen until an image is placed or dropped into it.
export type FrameShape = 'rect' | 'ellipse';
export type FrameFit = 'fill' | 'fit';
export type FrameData = { shape: FrameShape; rect: Rect; fit: FrameFit };
export type FrameLayer = Layer & { frame: FrameData };

export const isFrame = (l: Layer | undefined): l is FrameLayer => !!l?.frame && l.kind === 'group';

/** Placement of content of the given size in a frame: `fill` covers the frame
 * (cropping overflow), `fit` shows all of it. Centered either way. */
export function fitRect(content: { width: number; height: number }, frame: Rect, fit: FrameFit): Rect {
  const sx = frame.width / content.width,
    sy = frame.height / content.height;
  const k = fit === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = content.width * k,
    height = content.height * k;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2, width, height };
}

/** Whether a document point lies inside the frame's shape. */
export function frameContains(f: FrameData, x: number, y: number) {
  const r = f.rect;
  if (f.shape === 'rect') return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
  const dx = (x - r.x - r.width / 2) / (r.width / 2),
    dy = (y - r.y - r.height / 2) / (r.height / 2);
  return dx * dx + dy * dy <= 1;
}
/** Topmost visible frame under a point (frames may sit inside artboards). */
export function frameAt(doc: Pick<PhotoDocument, 'layers'>, x: number, y: number): FrameLayer | undefined {
  const visit = (layers: Layer[]): FrameLayer | undefined => {
    for (const l of [...layers].reverse()) {
      if (!l.visible) continue;
      if (isFrame(l)) {
        if (frameContains(l.frame, x, y)) return l;
        continue;
      }
      const inner = l.kind === 'group' ? visit(l.children) : undefined;
      if (inner) return inner;
    }
  };
  return visit(doc.layers);
}

/** Antialiased ellipse coverage for document pixels in `extent` (row-major),
 * from the implicit function's first-order signed distance. */
export function ellipseCoverage(rect: Rect, extent: IRect): Float32Array {
  const out = new Float32Array(extent.width * extent.height);
  const rx = rect.width / 2,
    ry = rect.height / 2;
  const cx = rect.x + rx,
    cy = rect.y + ry;
  if (rx <= 0 || ry <= 0) return out;
  for (let j = 0; j < extent.height; j++) {
    const y = extent.y + j + 0.5 - cy;
    for (let i = 0; i < extent.width; i++) {
      const x = extent.x + i + 0.5 - cx;
      const f = (x * x) / (rx * rx) + (y * y) / (ry * ry) - 1;
      const gx = (2 * x) / (rx * rx),
        gy = (2 * y) / (ry * ry);
      const g = Math.hypot(gx, gy);
      const d = g > 1e-9 ? f / g : f * Math.min(rx, ry);
      out[j * extent.width + i] = Math.max(0, Math.min(1, 0.5 - d));
    }
  }
  return out;
}

/** A new, empty frame group. */
export function createFrame(doc: PhotoDocument, rect: Rect, shape: FrameShape, name?: string): FrameLayer {
  const used = new Set(allLayers(doc.layers).map((l) => l.name));
  let n = 1;
  while (!name && used.has(`Frame ${n}`)) n++;
  const l = layer('group', name ?? `Frame ${n}`, doc.width, doc.height) as FrameLayer;
  l.blend = 'normal';
  l.frame = { shape, rect: { ...rect }, fit: 'fill' };
  return l;
}

/** Scale and center a content layer into its frame (its transform only). */
export function placeInFrame(content: Layer, frame: FrameData, fit: FrameFit = frame.fit) {
  const t = content.transform;
  const r = fitRect({ width: t.width, height: t.height }, frame.rect, fit);
  content.transform = { ...r, rotation: t.rotation };
}

export function validateFrame(l: Layer) {
  const f = l.frame;
  if (f === undefined) return;
  const r = f?.rect;
  if (
    l.kind !== 'group' ||
    !f ||
    typeof f !== 'object' ||
    !['rect', 'ellipse'].includes(f.shape) ||
    !['fill', 'fit'].includes(f.fit) ||
    !r ||
    ![r.x, r.y, r.width, r.height].every(Number.isFinite) ||
    r.width <= 0 ||
    r.height <= 0 ||
    allLayers(l.children).some((c) => c.frame || c.artboard)
  )
    throw new Error('Invalid frame.');
}
