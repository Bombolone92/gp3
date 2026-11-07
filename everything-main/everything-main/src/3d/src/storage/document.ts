import {
  validateLight,
  validateCamera,
  validateEnvironment,
  validateOutput,
} from '../core/presentation';
import { evaluateModifiers, validateModifiers, type Modifier } from '../modifiers/geometry';
import {
  topologyMesh,
  validateTopology,
  countComponents,
  type Topology,
  type EditSelection,
} from '../edit/topology';
import type { SceneObject, SceneState } from '../core/scene';
import type { Vec3 } from '../core/math';
import { meshAsset, type Material, type TextureAsset, type MeshAsset } from '../core/assets';

export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const identifier = (value: unknown): value is string =>
  text(value, 100) && !['__proto__', 'constructor', 'prototype'].includes(value);
const vector = (value: unknown, scale = false): value is Vec3 =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(
    (v) =>
      typeof v === 'number' &&
      Number.isFinite(v) &&
      (scale ? v >= 0.01 && v <= 100 : Math.abs(v) <= 10000),
  );
const unit = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
export function encodeBytes(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
function decodeBytes(value: unknown) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value))
    throw new Error('Invalid asset encoding.');
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
function material(value: unknown, textures: SceneState['textures']): Material {
  if (
    !record(value) ||
    !Array.isArray(value.baseColor) ||
    value.baseColor.length !== 4 ||
    !value.baseColor.every(unit) ||
    !unit(value.metallic) ||
    !unit(value.roughness) ||
    !unit(value.alphaCutoff) ||
    !['OPAQUE', 'MASK', 'BLEND'].includes(String(value.alphaMode)) ||
    typeof value.doubleSided !== 'boolean' ||
    typeof value.nearest !== 'boolean' ||
    ![10497, 33071, 33648].includes(Number(value.wrapS)) ||
    ![10497, 33071, 33648].includes(Number(value.wrapT)) ||
    (value.textureId !== undefined && (!identifier(value.textureId) || !textures[value.textureId]))
  )
    throw new Error('Invalid material or missing texture.');
  return {
    baseColor: [...value.baseColor] as Material['baseColor'],
    metallic: value.metallic,
    roughness: value.roughness,
    alphaCutoff: value.alphaCutoff,
    alphaMode: value.alphaMode as Material['alphaMode'],
    doubleSided: value.doubleSided,
    nearest: value.nearest,
    wrapS: Number(value.wrapS),
    wrapT: Number(value.wrapT),
    ...(value.textureId ? { textureId: String(value.textureId) } : {}),
  };
}
/** Validate and reconstruct data; never merge untrusted JSON into editor objects. */
export function parseDocument(source: string): SceneState {
  if (new TextEncoder().encode(source).byteLength > MAX_FILE_BYTES)
    throw new Error('Scene files must be smaller than 64 MB.');
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid JSON. Choose a .3d.json scene file.');
  }
  if (
    !record(data) ||
    data.format !== '3d-scene' ||
    ![1, 2, 3, 4, 5].includes(Number(data.version))
  )
    throw new Error('Unsupported scene format or version.');
  if (!text(data.name, 80) || !Array.isArray(data.objects) || data.objects.length > 5000)
    throw new Error('Invalid scene name or object list (maximum 5,000 objects).');
  const meshes: SceneState['meshes'] = Object.create(null),
    textures: SceneState['textures'] = Object.create(null);
  let vertices = 0;
  if (data.version !== 1) {
    if (
      !Array.isArray(data.meshes) ||
      !Array.isArray(data.textures) ||
      data.meshes.length > 5000 ||
      data.textures.length > 5000
    )
      throw new Error('Invalid scene asset list.');
    for (const item of data.meshes) {
      if (!record(item) || !identifier(item.id) || meshes[item.id])
        throw new Error('Invalid mesh ID.');
      if (
        (data.version === 3 || data.version === 4 || data.version === 5) &&
        record(item.topology)
      ) {
        const raw = item.topology,
          topology = {} as Topology;
        for (const key of ['positions', 'offsets', 'indices', 'uvs', 'normals', 'seams'] as const) {
          if (key === 'seams' && raw[key] === undefined) continue;
          const bytes = decodeBytes(raw[key]);
          if (bytes.length % 4) throw new Error('Invalid topology buffer.');
          const array =
            key === 'offsets' || key === 'indices' || key === 'seams'
              ? new Uint32Array(bytes.buffer)
              : new Float32Array(bytes.buffer);
          Object.assign(topology, { [key]: array });
        }
        validateTopology(topology);
        const mesh = topologyMesh(item.id, topology);
        vertices += mesh.count;
        if (vertices > 1_000_000) throw new Error('Scene exceeds 1,000,000 vertices.');
        meshes[item.id] = mesh;
        continue;
      }
      const packed = decodeBytes(item.vertices),
        uv = decodeBytes(item.uvs);
      if (!packed.length || packed.length % 72 || uv.length !== packed.length / 3)
        throw new Error('Invalid mesh buffer sizes.');
      const meshVertices = new Float32Array(packed.buffer),
        uvs = new Float32Array(uv.buffer);
      vertices += meshVertices.length / 6;
      if (
        vertices > 1_000_000 ||
        meshVertices.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e6) ||
        uvs.some((v) => !Number.isFinite(v))
      )
        throw new Error('Invalid mesh data or scene exceeds 1,000,000 vertices.');
      meshes[item.id] = meshAsset(item.id, meshVertices, uvs);
    }
    for (const item of data.textures) {
      if (
        !record(item) ||
        !identifier(item.id) ||
        textures[item.id] ||
        !text(item.name, 80) ||
        !['image/png', 'image/jpeg'].includes(String(item.mimeType))
      )
        throw new Error('Invalid texture.');
      const bytes = decodeBytes(item.bytes);
      if (!bytes.length || bytes.length > 8 * 1024 * 1024)
        throw new Error('Each texture must be smaller than 8 MB.');
      textures[item.id] = {
        id: item.id,
        name: item.name,
        mimeType: item.mimeType as TextureAsset['mimeType'],
        bytes,
      };
    }
  }
  const sourceIds = new Set(Object.keys(meshes)),
    evaluatedKeys = new Map<string, string>();
  const ids = new Set<string>();
  const objects: SceneObject[] = data.objects.map((item: unknown) => {
    if (
      !record(item) ||
      !identifier(item.id) ||
      ids.has(item.id) ||
      !text(item.name, 80) ||
      !(
        data.version === 1
          ? ['cube', 'sphere', 'plane']
          : data.version === 5
            ? ['cube', 'sphere', 'plane', 'mesh', 'group', 'light', 'camera']
            : ['cube', 'sphere', 'plane', 'mesh', 'group']
      ).includes(String(item.kind)) ||
      !vector(item.position) ||
      !vector(item.rotation) ||
      !vector(item.scale, true)
    )
      throw new Error('Scene contains an invalid object, duplicate ID, or out-of-range transform.');
    let modifiers: Modifier[] | undefined;
    if (item.modifiers !== undefined || item.baseMeshId !== undefined) {
      if (
        (data.version !== 4 && data.version !== 5) ||
        item.kind !== 'mesh' ||
        !identifier(item.baseMeshId) ||
        !sourceIds.has(item.baseMeshId) ||
        !meshes[item.baseMeshId]?.topology ||
        !identifier(item.meshId) ||
        sourceIds.has(item.meshId)
      )
        throw new Error('Invalid modifier source mesh.');
      modifiers = validateModifiers(item.modifiers);
      if (!modifiers.length)
        throw new Error('Empty modifier stacks must use their source mesh directly.');
      const key = JSON.stringify([item.baseMeshId, modifiers]);
      if (evaluatedKeys.has(item.meshId) && evaluatedKeys.get(item.meshId) !== key)
        throw new Error('Conflicting modifier asset IDs.');
      if (!evaluatedKeys.has(item.meshId)) {
        const evaluated = topologyMesh(
          item.meshId,
          evaluateModifiers(meshes[item.baseMeshId].topology!, modifiers),
        );
        vertices += evaluated.count;
        if (vertices > 1_000_000) throw new Error('Scene exceeds 1,000,000 vertices.');
        meshes[item.meshId] = evaluated;
        evaluatedKeys.set(item.meshId, key);
      }
    }
    if (item.kind === 'mesh' && (!identifier(item.meshId) || !meshes[item.meshId]))
      throw new Error('Object mesh is missing.');
    if (item.parentId !== undefined && !identifier(item.parentId))
      throw new Error('Invalid parent ID.');
    if (item.kind === 'group' && Math.max(...item.scale) - Math.min(...item.scale) > 1e-6)
      throw new Error('Group scales must be uniform.');
    if (
      (item.hidden !== undefined && typeof item.hidden !== 'boolean') ||
      (item.locked !== undefined && typeof item.locked !== 'boolean')
    )
      throw new Error('Invalid object visibility or lock.');
    ids.add(item.id);
    return {
      id: item.id,
      name: item.name,
      ...(item.hidden === true ? { hidden: true } : {}),
      ...(item.locked === true ? { locked: true } : {}),
      ...(item.kind === 'light' ? { light: validateLight(item.light) } : {}),
      ...(item.kind === 'camera' ? { camera: validateCamera(item.camera) } : {}),
      kind: item.kind as SceneObject['kind'],
      position: [...item.position],
      rotation: [...item.rotation],
      scale: [...item.scale],
      ...(item.kind === 'mesh' ? { meshId: String(item.meshId) } : {}),
      ...(modifiers ? { modifiers, baseMeshId: String(item.baseMeshId) } : {}),
      ...(item.parentId ? { parentId: String(item.parentId) } : {}),
      ...(item.material ? { material: material(item.material, textures) } : {}),
    };
  });
  if (objects.filter((o) => o.kind === 'light').length > 8)
    throw new Error('A scene supports up to eight lights.');
  if (
    data.activeCamera !== undefined &&
    (typeof data.activeCamera !== 'string' ||
      !objects.some((o) => o.id === data.activeCamera && o.kind === 'camera'))
  )
    throw new Error('Invalid active camera.');
  const lookup = new Map(objects.map((o) => [o.id, o]));
  for (const object of objects) {
    const visited = new Set([object.id]);
    let parent = object.parentId;
    while (parent) {
      const node = lookup.get(parent);
      if (!node || node.kind !== 'group' || visited.has(parent) || visited.size > 64)
        throw new Error('Invalid or cyclic scene hierarchy.');
      visited.add(parent);
      parent = node.parentId;
    }
  }
  if (
    !Array.isArray(data.selection) ||
    data.selection.some((id) => typeof id !== 'string' || !ids.has(id)) ||
    new Set(data.selection).size !== data.selection.length
  )
    throw new Error('Scene selection is invalid.');
  const selection = data.selection as string[];
  let edit: EditSelection | undefined;
  if ((data.version === 3 || data.version === 4 || data.version === 5) && data.edit !== undefined) {
    const value = data.edit;
    if (
      !record(value) ||
      !identifier(value.objectId) ||
      !['vertex', 'edge', 'face'].includes(String(value.mode)) ||
      !Array.isArray(value.ids)
    )
      throw new Error('Invalid mesh selection.');
    const object = lookup.get(value.objectId),
      topology = object?.meshId ? meshes[object.baseMeshId ?? object.meshId]?.topology : undefined;
    if (
      !topology ||
      selection.length !== 1 ||
      selection[0] !== value.objectId ||
      value.ids.some(
        (id) =>
          !Number.isInteger(id) ||
          id < 0 ||
          id >= countComponents(topology, value.mode as EditSelection['mode']),
      )
    )
      throw new Error('Invalid mesh component selection.');
    edit = {
      objectId: value.objectId,
      mode: value.mode as EditSelection['mode'],
      ids: [...new Set(value.ids)] as number[],
    };
  }
  return {
    ...(edit ? { edit } : {}),
    name: data.name,
    ...(data.environment !== undefined
      ? { environment: validateEnvironment(data.environment) }
      : {}),
    ...(data.output !== undefined ? { output: validateOutput(data.output) } : {}),
    ...(data.activeCamera !== undefined ? { activeCamera: String(data.activeCamera) } : {}),
    objects,
    selection,
    selected: selection.at(-1) ?? null,
    meshes,
    textures,
  };
}
const encodedMeshes = new WeakMap<
  MeshAsset,
  {
    id: string;
    vertices?: string;
    uvs?: string;
    topology?: Record<string, string>;
  }
