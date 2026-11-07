import type {
  ExtrudeFeature, Feature, RevolveFeature, SkConstraint, SkEntity, SketchFeature,
} from '../src/model/types';

let n = 0;
const uid = (p: string) => `${p}${++n}`;

/** Closed polygon sketch entities from a list of points. */
export function polygon(pts: [number, number][], prefix = uid('poly')): SkEntity[] {
  const ents: SkEntity[] = pts.map(([x, y], i) => ({ id: `${prefix}p${i}`, t: 'point', x, y }));
  pts.forEach((_, i) => ents.push({ id: `${prefix}l${i}`, t: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % pts.length}` }));
  return ents;
}

export function rect(x0: number, y0: number, x1: number, y1: number, prefix?: string): SkEntity[] {
  return polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], prefix);
}

export function circle(cx: number, cy: number, r: number, id = uid('c')): SkEntity[] {
  return [{ id: `${id}c`, t: 'point', x: cx, y: cy }, { id, t: 'circle', c: `${id}c`, r }];
}

export function sketch(id: string, entities: SkEntity[], plane: SketchFeature['plane'] = { kind: 'base', plane: 'front' }, constraints: SkConstraint[] = []): SketchFeature {
  return { id, name: id, type: 'sketch', plane, entities, constraints };
}

export function extrude(id: string, sketchId: string, depth: number, extra: Partial<ExtrudeFeature> = {}): ExtrudeFeature {
  return {
    id, name: id, type: 'extrude', sketch: sketchId, cut: false, end: 'blind', depth, flip: false,
    dir2: null, draft: 0, draftOutward: false, thin: null, ...extra,
  };
}

export function revolve(id: string, sketchId: string, angle = 360, extra: Partial<RevolveFeature> = {}): RevolveFeature {
  return { id, name: id, type: 'revolve', sketch: sketchId, cut: false, axis: null, end: 'blind', angle, flip: false, thin: null, ...extra };
}

export const req = (features: Feature[], extra: Record<string, unknown> = {}) => ({
  features, upTo: features.length, blobs: {}, quality: 0, ...extra,
});
