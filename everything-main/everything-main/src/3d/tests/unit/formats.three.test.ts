import { describe, it, expect } from 'vitest';
import { AnimationClip, Bone, BufferAttribute, BufferGeometry, Group, MeshStandardMaterial, QuaternionKeyframeTrack, Quaternion, Skeleton, SkinnedMesh, Vector3, VectorKeyframeTrack } from 'three';
import { threeToIR } from '../../src/io/formats/three-to-ir';
import { commitScene } from '../../src/io/formats/to-document';
import { Depsgraph } from '../../src/eval/depsgraph';
import { freshDoc } from '../fixtures/formats/helpers';

/** A Y-up skinned strip with two bones and a bend animation, built with three.js. */
function buildRig() {
  const root = new Group();
  const holder = new Group();
  holder.name = 'Holder';
  holder.position.set(1, 0, 0);
  root.add(holder);
  const b0 = new Bone();
  b0.name = 'B0';
  const b1 = new Bone();
  b1.name = 'B1';
  b1.position.set(0, 1, 0);
  b0.add(b1);
  holder.add(b0);
  const pos: number[] = [],
    idx: number[] = [],
    si: number[] = [],
    sw: number[] = [];
  for (let r = 0; r <= 4; r++)
    for (const x of [-0.2, 0.2]) {
      pos.push(x, r * 0.5, 0);
      const w = Math.min(1, Math.max(0, (r * 0.5 - 0.5) / 1));
      si.push(0, 1, 0, 0);
      sw.push(1 - w, w, 0, 0);
    }
  for (let r = 0; r < 4; r++) idx.push(r * 2, r * 2 + 1, r * 2 + 3, r * 2, r * 2 + 3, r * 2 + 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(si), 4));
  g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(sw), 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial({ color: 0x336699, roughness: 0.4, metalness: 0.1 }));
  mesh.name = 'Strip';
  holder.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([b0, b1]));
  const bend = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
  const clip = new AnimationClip('Bend', 1, [
    new QuaternionKeyframeTrack('B1.quaternion', [0, 1], [0, 0, 0, 1, bend.x, bend.y, bend.z, bend.w]),
    new VectorKeyframeTrack('Holder.position', [0, 1], [1, 0, 0, 1, 2, 0]),
  ]);
  return { root, mesh, b1, holder, clip, bend };
}

/** World positions of the skinned mesh computed by three at the clip's end pose. */
function threeWorld(r: ReturnType<typeof buildRig>) {
  r.b1.quaternion.copy(r.bend);
  r.holder.position.set(1, 2, 0);
  r.root.updateMatrixWorld(true);
  const out: Vector3[] = [];
  const v = new Vector3();
  for (let i = 0; i < r.mesh.geometry.attributes.position.count; i++) {
    r.mesh.getVertexPosition(i, v);
    out.push(v.clone().applyMatrix4(r.mesh.matrixWorld));
  }
  return out;
}

describe('three.js Object3D → document', () => {
  it('converts a skinned mesh with animation so the document deforms exactly like three.js', () => {
    const r = buildRig();
    const ir = threeToIR(r.root, [r.clip]);
    const doc = freshDoc();
    const res = commitScene(doc, ir, { mergeVertices: true });
    expect(res.objects.some((o) => o.type === 'ARMATURE')).toBe(true);
    const strip = res.objects.find((o) => o.name === 'Strip')!;
    const me = doc.meshes[strip.data!];
    expect(me.positions.length / 3).toBe(10);
    expect(me.vertex_groups.map((g) => g.name).sort()).toEqual(['B0', 'B1']);
    expect(doc.materials[me.materials[0]!].roughness).toBeCloseTo(0.4, 5);
    const expected = threeWorld(buildRig()).map((p) => new Vector3(p.x, -p.z, p.y)); // Y-up → Z-up
    const graph = new Depsgraph(doc);
    doc.scene.frame_current = 24; // t = 1 s
    graph.evaluate(doc);
    const ev = graph.get(strip.id)!;
    const got: Vector3[] = [];
    for (let i = 0; i < ev.mesh!.positions.length; i += 3) got.push(new Vector3(ev.mesh!.positions[i], ev.mesh!.positions[i + 1], ev.mesh!.positions[i + 2]).applyMatrix4(ev.world));
    // compare as point sets (vertex order differs after welding)
    for (const e of expected) expect(Math.min(...got.map((g) => g.distanceTo(e)))).toBeLessThan(1e-4);
  });
});
