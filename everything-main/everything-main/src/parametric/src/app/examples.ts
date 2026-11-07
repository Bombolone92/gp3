// Built-in example parts shown on the start screen.

import { newDocument } from '../model/document';
import type { Feature, PartDocument, SkConstraint, SkEntity, SketchFeature } from '../model/types';

function poly(prefix: string, pts: [number, number][]): SkEntity[] {
  const ents: SkEntity[] = pts.map(([x, y], i) => ({ id: `${prefix}p${i}`, t: 'point', x, y }));
  pts.forEach((_, i) => ents.push({ id: `${prefix}l${i}`, t: 'line', a: `${prefix}p${i}`, b: `${prefix}p${(i + 1) % pts.length}` }));
  return ents;
}

const dim = (id: string, type: 'distance' | 'hdistance' | 'vdistance' | 'radius' | 'diameter', refs: string[], value: number, at: [number, number], name: string): SkConstraint =>
  ({ id, type, refs, value, at, name });

/** L-shaped bracket with two holes and a fillet in the inside corner. */
export function bracketExample(): PartDocument {
  const doc = newDocument('Mounting Bracket');
  const s1: SketchFeature = {
    id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' },
    entities: poly('b', [[0, 0], [60, 0], [60, 8], [8, 8], [8, 40], [0, 40]]),
    constraints: [
      { id: 'r1', type: 'coincident', refs: ['bp0', 'O'] },
      { id: 'r2', type: 'horizontal', refs: ['bl0'] }, { id: 'r3', type: 'horizontal', refs: ['bl2'] }, { id: 'r4', type: 'horizontal', refs: ['bl4'] },
      { id: 'r5', type: 'vertical', refs: ['bl1'] }, { id: 'r6', type: 'vertical', refs: ['bl3'] }, { id: 'r7', type: 'vertical', refs: ['bl5'] },
      dim('d1', 'distance', ['bl0'], 60, [30, -10], 'D1'),
      dim('d2', 'distance', ['bl5'], 40, [-10, 20], 'D2'),
      dim('d3', 'distance', ['bl1'], 8, [70, 4], 'D3'),
      dim('d4', 'distance', ['bl4'], 8, [4, 50], 'D4'),
    ],
  };
  const e1: Feature = { id: 'f1', name: 'Extrude1', type: 'extrude', sketch: 's1', cut: false, end: 'blind', depth: 30, flip: false, dir2: null, draft: 0, draftOutward: false, thin: null };
  const topFace = { name: 'f1:side:bl2', sig: { type: 'plane', c: [34, 8, 15] as [number, number, number], n: [0, 1, 0] as [number, number, number], area: 52 * 30 } };
  const s2: SketchFeature = {
    id: 's2', name: 'Sketch2', type: 'sketch', plane: { kind: 'face', face: topFace },
    entities: [{ id: 'h1', t: 'point', x: 24, y: -15 }, { id: 'h2', t: 'point', x: 48, y: -15 }],
    constraints: [],
  };
  const hole: Feature = {
    id: 'f2', name: 'Hole1', type: 'hole', sketch: 's2', kind: 'counterbore', diameter: 6, end: 'throughAll', depth: 12,
    cbDiameter: 11, cbDepth: 3, csDiameter: 12, csAngle: 90, flip: false,
  };
  const fillet: Feature = {
    id: 'f3', name: 'Fillet1', type: 'fillet', faces: [], radius: 4,
    edges: [{ name: 'f1:side:bl2|f1:side:bl3', sig: { type: 'line', m: [8, 8, 15], len: 30 } }],
  };
  doc.features = [s1, e1, s2, hole, fillet];
  doc.nextId = 10;
  doc.material = { name: 'Aluminum 6061', density: 2700 };
  return doc;
}

