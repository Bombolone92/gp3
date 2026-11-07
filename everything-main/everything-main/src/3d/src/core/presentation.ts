import type { SceneObject, SceneState } from './scene';
import { modelMatrix, point, normalize, type Vec3 } from './math';
export interface LightSettings {
  type: 'directional' | 'point' | 'spot';
  color: Vec3;
  intensity: number;
  range: number;
  angle: number;
  softness: number;
  shadows: boolean;
}
export interface CameraSettings {
  focalLength: number;
  near: number;
  far: number;
}
export interface EnvironmentSettings {
  ambientColor: Vec3;
  ambientIntensity: number;
  exposure: number;
  studio: boolean;
  shadows: boolean;
  background: Vec3 | null;
}
export interface OutputSettings {
  width: number;
  height: number;
  transparent: boolean;
}
export const defaultEnvironment = (): EnvironmentSettings => ({
  ambientColor: [1, 1, 1],
  ambientIntensity: 0.25,
  exposure: 1,
  studio: true,
  shadows: true,
  background: null,
});
export const defaultOutput = (): OutputSettings => ({
  width: 1920,
  height: 1080,
  transparent: false,
});
export const isMesh = (
  o: SceneObject,
): o is SceneObject & { kind: 'cube' | 'sphere' | 'plane' | 'mesh' } =>
  ['cube', 'sphere', 'plane', 'mesh'].includes(o.kind);
export const defaultLight = (type: LightSettings['type']): LightSettings => ({
  type,
  color: [1, 1, 1],
  intensity: type === 'directional' ? 2.2 : 80,
  range: 20,
  angle: 45,
  softness: 0.25,
  shadows: true,
});
export const defaultCamera = (): CameraSettings => ({ focalLength: 50, near: 0.05, far: 2000 });
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => number(n, 0, 1));
export function validateLight(v: unknown): LightSettings {
  if (
    !record(v) ||
    !['directional', 'point', 'spot'].includes(String(v.type)) ||
    !color(v.color) ||
    !number(v.intensity, 0, 10000) ||
    !number(v.range, 0.1, 10000) ||
    !number(v.angle, 1, 170) ||
    !number(v.softness, 0, 1) ||
    typeof v.shadows !== 'boolean'
  )
    throw new Error('Invalid light settings.');
  return {
    type: v.type as LightSettings['type'],
    color: [...v.color],
    intensity: v.intensity,
    range: v.range,
    angle: v.angle,
    softness: v.softness,
    shadows: v.shadows,
  };
}
export function validateCamera(v: unknown): CameraSettings {
  if (
    !record(v) ||
    !number(v.focalLength, 8, 300) ||
    !number(v.near, 0.001, 100) ||
    !number(v.far, 0.1, 100000) ||
    v.far <= v.near
  )
    throw new Error(
      'Camera needs a focal length of 8 to 300 mm and a far clip greater than its near clip.',
    );
  return { focalLength: v.focalLength, near: v.near, far: v.far };
}
export function validateEnvironment(v: unknown): EnvironmentSettings {
  if (
    !record(v) ||
    !color(v.ambientColor) ||
    !number(v.ambientIntensity, 0, 10) ||
    !number(v.exposure, 0.05, 10) ||
    typeof v.studio !== 'boolean' ||
    typeof v.shadows !== 'boolean' ||
    (v.background !== null && !color(v.background))
  )
    throw new Error('Invalid environment settings.');
  return {
    ambientColor: [...v.ambientColor],
    ambientIntensity: v.ambientIntensity,
    exposure: v.exposure,
    studio: v.studio,
    shadows: v.shadows,
    background: v.background === null ? null : [...v.background],
  };
}
export function validateOutput(v: unknown): OutputSettings {
  if (
    !record(v) ||
    !number(v.width, 64, 4096) ||
    !number(v.height, 64, 4096) ||
    !Number.isInteger(v.width) ||
    !Number.isInteger(v.height) ||
    typeof v.transparent !== 'boolean'
  )
    throw new Error('Choose whole-number image dimensions from 64 to 4096 pixels.');
  return { width: v.width, height: v.height, transparent: v.transparent };
}
export function inheritedFlag(state: SceneState, object: SceneObject, key: 'hidden' | 'locked') {
  let current: SceneObject | undefined = object;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current[key]) return true;
    seen.add(current.id);
    current = state.objects.find((o) => o.id === current!.parentId);
  }
  return false;
}
export function direction(object: SceneObject): Vec3 {
  return normalize(point(modelMatrix([0, 0, 0], object.rotation, [1, 1, 1]), [0, 0, -1], 0));
}
