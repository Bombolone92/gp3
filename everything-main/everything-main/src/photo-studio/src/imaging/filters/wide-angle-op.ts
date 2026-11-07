// Wide Angle Correction as a filter operation, so it renders in the filter
// worker, records into actions and works as a Live Filter. Its workspace
// (features/filters/wide-angle.ts) edits the constraints; here each
// constraint is a two-point path whose first point's tag is the orientation.
import type { NormPath } from '../types';
import { defineOp } from './common';
import { applyWideAngle, type ConstraintOrientation, type WideAngleModel, type WideAngleParams } from './wide-angle';

export const ORIENTATIONS: ConstraintOrientation[] = ['any', 'horizontal', 'vertical'];
export function toWideAngleParams(p: Record<string, unknown>): WideAngleParams {
  const paths = (p.constraints as NormPath[] | undefined) ?? [];
  return {
    model: (p.model as WideAngleModel) ?? 'auto',
    focalLength: Number(p.focalLength ?? 12),
    cropFactor: Number(p.cropFactor ?? 1),
    scale: Number(p.scale ?? 100),
    constraints: paths
      .filter((c) => c.length >= 2)
      .map((c) => ({ a: [c[0].x, c[0].y], b: [c[c.length - 1].x, c[c.length - 1].y], orient: ORIENTATIONS[c[0].t ?? 0] ?? 'any' })),
  };
}

export const wideAngleOp = defineOp({
  id: 'adaptive-wide-angle',
  label: 'Wide Angle Correction',
  category: 'Distort',
  params: [
    {
      key: 'model',
      label: 'Correction',
      type: 'select',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'fisheye', label: 'Fisheye' },
        { value: 'perspective', label: 'Perspective' },
        { value: 'spherical', label: 'Full Spherical' },
      ],
      default: 'auto',
    },
    { key: 'focalLength', label: 'Focal Length', type: 'number', min: 1, max: 200, step: 0.5, default: 12, unit: 'mm' },
    { key: 'cropFactor', label: 'Crop Factor', type: 'number', min: 0.1, max: 10, step: 0.1, default: 1 },
    { key: 'scale', label: 'Scale', type: 'number', min: 50, max: 150, step: 1, default: 100, unit: '%' },
    { key: 'constraints', label: 'Constraints', type: 'paths', default: [], limit: 64 },
  ],
  run(src, p, _ctx, progress) {
    return applyWideAngle(src, toWideAngleParams(p), progress);
  },
});
