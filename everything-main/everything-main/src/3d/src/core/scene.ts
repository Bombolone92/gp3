import {
  defaultEnvironment,
  defaultOutput,
  defaultLight,
  defaultCamera,
  validateLight,
  validateCamera,
  validateEnvironment,
  validateOutput,
  inheritedFlag,
  isMesh,
  type LightSettings,
  type CameraSettings,
  type EnvironmentSettings,
  type OutputSettings,
} from './presentation';
import type { Modifier } from '../modifiers/geometry';
import {
  axisRotation,
  add,
  sub,
  mul,
  modelMatrix,
  multiply,
  point,
  rotationFromMatrix,
  type Vec3,
} from './math';
import {
  compactAssets,
  defaultMaterial,
  descendants,
  snapshot,
  type Material,
  type MeshAsset,
  type TextureAsset,
} from './assets';
import { countComponents, type EditSelection } from '../edit/topology';
export type Primitive = 'cube' | 'sphere' | 'plane';
export type Tool = 'select' | 'move' | 'rotate' | 'scale';
export type TransformKey = 'position' | 'rotation' | 'scale';
export interface SceneObject {
  id: string;
  name: string;
  kind: Primitive | 'mesh' | 'group' | 'light' | 'camera';
  hidden?: boolean;
  locked?: boolean;
  light?: LightSettings;
  camera?: CameraSettings;
  meshId?: string;
  baseMeshId?: string;
  modifiers?: Modifier[];
  parentId?: string;
  material?: Material;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}
