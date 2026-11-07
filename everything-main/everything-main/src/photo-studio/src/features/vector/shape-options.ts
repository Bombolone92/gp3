import type { PathOp } from './geometry';
import { defaultStroke, type FillSpec, type StrokeSpec } from './paint';

export type ShapeKind = 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line' | 'custom';
export type ShapeMode = 'shape' | 'path' | 'pixels';
// Shared by every shape tool through the options bar.
export const shapeOpts = {
  mode: 'shape' as ShapeMode,
  fill: { type: 'color', color: '' } as FillSpec,
  stroke: defaultStroke() as StrokeSpec,
  op: 'new' as 'new' | PathOp,
  alignEdges: true,
  radius: 0,
  perCorner: false,
  radii: [0, 0, 0, 0] as [number, number, number, number],
  triRadius: 0,
  sides: 5,
  star: 0,
  polyRadius: 0,
  smoothIndents: false,
  weight: 4,
  arrowStart: false,
  arrowEnd: false,
  arrowWidth: 5,
  arrowLength: 10,
  concavity: 0,
  custom: 'heart',
};
