// Mode enter/exit handlers registered by mode modules.
import type { ObjectData } from '../data/types';
import type { PrimitiveArrays } from '../mesh/primitives';
import type { OpResult } from '../app/app';

export interface ModeHandler {
  enter?(ob: ObjectData): boolean;
  exit?(): void;
  /** edit mode: add a primitive into the edited mesh */
  addPrimitive?(arrays: PrimitiveArrays, props: Record<string, unknown>): OpResult;
  /** weight paint: compute automatic armature weights */
  armatureWeights?(mesh: ObjectData, armature: ObjectData, automatic: boolean): void;
}

export const modeHandlers: Record<string, ModeHandler> = {};