export interface SceneState {
  environment?: EnvironmentSettings;
  output?: OutputSettings;
  activeCamera?: string;
  edit?: EditSelection;
  objects: SceneObject[];
  selected: string | null;
  selection: string[];
  name: string;
  meshes: Record<string, MeshAsset>;
  textures: Record<string, TextureAsset>;
}
interface Entry {
  label: string;
  before: SceneState;
  after: SceneState;
}
const copy = <T>(v: T): T => structuredClone(v);
export class Scene {
  state: SceneState = {
    objects: [],
    selected: null,
    selection: [],
    name: 'Untitled scene',
    meshes: {},
    textures: {},
  };
  private groupValues = { rotation: [0, 0, 0] as Vec3, scale: [1, 1, 1] as Vec3 };
  private past: Entry[] = [];
  private future: Entry[] = [];
  private pending: { label: string; before: SceneState } | null = null;
  private listeners = new Set<() => void>();
  message = 'Ready';
  isolation: string[] = [];
  constructor(
    withDefault = true,
    private historyBudget = 128 * 1024 * 1024,
  ) {
    if (withDefault) {
      this.create('cube');
      this.past = [];
      this.message = 'Ready';
    }
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    if (!this.state.objects.some((o) => o.id === this.state.activeCamera && o.kind === 'camera'))
      delete this.state.activeCamera;
    this.isolation = this.isolation.filter((id) => this.state.objects.some((o) => o.id === id));
    const edit = this.state.edit;
    if (edit) {
      const object = this.state.objects.find((o) => o.id === edit.objectId),
        topology = object?.meshId
          ? this.state.meshes[object.baseMeshId ?? object.meshId]?.topology
          : undefined;
      if (
        !topology ||
        this.state.selected !== edit.objectId ||
        (object && (this.locked(object) || !this.visible(object)))
      )
        delete this.state.edit;
      else edit.ids = edit.ids.filter((id) => id >= 0 && id < countComponents(topology, edit.mode));
    }
    this.listeners.forEach((fn) => fn());
  }
  get environment() {
    return this.state.environment ?? defaultEnvironment();
  }
  get output() {
    return this.state.output ?? defaultOutput();
  }
  locked(object: SceneObject) {
    return inheritedFlag(this.state, object, 'locked');
  }
  visible(object: SceneObject) {
    if (inheritedFlag(this.state, object, 'hidden')) return false;
    return (
      !this.isolation.length ||
      object.kind === 'light' ||
      object.kind === 'camera' ||
      descendants(this.state, this.isolation).has(object.id)
    );
  }
  get canEditSelection() {
    return this.selectedObjects.length > 0 && this.affectedObjects.every((o) => !this.locked(o));
  }
  get pickableObjects() {
    return this.state.objects.filter((o) => this.visible(o) && !this.locked(o));
  }
  setFlag(id: string, key: 'hidden' | 'locked', value: boolean) {
    const o = this.state.objects.find((o) => o.id === id);
    if (!o) return;
    this.edit(key === 'hidden' ? 'Changed visibility' : 'Changed lock', () => {
      if (value) o[key] = true;
      else delete o[key];
    });
  }
  isolate() {
    this.isolation = this.isolation.length ? [] : [...this.state.selection];
    this.emit();
  }
  createCollection() {
    if (this.state.objects.length >= 5000)
      throw new Error('A scene can contain at most 5,000 objects.');
    let result!: SceneObject;
    this.edit('Created collection', () => {
      const movable = this.canEditSelection ? this.selectedObjects : [];
      const ids = descendants(
        this.state,
        movable.map((o) => o.id),
      );
      const roots = movable.filter((o) => !o.parentId || !ids.has(o.parentId));
      for (const object of this.state.objects.filter((o) => ids.has(o.id))) {
        let depth = 1,
          current = object;
        while (current.parentId && ids.has(current.parentId)) {
          depth++;
          current = this.state.objects.find((o) => o.id === current.parentId)!;
        }
        if (depth > 63) throw new Error('Collection nesting is limited to 64 levels.');
      }
      let name = 'Collection',
        n = 2;
      while (this.state.objects.some((o) => o.name === name)) name = `Collection ${n++}`;
      result = {
        id: crypto.randomUUID(),
        name,
        kind: 'group',
        position: roots.length ? this.center(roots) : [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
      this.state.objects.push(result);
      for (const o of roots) o.parentId = result.id;
      delete this.state.edit;
      this.state.selection = [result.id];
      this.state.selected = result.id;
    });
    return result;
  }
  reparent(ids: string[], parentId?: string) {
    const parent = this.state.objects.find((o) => o.id === parentId);
    if (parentId && (!parent || parent.kind !== 'group' || this.locked(parent)))
      throw new Error('Choose an unlocked collection.');
    const selected = this.state.objects.filter((o) => ids.includes(o.id));
    if (!selected.length || selected.some((o) => this.locked(o)))
      throw new Error('Unlock the selected objects before moving them.');
    const children = descendants(this.state, ids);
    if (parentId && children.has(parentId))
      throw new Error('A collection cannot be moved inside itself or its descendants.');
    // Keep only selected roots; their descendants follow without changing world transforms.
    const roots = selected.filter((o) => !o.parentId || !children.has(o.parentId));
    for (const root of roots) {
      let depth = 0,
        current = parent;
      while (current) {
        depth++;
        current = this.state.objects.find((o) => o.id === current!.parentId);
      }
      const below = (id: string): number =>
        Math.max(
          0,
          ...this.state.objects.filter((o) => o.parentId === id).map((o) => 1 + below(o.id)),
        );
      if (depth + below(root.id) > 63)
        throw new Error('Collection nesting is limited to 64 levels.');
    }
    this.edit('Moved to collection', () => {
      for (const o of roots) {
        if (parentId) o.parentId = parentId;
        else delete o.parentId;
      }
    });
  }
  addLight(type: LightSettings['type']) {
    if (this.state.objects.filter((o) => o.kind === 'light').length >= 8)
      throw new Error('A scene supports up to eight lights.');
    return this.addPresentation('light', {
      light: defaultLight(type),
      position: [3, 5, 4],
      rotation: [-45, 35, 0],
    });
  }
  addCamera(position: Vec3, rotation: Vec3, focalLength = 50) {
    if ([...position, ...rotation].some((v) => !Number.isFinite(v) || Math.abs(v) > 10000))
      throw new Error('Camera position must be within 10,000 meters of the origin.');
    return this.addPresentation('camera', {
      camera: validateCamera({ ...defaultCamera(), focalLength }),
      position,
      rotation,
    });
  }
  private addPresentation(kind: 'light' | 'camera', fields: Partial<SceneObject>) {
    if (this.state.objects.length >= 5000)
      throw new Error('A scene can contain at most 5,000 objects.');
    let object!: SceneObject;
    this.edit(`Added ${kind}`, () => {
      const base =
        kind === 'camera'
          ? 'Camera'
          : `${fields.light!.type[0].toUpperCase()}${fields.light!.type.slice(1)} light`;
      let name = base,
        n = 2;
      while (this.state.objects.some((o) => o.name === name)) name = `${base} ${n++}`;
      object = {
        id: crypto.randomUUID(),
        kind,
        name,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...fields,
      };
      this.state.objects.push(object);
      this.state.selected = object.id;
      this.state.selection = [object.id];
      delete this.state.edit;
      if (kind === 'camera') this.state.activeCamera = object.id;
      else this.state.environment = { ...this.environment, studio: false };
    });
    return object;
  }
  setLight(patch: Partial<LightSettings>) {
    const o = this.selected;
    if (o?.light && this.canEditSelection) {
      const value = validateLight({ ...o.light, ...patch });
      this.edit('Changed light', () => (o.light = value));
    }
  }
  setCamera(patch: Partial<CameraSettings>) {
    const o = this.selected;
    if (o?.camera && this.canEditSelection) {
      const value = validateCamera({ ...o.camera, ...patch });
      this.edit('Changed camera', () => (o.camera = value));
    }
  }
  updateCameraPose(id: string, position: Vec3, rotation: Vec3) {
    if ([...position, ...rotation].some((v) => !Number.isFinite(v) || Math.abs(v) > 10000))
      throw new Error('Camera position must be within 10,000 meters of the origin.');
    const o = this.state.objects.find((o) => o.id === id);
    if (o?.camera && !this.locked(o))
      this.edit('Camera from view', () => {
        o.position = [...position];
        o.rotation = [...rotation];
      });
  }
  setActiveCamera(id?: string) {
    if (id && !this.state.objects.some((o) => o.id === id && o.kind === 'camera')) return;
    this.edit('Changed render camera', () => {
      if (id) this.state.activeCamera = id;
      else delete this.state.activeCamera;
    });
  }
  setEnvironment(patch: Partial<EnvironmentSettings>) {
    const value = validateEnvironment({ ...this.environment, ...patch });
    this.edit('Changed environment', () => (this.state.environment = value));
  }
  setOutput(patch: Partial<OutputSettings>) {
    const value = validateOutput({ ...this.output, ...patch });
    this.edit('Changed output', () => (this.state.output = value));
  }
  get selected() {
    return this.state.objects.find((o) => o.id === this.state.selected) ?? null;
  }
  get selectedObjects() {
    const ids = new Set(this.state.selection);
    return this.state.objects.filter((o) => ids.has(o.id));
  }
  isSelected(id: string) {
    return this.state.selection.includes(id);
  }
  get affectedObjects() {
    const ids = descendants(this.state, this.state.selection);
    return this.state.objects.filter((o) => ids.has(o.id));
  }
  get batchTransform() {
    return this.state.selection.length > 1 || this.selected?.kind === 'group';
  }
  setEdit(selection: EditSelection | null) {
    if (this.pending) this.cancel();
    if (selection) this.state.edit = structuredClone(selection);
    else delete this.state.edit;
    this.emit();
  }
  enterEdit(mesh: MeshAsset) {
    const object = this.selected;
    if (!object || !isMesh(object) || !this.canEditSelection) return;
    this.edit('Convert to editable mesh', () => {
      object.kind = 'mesh';
      object.meshId = mesh.id;
      this.state.meshes = { ...this.state.meshes, [mesh.id]: mesh };
      this.state.edit = { objectId: object.id, mode: 'face', ids: [] };
    });
  }
  replaceGeometry(base: MeshAsset, evaluated: MeshAsset, modifiers: Modifier[] = []) {
    const object = this.selected;
    if (!object || !isMesh(object) || !this.canEditSelection) return;
    const used = new Set(
      this.state.objects.filter((o) => o.id !== object.id).flatMap((o) => [o.meshId, o.baseMeshId]),
    );
    const assets = {
      ...Object.fromEntries(Object.entries(this.state.meshes).filter(([id]) => used.has(id))),
      [base.id]: base,
      [evaluated.id]: evaluated,
    };
    if (Object.values(assets).reduce((n, m) => n + m.count, 0) > 1_000_000)
      throw new Error('The edit would exceed the scene mesh budget.');
    object.kind = 'mesh';
    object.meshId = evaluated.id;
    if (modifiers.length) {
      object.baseMeshId = base.id;
      object.modifiers = structuredClone(modifiers);
    } else {
      object.meshId = base.id;
      delete object.baseMeshId;
      delete object.modifiers;
    }
    this.state.meshes = assets;
    compactAssets(this.state);
  }
  updateMesh(mesh: MeshAsset, ids?: number[], evaluated = mesh, mode?: EditSelection['mode']) {
    const edit = this.state.edit,
      object = this.selected;
    if (!edit || !object) return;
    const own = !this.pending;
    if (own) this.begin('Edited mesh');
    this.replaceGeometry(mesh, evaluated, object.modifiers ?? []);
    if (ids) edit.ids = [...ids];
    if (mode) edit.mode = mode;
    if (own) this.commit();
    else this.emit();
  }
  rotateAxis(axis: Vec3, degrees: number) {
    if (!this.selected || !this.canEditSelection || !Number.isFinite(degrees)) return;
    const own = !this.pending;
    if (own) this.begin('Rotated selection');
    const before = this.pending!.before,
      ids = descendants(before, before.selection),
      objects = before.objects.filter((o) => ids.has(o.id)),
      pivot = this.center(before.objects.filter((o) => before.selection.includes(o.id))),
      rotation = axisRotation(axis, degrees);
    const changes = objects.map((o) => ({
      ...o,
      position:
        objects.length > 1 ? add(pivot, point(rotation, sub(o.position, pivot), 0)) : o.position,
      rotation: rotationFromMatrix(
        multiply(rotation, modelMatrix([0, 0, 0], o.rotation, [1, 1, 1])),
      ),
    }));
    if (changes.every((o) => o.position.every((v) => Math.abs(v) <= 10000)))
      for (const next of changes)
        Object.assign(
          this.state.objects.find((o) => o.id === next.id)!,
          next,
        );
    if (own) this.commit();
    else this.emit();
  }
  importAssets(
    objects: SceneObject[],
    meshes: Record<string, MeshAsset>,
    textures: Record<string, TextureAsset>,
  ) {
    if (this.state.objects.length + objects.length > 5000)
      throw new Error('A scene can contain at most 5,000 objects.');
    if ([...this.state.objects, ...objects].filter((o) => o.kind === 'light').length > 8)
      throw new Error('A scene supports up to eight lights.');
    this.edit('Imported GLB', () => {
      delete this.state.edit;
      this.state.objects.push(...structuredClone(objects));
      this.state.meshes = { ...this.state.meshes, ...meshes };
      this.state.textures = { ...this.state.textures, ...textures };
      this.state.selection = objects.filter((o) => !o.parentId).map((o) => o.id);
      this.state.selected = this.state.selection.at(-1) ?? null;
    });
  }
  setMaterial(patch: Partial<Material>, texture?: TextureAsset, channels?: 'rgb' | 'alpha') {
    const objects = this.affectedObjects.filter(isMesh);
    if (!objects.length || !this.canEditSelection) return;
    this.edit('Changed material', () => {
      if (texture) this.state.textures = { ...this.state.textures, [texture.id]: texture };
      for (const o of objects) {
        const old = o.material ?? defaultMaterial();
        o.material = { ...old, ...structuredClone(patch) };
        if (channels === 'rgb') o.material.baseColor[3] = old.baseColor[3];
        if (channels === 'alpha')
          o.material.baseColor = [
            old.baseColor[0],
            old.baseColor[1],
            old.baseColor[2],
            o.material.baseColor[3],
          ];
        if (!o.material.textureId) delete o.material.textureId;
      }
    });
  }
  private center(objects: SceneObject[]): Vec3 {
    return objects.length
      ? mul(
          objects.reduce((sum, o) => add(sum, o.position), [0, 0, 0] as Vec3),
          1 / objects.length,
        )
      : [0, 0, 0];
  }
  get transformTarget(): SceneObject | null {
    const objects = this.selectedObjects;
    if (!this.batchTransform) return this.selected;
    if (!objects.length) return null;
    return {
      ...objects[0],
      name: objects.length === 1 ? objects[0].name : `${objects.length} objects selected`,
      position: this.center(objects),
      rotation: this.pending ? this.groupValues.rotation : [0, 0, 0],
      scale: this.pending ? this.groupValues.scale : [1, 1, 1],
    };
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get inTransaction() {
    return this.pending !== null;
  }
  get undoLabel() {
    return this.past.at(-1)?.label ?? '';
  }
  begin(label: string) {
    if (this.pending) this.commit();
    this.pending = { label, before: snapshot(this.state) };
    this.groupValues = { rotation: [0, 0, 0], scale: [1, 1, 1] };
  }
  commit() {
    if (!this.pending) return;
    const { label, before } = this.pending;
    this.pending = null;
    compactAssets(this.state);
    if (
      JSON.stringify(before.objects) !== JSON.stringify(this.state.objects) ||
      before.name !== this.state.name ||
      JSON.stringify([before.environment, before.output, before.activeCamera]) !==
        JSON.stringify([this.state.environment, this.state.output, this.state.activeCamera])
    ) {
      this.past.push({ label, before, after: snapshot(this.state) });
      if (this.past.length > 100) this.past.shift();
      this.future = [];
      this.trimHistory();
      this.message = label;
    }
    this.emit();
  }
  private trimHistory() {
    const bytes = () => {
      const meshes = new Set<MeshAsset>(),
        textures = new Set<TextureAsset>();
      for (const entry of this.past)
        for (const state of [entry.before, entry.after]) {
          Object.values(state.meshes).forEach((mesh) => meshes.add(mesh));
          Object.values(state.textures).forEach((texture) => textures.add(texture));
        }
      let total = 0;
      for (const mesh of meshes) {
        total +=
          mesh.vertices.byteLength + mesh.uvs.byteLength + (mesh.triangleFaces?.byteLength ?? 0);
        if (mesh.topology)
          total += Object.values(mesh.topology).reduce((sum, array) => sum + array.byteLength, 0);
      }
      for (const texture of textures) total += texture.bytes.byteLength;
      return total;
    };
    while (this.past.length > 1 && bytes() > this.historyBudget) this.past.shift();
  }
  cancel() {
    if (this.pending) {
      this.state = this.pending.before;
      this.pending = null;
      this.message = 'Change cancelled';
      this.emit();
    }
  }
  private edit(label: string, fn: () => void) {
    this.begin(label);
    try {
      fn();
      this.commit();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  create(kind: Primitive) {
    if (this.state.objects.length >= 5000)
      throw new Error('A scene can contain at most 5,000 objects.');
    let result!: SceneObject;
    this.edit(`Added ${kind}`, () => {
      const base = kind[0].toUpperCase() + kind.slice(1);
      let name = base,
        n = 2;
      while (this.state.objects.some((o) => o.name === name))
        name = `${base} ${String(n++).padStart(2, '0')}`;
      result = {
        id: crypto.randomUUID(),
        name,
        kind,
        position: [0, kind === 'plane' ? 0 : 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      };
      delete this.state.edit;
      this.state.objects.push(result);
      this.state.selected = result.id;
      this.state.selection = [result.id];
    });
    return result;
  }
  select(id: string | null, toggle = false) {
    if (this.pending) this.commit();
    const valid = this.state.objects.some((o) => o.id === id) ? id : null;
    if (toggle && valid) {
      this.state.selection = this.isSelected(valid)
        ? this.state.selection.filter((i) => i !== valid)
        : [...this.state.selection, valid];
      this.state.selected = this.state.selection.at(-1) ?? null;
    } else if (!toggle) {
      this.state.selected = valid;
      this.state.selection = valid ? [valid] : [];
    }
    this.emit();
  }
  selectAll() {
    if (this.pending) this.commit();
    this.state.selection = this.state.objects.map((o) => o.id);
    this.state.selected = this.state.selection.at(-1) ?? null;
    this.emit();
  }
  open(state: SceneState, restore = false) {
    this.isolation = [];
    if (restore) {
      this.state = snapshot(state);
      this.past = [];
      this.future = [];
      this.pending = null;
      this.message = 'Recovered scene';
      this.emit();
    } else this.edit('Opened scene', () => (this.state = snapshot(state)));
  }
  duplicateSelected() {
    if (!this.selected || !this.canEditSelection) return;
    if (this.state.objects.length + this.affectedObjects.length > 5000) {
      this.message = 'Cannot duplicate: a scene can contain at most 5,000 objects.';
      this.emit();
      return;
    }
    if (
      this.state.objects.filter((o) => o.kind === 'light').length +
        this.affectedObjects.filter((o) => o.kind === 'light').length >
      8
    ) {
      this.message = 'Cannot duplicate: a scene supports up to eight lights.';
      this.emit();
      return;
    }
    this.edit('Duplicated selection', () => {
      delete this.state.edit;
      const originals = this.affectedObjects,
        copies: SceneObject[] = [];
      const remap = new Map(originals.map((o) => [o.id, crypto.randomUUID()]));
      for (const original of originals) {
        const base = original.name.replace(/ copy(?: \d+)?$/, '').slice(0, 64);
        let name = `${base} copy`,
          n = 2;
        while (this.state.objects.some((o) => o.name === name)) name = `${base} copy ${n++}`;
        const object = {
          ...copy(original),
          id: remap.get(original.id)!,
          ...(original.parentId
            ? { parentId: remap.get(original.parentId) ?? original.parentId }
            : {}),
          name,
          position: add(original.position, [1, 0, 1]),
        };
        this.state.objects.push(object);
        copies.push(object);
      }
      this.state.selection = this.state.selection.map((id) => remap.get(id)!);
      this.state.selected = this.state.selection.at(-1)!;
    });
  }
  rename(id: string, name: string) {
    const o = this.state.objects.find((o) => o.id === id);
    const value = name.trim().slice(0, 80);
    if (o && !this.locked(o) && value && o.name !== value)
      this.edit('Renamed object', () => (o.name = value));
  }
  renameScene(name: string) {
    const value = name.trim().slice(0, 80);
    if (value && value !== this.state.name)
      this.edit('Renamed scene', () => (this.state.name = value));
  }
  deleteSelected() {
    if (!this.selected || !this.canEditSelection) return;
    const ids = descendants(this.state, this.state.selection);
    this.edit('Deleted object', () => {
      this.state.objects = this.state.objects.filter((o) => !ids.has(o.id));
      this.state.selected = null;
      this.state.selection = [];
    });
  }
  transform(key: TransformKey, value: Vec3) {
    const o = this.selected;
    if (!o || !this.canEditSelection || value.some((v) => !Number.isFinite(v))) return;
    if (key === 'scale' && !this.batchTransform && (o.kind === 'light' || o.kind === 'camera'))
      return;
    const valid = value.map((v) =>
      key === 'scale' ? Math.max(0.01, Math.min(100, v)) : Math.max(-10000, Math.min(10000, v)),
    ) as Vec3;
    if (this.batchTransform) {
      const own = !this.pending;
      if (own) this.begin(`Changed selection ${key}`);
      const affected = descendants(this.pending!.before, this.state.selection);
      const baseline = this.pending!.before.objects.filter((o) => affected.has(o.id));
      const pivot = this.center(baseline.filter((o) => this.isSelected(o.id)));
      const rotation = modelMatrix([0, 0, 0], valid, [1, 1, 1]);
      let factor = value.find((v) => v !== 1) ?? 1;
      // Uniform group scaling preserves rotations without introducing shear.
      factor = Math.max(
        ...baseline.flatMap((o) => o.scale.map((v) => 0.01 / v)),
        Math.min(factor, ...baseline.flatMap((o) => o.scale.map((v) => 100 / v))),
      );
      const results = baseline.map((original) => {
        const next = copy(original);
        if (key === 'position') next.position = add(original.position, sub(valid, pivot));
        if (key === 'rotation' && valid.some((v) => v !== 0)) {
          next.position = add(pivot, point(rotation, sub(original.position, pivot), 0));
          next.rotation = rotationFromMatrix(
            multiply(rotation, modelMatrix([0, 0, 0], original.rotation, [1, 1, 1])),
          );
        }
        if (key === 'scale') {
          next.position = add(pivot, mul(sub(original.position, pivot), factor));
          next.scale = mul(original.scale, factor).map((v) =>
            Math.max(0.01, Math.min(100, v)),
          ) as Vec3;
        }
        return next;
      });
      if (results.every((o) => o.position.every((v) => Math.abs(v) <= 10000))) {
        for (const next of results)
          Object.assign(
            this.state.objects.find((o) => o.id === next.id)!,
            next,
          );
        if (key === 'rotation') this.groupValues.rotation = valid;
        if (key === 'scale') this.groupValues.scale = [factor, factor, factor];
      }
      if (own) this.commit();
      else this.emit();
    } else if (this.pending) {
      o[key] = valid;
      this.emit();
    } else this.edit(`Changed ${key}`, () => (o[key] = valid));
  }
  undo() {
    if (this.pending) this.cancel();
    const e = this.past.pop();
    if (!e) return;
    this.future.push(e);
    this.state = snapshot(e.before);
    this.message = `Undo: ${e.label.toLowerCase()}`;
    this.emit();
  }
  redo() {
    if (this.pending) this.cancel();
    const e = this.future.pop();
    if (!e) return;
    this.past.push(e);
    this.state = snapshot(e.after);
    this.message = `Redo: ${e.label.toLowerCase()}`;
    this.emit();
  }
}
