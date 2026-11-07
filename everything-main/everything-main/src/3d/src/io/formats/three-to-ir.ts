// three.js Object3D hierarchy (as produced by three's MIT loaders) → IR.
// Meshes are triangle soups; `commitScene` with `mergeVertices` re-welds them.
import {
  AnimationClip,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Light,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  SkinnedMesh,
  Texture,
  Vector3,
  Bone,
  InterpolateDiscrete,
  InterpolateSmooth,
  type KeyframeTrack,
} from 'three';
import { emptyScene, Y_UP_TO_Z_UP, type IRChannel, type IRMaterial, type IRMesh, type IRNode, type IRScene, type IRTexRef } from './ir';
import { sniffMime } from './common';

export interface ThreeToIROptions {
  /** resolve a texture to encoded bytes (e.g. from the files the user selected) */
  textureBytes?: (tex: Texture) => { bytes: Uint8Array; name: string } | null;
}

/**
 * Convert the children of `root` (whose own matrix is treated as the root coordinate conversion,
 * e.g. ColladaLoader's Z-up rotation and unit scale) into an IR scene.
 */
export function threeToIR(root: Object3D, animations: AnimationClip[] = [], opts: ThreeToIROptions = {}): IRScene {
  const ir = emptyScene();
  const W = ir.warnings;
  root.updateMatrix();
  // root conversion: Y-up (three) → Z-up, composed with the root's own transform
  const rootM = root.matrix.clone();
  const s = new Vector3().setFromMatrixScale(rootM);
  const rot = new Matrix4().extractRotation(rootM);
  const yz = new Matrix4().set(
    Y_UP_TO_Z_UP[0],
    Y_UP_TO_Z_UP[1],
    Y_UP_TO_Z_UP[2],
    0,
    Y_UP_TO_Z_UP[3],
    Y_UP_TO_Z_UP[4],
    Y_UP_TO_Z_UP[5],
    0,
    Y_UP_TO_Z_UP[6],
    Y_UP_TO_Z_UP[7],
    Y_UP_TO_Z_UP[8],
    0,
    0,
    0,
    0,
    1,
  );
  const A = yz.multiply(rot).elements;
  // row-major 3x3 from the column-major 4x4
  ir.axis = [A[0], A[4], A[8], A[1], A[5], A[9], A[2], A[6], A[10]].map((v) => (Math.abs(v) < 1e-9 ? 0 : Math.round(v * 1e9) / 1e9));
  ir.unitScale = s.x || 1;
  ir.unitScaleMode = 'ROOT';

  const nodeOf = new Map<Object3D, number>();
  const matIndex = new Map<Material, number>();
  const imgIndex = new Map<Texture, number>();
  const texRef = (t: Texture | null | undefined, channel?: IRTexRef['channel']): IRTexRef | undefined => {
    if (!t) return undefined;
    let i = imgIndex.get(t);
    if (i === undefined) {
      const r = opts.textureBytes?.(t) ?? null;
      i = ir.images.length;
      const name = r?.name || t.name || 'Texture';
      ir.images.push({ name, mime: r ? sniffMime(r.bytes, name) : '', bytes: r?.bytes ?? null, uri: name });
      imgIndex.set(t, i);
    }
    const ref: IRTexRef = { image: i, channel };
    if (t.offset.x || t.offset.y) ref.offset = [t.offset.x, t.offset.y];
    if (t.repeat.x !== 1 || t.repeat.y !== 1) ref.scale = [t.repeat.x, t.repeat.y];
    if (t.rotation) ref.rotation = t.rotation;
    return ref;
  };
  const materialFor = (m: Material): number => {
    let i = matIndex.get(m);
    if (i !== undefined) return i;
    const a = m as Material & {
      color?: Color;
      map?: Texture | null;
      normalMap?: Texture | null;
      emissive?: Color;
      emissiveMap?: Texture | null;
      emissiveIntensity?: number;
      roughness?: number;
      metalness?: number;
      shininess?: number;
      specular?: Color;
      vertexColors?: boolean;
      alphaMap?: Texture | null;
      normalScale?: { x: number };
    };
    const c = a.color ?? new Color(0.8, 0.8, 0.8);
    const mat: IRMaterial = {
      name: m.name || 'Material',
      baseColor: [c.r, c.g, c.b, m.opacity ?? 1],
      metallic: a.metalness ?? 0,
      roughness: a.roughness ?? (a.shininess !== undefined ? Math.min(1, Math.max(0, 1 - Math.sqrt(Math.min(1000, a.shininess) / 1000))) : 0.5),
      baseColorTex: texRef(a.map),
      emissive: a.emissive && (a.emissive.r || a.emissive.g || a.emissive.b) ? [a.emissive.r, a.emissive.g, a.emissive.b] : undefined,
      emissiveStrength: a.emissiveIntensity ?? 1,
      emissiveTex: texRef(a.emissiveMap),
      alphaTex: texRef(a.alphaMap, 'G'),
      doubleSided: m.side === DoubleSide,
      useVertexColor: !!a.vertexColors,
    };
    if (a.normalMap) mat.normalTex = { ...texRef(a.normalMap)!, strength: a.normalScale?.x ?? 1 };
    if (mat.baseColorTex) mat.baseColor = [c.r, c.g, c.b, mat.baseColor[3]];
    if (m.transparent || (m.opacity ?? 1) < 1) mat.alphaMode = 'BLEND';
    if (m.alphaTest > 0) {
      mat.alphaMode = 'MASK';
      mat.alphaCutoff = m.alphaTest;
    }
    if (m.type === 'MeshBasicMaterial') mat.unlit = true;
    i = ir.materials.length;
    ir.materials.push(mat);
    matIndex.set(m, i);
    return i;
  };

  const meshFor = (obj: Mesh): number | null => {
    const g = obj.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    if (!pos) return null;
    const nv = pos.count;
    const index = g.getIndex();
    const tri: number[] = [];
    if (index) for (let i = 0; i < index.count; i++) tri.push(index.getX(i));
    else for (let i = 0; i < nv; i++) tri.push(i);
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: tri.length, materialIndex: 0 }];
    const faceSizes: number[] = [],
      indices: number[] = [],
      matIndexArr: number[] = [];
    for (const gr of groups) {
      const end = Math.min(tri.length, gr.start + gr.count);
      for (let i = gr.start; i + 2 < end; i += 3) {
        faceSizes.push(3);
        indices.push(tri[i], tri[i + 1], tri[i + 2]);
        matIndexArr.push(gr.materialIndex ?? 0);
      }
    }
    if (!faceSizes.length) {
      W.push(`"${obj.name}": geometry without triangles was skipped`);
      return null;
    }
    const attr = (name: string, k: number) => {
      const a = g.getAttribute(name);
      if (!a) return undefined;
      const out = new Float32Array(indices.length * k);
      indices.forEach((v, c) => {
        out[c * k] = a.getX(v);
        if (k > 1) out[c * k + 1] = a.getY(v);
        if (k > 2) out[c * k + 2] = a.getZ(v);
        if (k > 3) out[c * k + 3] = a.itemSize > 3 ? a.getW(v) : 1;
      });
      return out;
    };
    const positions = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) positions.set([pos.getX(v), pos.getY(v), pos.getZ(v)], v * 3);
    const uv = attr('uv', 2);
    const mesh: IRMesh = {
      name: g.name || obj.name || 'Mesh',
      positions,
      faceSizes: new Uint32Array(faceSizes),
      indices: new Uint32Array(indices),
      normals: attr('normal', 3),
      uvs: uv,
      materialIndex: Uint16Array.from(matIndexArr),
      materials: mats.map((m) => (m ? materialFor(m) : -1)),
      colors: g.getAttribute('color') ? [{ name: 'Color', domain: 'CORNER', data: attr('color', 4)! }] : undefined,
    };
    // morph targets (relative in three when morphTargetsRelative, absolute otherwise)
    const morphs = g.morphAttributes.position;
    if (morphs?.length) {
      const names = Object.keys(obj.morphTargetDictionary ?? {}).sort((a, b) => obj.morphTargetDictionary![a] - obj.morphTargetDictionary![b]);
      mesh.shapeKeys = morphs.map((m, k) => {
        const p = new Float32Array(positions.length);
        for (let v = 0; v < nv; v++) {
          const x = m.getX(v),
            y = m.getY(v),
            z = m.getZ(v);
          if (g.morphTargetsRelative) p.set([positions[v * 3] + x, positions[v * 3 + 1] + y, positions[v * 3 + 2] + z], v * 3);
          else p.set([x, y, z], v * 3);
        }
        return { name: names[k] ?? `Key ${k + 1}`, positions: p };
      });
    }
    // skin weights
    const si = g.getAttribute('skinIndex'),
      sw = g.getAttribute('skinWeight');
    if (obj instanceof SkinnedMesh && si && sw) {
      const nb = obj.skeleton.bones.length;
      const weights = Array.from({ length: nb }, () => new Float32Array(nv));
      for (let v = 0; v < nv; v++)
        for (let k = 0; k < 4; k++) {
          const j = [si.getX(v), si.getY(v), si.getZ(v), si.getW(v)][k];
          const w = [sw.getX(v), sw.getY(v), sw.getZ(v), sw.getW(v)][k];
          if (w > 0 && j < nb) weights[j][v] += w;
        }
      mesh.groups = { names: obj.skeleton.bones.map((b) => b.name), weights };
      // bind-space positions: bindMatrix · v
      const bm = obj.bindMatrix;
      const t = new Vector3();
      for (let v = 0; v < nv; v++) {
        t.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]).applyMatrix4(bm);
        positions.set([t.x, t.y, t.z], v * 3);
      }
      if (mesh.normals) {
        const nm = new Matrix4().copy(bm).invert().transpose();
        for (let c = 0; c < mesh.normals.length; c += 3) {
          t.set(mesh.normals[c], mesh.normals[c + 1], mesh.normals[c + 2]).transformDirection(nm);
          mesh.normals.set([t.x, t.y, t.z], c);
        }
      }
    }
    ir.meshes.push(mesh);
    return ir.meshes.length - 1;
  };

  const visit = (obj: Object3D, parent: number) => {
    obj.updateMatrix();
    const node: IRNode = { name: obj.name || obj.type, parent, matrix: obj.matrix.toArray() };
    const idx = ir.nodes.length;
    ir.nodes.push(node);
    nodeOf.set(obj, idx);
    if (obj instanceof Bone) node.isBone = true;
    if (!obj.visible) node.hidden = true;
    if ((obj as Mesh).isMesh) {
      const mi = meshFor(obj as Mesh);
      if (mi !== null) node.mesh = mi;
    } else if ((obj as Camera).isCamera) {
      if (obj instanceof PerspectiveCamera) node.camera = { type: 'PERSP', yfov: obj.fov * (Math.PI / 180), clipStart: obj.near, clipEnd: obj.far, scaleClip: true };
      else if (obj instanceof OrthographicCamera)
        node.camera = { type: 'ORTHO', orthoScale: Math.max(obj.right - obj.left, obj.top - obj.bottom) / (obj.zoom || 1), clipStart: obj.near, clipEnd: obj.far, scaleClip: true };
    } else if ((obj as Light).isLight) {
      const l = obj as Light & { angle?: number; penumbra?: number; distance?: number; isDirectionalLight?: boolean; isSpotLight?: boolean; isPointLight?: boolean; isAmbientLight?: boolean };
      const color: [number, number, number] = [l.color.r, l.color.g, l.color.b];
      if (l.isAmbientLight || (l as Light & { isHemisphereLight?: boolean }).isHemisphereLight) W.push(`Ambient light "${obj.name}" is not imported (use the World color)`);
      else if (l.isDirectionalLight) node.light = { type: 'SUN', color, energy: l.intensity };
      else if (l.isSpotLight) node.light = { type: 'SPOT', color, energy: l.intensity * 1000, spotSize: 2 * (l.angle ?? Math.PI / 4), spotBlend: l.penumbra ?? 0, range: l.distance || undefined };
      else node.light = { type: 'POINT', color, energy: l.intensity * 1000, range: l.distance || undefined };
    }
    for (const c of obj.children) {
      // three lights keep their target as a child; it is not part of the scene description
      if ((obj as Light).isLight && c === (obj as Light & { target?: Object3D }).target) continue;
      visit(c, idx);
    }
  };
  for (const c of root.children) visit(c, -1);

  // skins
  root.traverse((o) => {
    if (!(o instanceof SkinnedMesh)) return;
    const ni = nodeOf.get(o);
    if (ni === undefined) return;
    const joints = o.skeleton.bones.map((b) => nodeOf.get(b) ?? -1);
    if (joints.some((j) => j < 0)) {
      W.push(`"${o.name}": skeleton bones outside the scene; skin not imported`);
      return;
    }
    // vertices were moved into bind space; IBM = bone inverse (bind world → joint)
    ir.nodes[ni].skin = ir.skins.length;
    ir.skins.push({ name: o.skeleton.bones[0]?.parent?.name || 'Armature', joints, inverseBind: o.skeleton.boneInverses.map((m) => m.toArray()) });
  });

  // animation clips
  const byName = new Map<string, number>();
  for (const [o, i] of nodeOf) {
    if (o.name && !byName.has(o.name)) byName.set(o.name, i);
    byName.set(o.uuid, i);
  }
  for (const clip of animations) {
    const channels: IRChannel[] = [];
    for (const track of clip.tracks as KeyframeTrack[]) {
      const dot = track.name.lastIndexOf('.');
      const target = track.name.slice(0, dot),
        prop = track.name.slice(dot + 1);
      const node = byName.get(target);
      if (node === undefined) continue;
      const interp = track.getInterpolation() === InterpolateDiscrete ? 'STEP' : 'LINEAR';
      if (track.getInterpolation() === InterpolateSmooth) W.push(`Animation "${clip.name}": smooth interpolation is approximated linearly`);
      const path = prop === 'position' ? 'translation' : prop === 'quaternion' ? 'rotation' : prop === 'scale' ? 'scale' : prop.startsWith('morphTargetInfluences') ? 'weights' : null;
      if (!path) {
        W.push(`Animation track "${track.name}" is not supported`);
        continue;
      }
      channels.push({ node, path, times: Array.from(track.times), values: Array.from(track.values), interpolation: interp });
    }
    if (channels.length) ir.animations.push({ name: clip.name || 'Animation', channels });
  }
  return ir;
}
