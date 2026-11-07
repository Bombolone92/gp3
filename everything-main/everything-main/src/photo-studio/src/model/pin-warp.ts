// Pin Warp on an embedded object stays editable: the pins are part of the
// instance's placement (`layer.embed.frame.pins`), in pixels of the content,
// and the frame's cached render is re-made from the content whenever it is
// stale (content edited, layer scaled or rotated).
//
// Projects from before embedded contents kept a warped image layer as
// `asset` (the result) plus `pinWarp` (the original source and pins);
// `migratePinWarps` turns those into embedded objects with a pin frame.
import { allLayers, type Layer, type PhotoDocument } from './document';

export type PinWarpPinRecord = {
  // Pinned point in the content, and where it was moved to (content pixels).
  x: number;
  y: number;
  tx: number;
  ty: number;
  // Fixed rotation in radians; automatic when absent.
  angle?: number;
  // Drawing priority where the warped layer overlaps itself.
  depth: number;
};
/** Pins and mesh settings of a pin-warped placement. */
export type PinFrame = {
  mode: 'rigid' | 'normal' | 'distort';
  density: 'fewer' | 'normal' | 'more';
  expansion: number;
  // Content size the pins refer to (they scale with a resized content).
  width: number;
  height: number;
  pins: PinWarpPinRecord[];
};
/** Legacy record of a warped image layer without embedded contents. */
export type PinWarpRecord = {
  // Original source asset and its size.
  source: string;
  sourceWidth: number;
  sourceHeight: number;
  // Asset the record describes; a different `asset` means the record is stale.
  result: string;
  // Rectangle of the original source space that the result covers.
  bounds: { x: number; y: number; width: number; height: number };
  mode: PinFrame['mode'];
  density: PinFrame['density'];
  expansion: number;
  pins: PinWarpPinRecord[];
};

const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function validPins(pins: unknown) {
  return Array.isArray(pins) && pins.length <= 1000 && pins.every((p) => p && [p.x, p.y, p.tx, p.ty, p.depth].every(finite) && (p.angle === undefined || finite(p.angle)));
}
const validSettings = (w: Partial<PinFrame>) => ['rigid', 'normal', 'distort'].includes(w.mode!) && ['fewer', 'normal', 'more'].includes(w.density!) && finite(w.expansion);

/** Pins of an embedded object frame. */
export function validatePinFrame(w: unknown) {
  const f = w as PinFrame;
  if (!f || typeof f !== 'object' || !validSettings(f) || !finite(f.width) || !finite(f.height) || f.width <= 0 || f.height <= 0 || !validPins(f.pins))
    throw new Error('Invalid Pin Warp.');
}
/** Legacy records (a layer converted to pixels drops its record). */
export function validatePinWarp(l: Layer) {
  const w = l.pinWarp;
  if (w === undefined) return;
  if (l.kind !== 'image') {
    delete l.pinWarp;
    return;
  }
  const bad = () => new Error('Invalid Pin Warp.');
  if (!w || typeof w !== 'object') throw bad();
  if (typeof w.source !== 'string' || !w.source || typeof w.result !== 'string' || !w.result) throw bad();
  if (!finite(w.sourceWidth) || !finite(w.sourceHeight) || w.sourceWidth <= 0 || w.sourceHeight <= 0) throw bad();
  const b = w.bounds;
  if (!b || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height) || b.width <= 0 || b.height <= 0) throw bad();
  if (!validSettings(w) || !validPins(w.pins)) throw bad();
}

/** Turn legacy warped image layers into embedded objects whose frame holds
 * the pins: the original source becomes the content, the warped result the
 * frame's cached render. Records that no longer match the layer are dropped. */
export function migratePinWarps(doc: PhotoDocument) {
  for (const l of allLayers(doc.layers)) {
    const w = l.pinWarp;
    if (!w) continue;
    delete l.pinWarp;
    if (l.kind !== 'image' || l.embed || w.result !== l.asset) continue;
    const id = crypto.randomUUID();
    const colorSpace = l.assetColorSpace ?? 'document';
    doc.embeds = {
      ...doc.embeds,
      [id]: { id, name: l.name, width: Math.round(w.sourceWidth), height: Math.round(w.sourceHeight), composite: w.source, colorSpace },
    };
    // Content corners: source pixels sit in the result at -bounds, and the
    // result fills the layer's rectangle (a rotation of the layer applies to
    // the frame through `transform`, as for any frame).
    const t = l.transform;
    const at = (u: number, v: number): [number, number] => [t.x + ((u - w.bounds.x) / w.bounds.width) * t.width, t.y + ((v - w.bounds.y) / w.bounds.height) * t.height];
    const W = w.sourceWidth,
      H = w.sourceHeight;
    l.embed = {
      contents: id,
      frame: {
        quad: [at(0, 0), at(W, 0), at(W, H), at(0, H)],
        rect: { x: t.x, y: t.y, width: t.width, height: t.height },
        source: w.source,
        pins: { mode: w.mode, density: w.density, expansion: w.expansion, width: W, height: H, pins: w.pins },
      },
    };
  }
}
