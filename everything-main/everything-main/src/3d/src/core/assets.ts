import { modelMatrix, point, type Vec3 } from './math';
import type { SceneObject, SceneState } from './scene';
import type { Topology } from '../edit/topology';
import type { Mesh } from '../geometry/protocol';

export interface MeshAsset extends Mesh {
  topology?: Topology;
  triangleFaces?: Uint32Array;
  id: string;
  uvs: Float32Array;
  min: Vec3;
  max: Vec3;
}
export interface TextureAsset {
  id: string;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
}
export interface Material {
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  textureId?: string;
  alphaMode: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff: number;
  doubleSided: boolean;
  wrapS: number;
  wrapT: number;
  nearest: boolean;
}
export const defaultMaterial = (): Material => ({
  baseColor: [0.55, 0.6, 0.68, 1],
  metallic: 0,
  roughness: 0.65,
  alphaMode: 'OPAQUE',
  alphaCutoff: 0.5,
  doubleSided: true,
  wrapS: 10497,
  wrapT: 10497,
  nearest: false,
});
export function meshAsset(id: string, vertices: Float32Array, uvs: Float32Array): MeshAsset {
  const min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertices.length; i += 6)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], vertices[i + a]);
      max[a] = Math.max(max[a], vertices[i + a]);
    }
  return { id, vertices, uvs, count: vertices.length / 6, min, max };
}
export function meshKey(object: SceneObject) {
  return object.kind === 'mesh' ? object.meshId! : object.kind;
}
export function objectCorners(object: SceneObject, assets: Record<string, MeshAsset> = {}) {
  const mesh = object.meshId ? assets[object.meshId] : undefined;
  const helper = object.kind === 'light' || object.kind === 'camera';
  const min =
      mesh?.min ??
      (helper ? [-0.25, -0.25, -0.25] : [-1, object.kind === 'plane' ? -0.003 : -1, -1]),
    max = mesh?.max ?? (helper ? [0.25, 0.25, 0.25] : [1, object.kind === 'plane' ? 0.003 : 1, 1]);
  const m = modelMatrix(object.position, object.rotation, object.scale);
  return Array.from({ length: 8 }, (_, i) =>
    point(m, [i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]),
  );
}
export function descendants(state: SceneState, ids: Iterable<string>) {
  const result = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of state.objects)
      if (o.parentId && result.has(o.parentId) && !result.has(o.id)) {
        result.add(o.id);
        changed = true;
      }
  }
  return result;
}
// Geometry and encoded images are immutable assets. History shares them, cloning metadata only.
export function snapshot(state: SceneState): SceneState {
  return {
    ...state,
    objects: structuredClone(state.objects),
    ...(state.environment ? { environment: structuredClone(state.environment) } : {}),
    ...(state.output ? { output: structuredClone(state.output) } : {}),
    selection: [...state.selection],
    ...(state.edit ? { edit: structuredClone(state.edit) } : {}),
    meshes: { ...state.meshes },
    textures: { ...state.textures },
  };
}
export function compactAssets(state: SceneState) {
  const meshes = new Set(state.objects.flatMap((o) => [o.meshId, o.baseMeshId])),
    textures = new Set(state.objects.map((o) => o.material?.textureId));
  state.meshes = Object.fromEntries(Object.entries(state.meshes).filter(([id]) => meshes.has(id)));
  state.textures = Object.fromEntries(
    Object.entries(state.textures).filter(([id]) => textures.has(id)),
  );
}
export function toHex(color: number[]) {
  return (
    '#' +
    color
      .slice(0, 3)
      .map((v) =>
        Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function fromHex(hex: string): Vec3 {
  return [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }) as Vec3;
}
