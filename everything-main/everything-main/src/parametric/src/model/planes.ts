import { type Frame, frameFrom } from '../math/vec';
import type { BasePlane } from './types';

/**
 * Default planes. Y is up: Front is the XY plane (normal +Z), Top is XZ
 * (normal +Y, sketch Y pointing to -Z) and Right is YZ (normal +X).
 */
export const BASE_FRAMES: Record<BasePlane, Frame> = {
  front: frameFrom([0, 0, 0], [1, 0, 0], [0, 0, 1]),
  top: frameFrom([0, 0, 0], [1, 0, 0], [0, 1, 0]),
  right: frameFrom([0, 0, 0], [0, 0, -1], [1, 0, 0]),
};

export const BASE_PLANE_NAMES: Record<BasePlane, string> = {
  front: 'Front Plane',
  top: 'Top Plane',
  right: 'Right Plane',
};