/** Revolved flange with a circular pattern of bolt holes. */
export function flangeExample(): PartDocument {
  const doc = newDocument('Pipe Flange');
  const s1: SketchFeature = {
    id: 's1', name: 'Sketch1', type: 'sketch', plane: { kind: 'base', plane: 'front' },
    entities: [
      ...poly('f', [[12, 0], [45, 0], [45, 8], [22, 8], [22, 26], [12, 26]]),
      { id: 'a1', t: 'point', x: 0, y: 0 }, { id: 'a2', t: 'point', x: 0, y: 30 },
      { id: 'axis', t: 'line', a: 'a1', b: 'a2', construction: true },
    ],
    constraints: [
      { id: 'r1', type: 'coincident', refs: ['a1', 'O'] }, { id: 'r2', type: 'vertical', refs: ['axis'] },
      { id: 'r3', type: 'horizontal', refs: ['fl0'] }, { id: 'r4', type: 'horizontal', refs: ['fl2'] }, { id: 'r5', type: 'horizontal', refs: ['fl4'] },
      { id: 'r6', type: 'vertical', refs: ['fl1'] }, { id: 'r7', type: 'vertical', refs: ['fl3'] }, { id: 'r8', type: 'vertical', refs: ['fl5'] },
      { id: 'r9', type: 'coincident', refs: ['fp0', 'O'] },
      dim('d1', 'hdistance', ['a1', 'fp0'], 12, [6, -8], 'D1'),
      dim('d2', 'hdistance', ['a1', 'fp1'], 45, [22, -16], 'D2'),
      dim('d3', 'distance', ['fl1'], 8, [55, 4], 'D3'),
      dim('d4', 'hdistance', ['a1', 'fp3'], 22, [11, 36], 'D4'),
      dim('d5', 'vdistance', ['fp0', 'fp5'], 26, [4, 13], 'D5'),
      dim('d6', 'distance', ['axis'], 30, [-8, 15], 'D6'),
    ],
  };
  // The "coincident fp0 with origin" relation above would pull the profile onto
  // the axis; the inner radius comes from D1 instead.
  s1.constraints = s1.constraints.filter((c) => c.id !== 'r9');
  s1.constraints.push({ id: 'r10', type: 'horizontal', refs: ['a1', 'fp0'] });
  const rev: Feature = { id: 'f1', name: 'Revolve1', type: 'revolve', sketch: 's1', cut: false, axis: null, end: 'blind', angle: 360, flip: false, thin: null };
  const face = { name: 'f1:side:fl2', sig: { type: 'plane', c: [0, 8, 0] as [number, number, number], n: [0, 1, 0] as [number, number, number], area: Math.PI * (45 * 45 - 22 * 22) } };
  const s2: SketchFeature = { id: 's2', name: 'Sketch2', type: 'sketch', plane: { kind: 'face', face }, entities: [{ id: 'h1', t: 'point', x: 34, y: 0 }], constraints: [] };
  const hole: Feature = {
    id: 'f2', name: 'Hole1', type: 'hole', sketch: 's2', kind: 'simple', diameter: 7, end: 'throughAll', depth: 10,
    cbDiameter: 12, cbDepth: 3, csDiameter: 12, csAngle: 90, flip: false,
  };
  const pattern: Feature = { id: 'f3', name: 'Circular Pattern1', type: 'circularPattern', seeds: ['f2'], axis: { kind: 'base', axis: 'y' }, angle: 360, count: 6, equal: true, flip: false };
  const chamfer: Feature = {
    id: 'f4', name: 'Chamfer1', type: 'chamfer', faces: [], mode: 'distance', distance: 1.5, distance2: 1.5, angle: 45, flip: false,
    edges: [{ name: 'f1:side:fl1|f1:side:fl2', sig: { type: 'circle', m: [-45, 8, 0], len: 2 * Math.PI * 45 } }],
  };
  doc.features = [s1, rev, s2, hole, pattern, chamfer];
  doc.nextId = 10;
  doc.material = { name: 'Stainless Steel (304)', density: 8000 };
  doc.color = '#8e9aa8';
  return doc;
}

export const EXAMPLES = [
  { id: 'bracket', name: 'Mounting Bracket', description: 'Extrude, counterbored holes and a fillet', make: bracketExample },
  { id: 'flange', name: 'Pipe Flange', description: 'Revolve, hole, circular pattern and chamfer', make: flangeExample },
];