>();
const encodedTextures = new WeakMap<
  TextureAsset,
  { id: string; name: string; mimeType: string; bytes: string }
>();
/** Scene mutations operate on validated metadata and immutable assets. Cache their encodings
 * so autosave never decodes or re-encodes large mesh buffers after a transform or selection. */
export function serializeDocument(state: SceneState): string {
  if (state.objects.length > 5000) throw new Error('A scene can contain at most 5,000 objects.');
  const evaluated = new Set(state.objects.filter((o) => o.baseMeshId).map((o) => o.meshId));
  const meshes = Object.values(state.meshes)
    .filter((m) => !evaluated.has(m.id))
    .map((m) => {
      let value = encodedMeshes.get(m);
      if (!value) {
        if (m.topology) {
          value = {
            id: m.id,
            topology: Object.fromEntries(
              Object.entries(m.topology).map(([key, array]) => [
                key,
                encodeBytes(new Uint8Array(array.buffer, array.byteOffset, array.byteLength)),
              ]),
            ),
          };
        } else
          value = {
            id: m.id,
            vertices: encodeBytes(
              new Uint8Array(m.vertices.buffer, m.vertices.byteOffset, m.vertices.byteLength),
            ),
            uvs: encodeBytes(new Uint8Array(m.uvs.buffer, m.uvs.byteOffset, m.uvs.byteLength)),
          };
        encodedMeshes.set(m, value);
      }
      return value;
    });
  const textures = Object.values(state.textures).map((t) => {
    let value = encodedTextures.get(t);
    if (!value) {
      value = { ...t, bytes: encodeBytes(t.bytes) };
      encodedTextures.set(t, value);
    }
    return value;
  });
  const source = JSON.stringify(
    {
      format: '3d-scene',
      version: 5,
      environment: state.environment,
      output: state.output,
      activeCamera: state.activeCamera,
      name: state.name,
      objects: state.objects,
      selection: state.selection,
      ...(state.edit ? { edit: state.edit } : {}),
      meshes,
      textures,
    },
    null,
    2,
  );
  if (new TextEncoder().encode(source).byteLength > MAX_FILE_BYTES)
    throw new Error('Scene files must be smaller than 64 MB.');
  return source;
}
export function documentFilename(name: string) {
  return `${
    name
      .replace(/[^\p{L}\p{N} _.-]/gu, '')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 80) || 'Untitled scene'
  }.3d.json`;
}
