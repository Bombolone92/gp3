// Import scene files written by the previous version of this app (.3d.json, Y-up, versions 1–5).
import { Matrix4, Quaternion, Vector3, Euler } from 'three';
import { parseDocument } from '../storage/document';
import type { SceneObject } from '../core/scene';
import type { DocumentData, ObjectData } from '../data/types';
import { emptyDocument, newCollection, newObject, newMeshData, newLight, newCamera, newMaterial, uid } from '../data/defaults';
import { buildMesh, type PolyFace } from '../mesh/mesh';
import * as prim from '../mesh/primitives';
import { applyMatrixToObject, fromMatrix4 } from '../eval/transform';
import { newModifier } from '../eval/modifiers';

// Y-up (x, y, z) → Z-up (x, -z, y): rotation of +90° about X.
const C = new Matrix4().makeRotationX(Math.PI / 2);
const Cinv = C.clone().invert();

function convertPositions(src: ArrayLike<number>): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    out[i] = src[i];
    out[i + 1] = -src[i + 2];
    out[i + 2] = src[i + 1];
  }
  return out;
}

export function importLegacyScene(text: string): DocumentData {
  const st = parseDocument(text);
  const doc = emptyDocument();
  const col = newCollection('Collection');
  doc.collections[col.id] = col;
  doc.collections[doc.scene.collection].children.push(col.id);
  doc.scene.name = st.name || 'Scene';
  const idMap = new Map<string, string>();
  const worldOf = new Map<string, Matrix4>();
  const meshCache = new Map<string, string>();

  const meshFromAsset = (assetId: string): string | null => {
    if (meshCache.has(assetId)) return meshCache.get(assetId)!;
    const a = st.meshes[assetId];
    if (!a) return null;
    let me;
    if (a.topology) {
      const t = a.topology;
      const faces: PolyFace[] = [];
      for (let f = 0; f < t.offsets.length - 1; f++) {
        const s = t.offsets[f],
          e = t.offsets[f + 1];
        faces.push({ verts: Array.from(t.indices.subarray(s, e)), uvs: Array.from(t.uvs.subarray(s * 2, e * 2)).map((v, i) => (i % 2 ? 1 - v : v)), seams: t.seams ? Array.from(t.seams.subarray(s, e)) : undefined });
      }
      me = newMeshData('Mesh', buildMesh(convertPositions(t.positions), faces));
    } else {
      // interleaved triangles: position(3) + normal(3); weld identical positions
      const v = a.vertices,
        uv = a.uvs;
      const lookup = new Map<string, number>(),
        pos: number[] = [],
        faces: PolyFace[] = [];
      for (let i = 0; i < a.count; i += 3) {
        const verts: number[] = [],
          uvs: number[] = [];
        for (let k = 0; k < 3; k++) {
          const j = (i + k) * 6;
          const key = `${v[j].toFixed(6)},${v[j + 1].toFixed(6)},${v[j + 2].toFixed(6)}`;
          let id = lookup.get(key);
          if (id === undefined) {
            id = pos.length / 3;
            pos.push(v[j], v[j + 1], v[j + 2]);
            lookup.set(key, id);
          }
          verts.push(id);
          uvs.push(uv?.[(i + k) * 2] ?? 0, 1 - (uv?.[(i + k) * 2 + 1] ?? 0));
        }
        if (new Set(verts).size === 3) faces.push({ verts, uvs });
      }
      me = newMeshData('Mesh', buildMesh(convertPositions(pos), faces));
    }
    doc.meshes[me.id] = me;
    meshCache.set(assetId, me.id);
    return me.id;
  };

  const legacyMatrix = (o: SceneObject) => {
    // legacy: world-space position, Euler XYZ degrees composed Z·Y·X, scale
    const e = new Euler((o.rotation[0] * Math.PI) / 180, (o.rotation[1] * Math.PI) / 180, (o.rotation[2] * Math.PI) / 180, 'ZYX');
    const m = new Matrix4().compose(new Vector3(...o.position), new Quaternion().setFromEuler(e), new Vector3(...o.scale));
    return C.clone().multiply(m).multiply(Cinv);
  };

  for (const o of st.objects) {
    let ob: ObjectData;
    if (o.kind === 'cube' || o.kind === 'sphere' || o.kind === 'plane') {
      const arrays = o.kind === 'cube' ? prim.cube(2) : o.kind === 'sphere' ? prim.uvSphere(32, 16, 1) : prim.plane(2);
      const me = newMeshData(o.name, arrays);
      doc.meshes[me.id] = me;
      ob = newObject(o.name, 'MESH', me.id);
      if (o.kind === 'sphere' && me.smooth) me.smooth.fill(1);
    } else if (o.kind === 'mesh') {
      const meshId = meshFromAsset(o.baseMeshId ?? o.meshId!);
      ob = newObject(o.name, 'MESH', meshId);
      for (const m of o.modifiers ?? []) {
        if (m.type === 'mirror') {
          const nm = newModifier('MIRROR', uid('md'), ob.modifiers);
          // legacy axis is in Y-up space: X stays X, Y→Z, Z→Y
          const axes = [false, false, false];
          axes[[0, 2, 1][m.axis]] = true;
          nm.use_axis = axes;
          nm.use_mirror_merge = m.merge;
          nm.merge_threshold = m.tolerance;
          nm.show_viewport = m.enabled;
          if (m.bisect) nm.use_bisect_axis = axes;
          ob.modifiers.push(nm);
        } else if (m.type === 'subdivision') {
          const nm = newModifier('SUBSURF', uid('md'), ob.modifiers);
          nm.levels = m.levels;
          nm.render_levels = m.levels;
          nm.show_viewport = m.enabled;
          ob.modifiers.push(nm);
        }
      }
    } else if (o.kind === 'light' && o.light) {
      const t = o.light.type === 'directional' ? 'SUN' : o.light.type === 'spot' ? 'SPOT' : 'POINT';
      const la = newLight(t, o.name);
      la.color = [...o.light.color] as [number, number, number];
      la.energy = t === 'SUN' ? o.light.intensity : o.light.intensity * 12.5;
      la.use_shadow = o.light.shadows;
      if (t === 'SPOT') {
        la.spot_size = (o.light.angle * Math.PI) / 180;
        la.spot_blend = o.light.softness;
      }
      doc.lights[la.id] = la;
      ob = newObject(o.name, 'LIGHT', la.id);
    } else if (o.kind === 'camera' && o.camera) {
      const ca = newCamera(o.name);
      ca.lens = o.camera.focalLength;
      ca.clip_start = o.camera.near;
      ca.clip_end = o.camera.far;
      doc.cameras[ca.id] = ca;
      ob = newObject(o.name, 'CAMERA', ca.id);
    } else ob = newObject(o.name, 'EMPTY', null);
    ob.hide = !!o.hidden;
    ob.hide_select = !!o.locked;
    if (o.material && ob.type === 'MESH' && ob.data) {
      const ma = newMaterial(`${o.name} Material`, [...o.material.baseColor] as [number, number, number, number]);
      const bsdf = ma.tree.nodes.find((n) => n.type === 'ShaderNodeBsdfPrincipled')!;
      bsdf.inputs.Metallic = o.material.metallic;
      bsdf.inputs.Roughness = o.material.roughness;
      bsdf.inputs.Alpha = o.material.baseColor[3];
      ma.metallic = o.material.metallic;
      ma.roughness = o.material.roughness;
      ma.use_backface_culling = !o.material.doubleSided;
      ma.blend_method = o.material.alphaMode === 'BLEND' ? 'BLEND' : o.material.alphaMode === 'MASK' ? 'CLIP' : 'OPAQUE';
      ma.alpha_threshold = o.material.alphaCutoff;
      if (o.material.textureId && st.textures[o.material.textureId]) {
        const tex = st.textures[o.material.textureId];
        let imgId = [...Object.values(doc.images)].find((i) => i.name === tex.name)?.id;
        if (!imgId) {
          imgId = uid('im');
          doc.images[imgId] = { id: imgId, name: tex.name, mime: tex.mimeType, bytes: tex.bytes, width: 0, height: 0, source: 'FILE', colorspace: 'sRGB', revision: 0 };
        }
        const node = { id: uid('node'), type: 'ShaderNodeTexImage', name: 'Image Texture', location: [-300, 300] as [number, number], inputs: {}, props: { image: imgId, interpolation: o.material.nearest ? 'Closest' : 'Linear', extension: 'REPEAT' } };
        ma.tree.nodes.push(node);
        ma.tree.links.push({ id: uid('link'), from_node: node.id, from_socket: 'Color', to_node: bsdf.id, to_socket: 'Base Color' });
      }
      doc.materials[ma.id] = ma;
      doc.meshes[ob.data].materials = [ma.id];
    }
    const world = legacyMatrix(o);
    if (o.kind === 'camera' || o.kind === 'light') {
      // legacy cameras/lights look down their local -Z in Y-up space; after conversion the
      // same local axis is preserved by the change of basis, so no extra rotation is needed
    }
    worldOf.set(o.id, world);
    applyMatrixToObject(ob, world);
    idMap.set(o.id, ob.id);
    doc.objects[ob.id] = ob;
    doc.object_order.push(ob.id);
    col.objects.push(ob.id);
  }
  // parenting (legacy transforms are world-space: keep worlds through the parent inverse)
  for (const o of st.objects) {
    if (!o.parentId || !idMap.has(o.parentId)) continue;
    const ob = doc.objects[idMap.get(o.id)!];
    ob.parent = idMap.get(o.parentId)!;
    ob.matrix_parent_inverse = fromMatrix4(worldOf.get(o.parentId)!.clone().invert());
  }
  for (const id of st.selection ?? []) if (idMap.has(id)) doc.objects[idMap.get(id)!].select = true;
  doc.scene.active_object = st.selected ? idMap.get(st.selected) ?? null : null;
  if (st.activeCamera) doc.scene.camera = idMap.get(st.activeCamera) ?? null;
  if (st.output) {
    doc.scene.render.resolution_x = st.output.width;
    doc.scene.render.resolution_y = st.output.height;
    doc.scene.render.film_transparent = st.output.transparent;
  }
  if (st.environment) {
    const w = doc.worlds[doc.scene.world!];
    const bg = w.tree.nodes.find((n) => n.type === 'ShaderNodeBackground')!;
    const c = st.environment.background ?? st.environment.ambientColor.map((x) => x * st.environment!.ambientIntensity);
    bg.inputs.Color = [c[0], c[1], c[2], 1];
    w.color = [c[0], c[1], c[2]];
  }
  return doc;
}
