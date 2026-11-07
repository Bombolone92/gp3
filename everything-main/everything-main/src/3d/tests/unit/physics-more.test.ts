import { describe, it, expect, beforeAll } from 'vitest';
import { emptyDocument, newObject, newMeshData, uid } from '../../src/data/defaults';
import { cube, grid, plane, icoSphere } from '../../src/mesh/primitives';
import { Depsgraph } from '../../src/eval/depsgraph';
import { newModifier } from '../../src/eval/modifiers';
import type { DocumentData, ObjectData } from '../../src/data/types';
import { loadRapier } from '../../src/physics/engine';
import { rigidBodyCache } from '../../src/physics/rigidbody';
import { caches, startBudget, simBudget, getCache } from '../../src/physics/common';
import { effectorForce, collectEffectors } from '../../src/physics/fields';
import { defaultRigidBody, defaultRigidBodyWorld, defaultField, defaultParticleSettings, defaultPointCache, type SoftBodyModifier, type ObjectPhysics, type ClothModifier } from '../../src/physics/types';
import { particleDraw } from '../../src/physics/particles';
import { meshSimKey } from '../../src/physics/meshsim';

function addMesh(doc: DocumentData, name: string, arrays: ReturnType<typeof cube>, loc: [number, number, number] = [0, 0, 0]): ObjectData {
  const me = newMeshData(name, arrays);
  doc.meshes[me.id] = me;
  const ob = newObject(name, 'MESH', me.id);
  ob.location = loc;
  doc.objects[ob.id] = ob;
  doc.object_order.push(ob.id);
  doc.collections[doc.scene.collection].objects.push(ob.id);
  return ob;
}
function addEmpty(doc: DocumentData, name: string, loc: [number, number, number]): ObjectData {
  const ob = newObject(name, 'EMPTY', null);
  ob.location = loc;
  doc.objects[ob.id] = ob;
  doc.object_order.push(ob.id);
  doc.collections[doc.scene.collection].objects.push(ob.id);
  return ob;
}
const evalAt = (g: Depsgraph, doc: DocumentData, f: number) => {
  doc.scene.frame_current = f;
  g.evaluate(doc);
  return g;
};
const centroidZ = (p: Float32Array) => {
  let z = 0;
  for (let i = 2; i < p.length; i += 3) z += p[i];
  return z / (p.length / 3);
};

beforeAll(async () => {
  await loadRapier();
  startBudget(Infinity);
});

describe('force fields', () => {
  it('force pushes away, wind blows along +Z of the field, vortex swirls, drag opposes velocity', () => {
    const doc = emptyDocument();
    const f = addEmpty(doc, 'Force', [0, 0, 0]);
    f.field = defaultField('FORCE');
    f.field.strength = 2;
    let out = [0, 0, 0];
    effectorForce(collectEffectors({ doc, graph: null }, 1), 1, 0, 0, 0, 0, 0, 1, out);
    expect(out[0]).toBeCloseTo(2);
    f.field = { ...defaultField('WIND'), strength: 3 };
    out = [0, 0, 0];
    effectorForce(collectEffectors({ doc, graph: null }, 1), 5, 5, 5, 0, 0, 0, 1, out);
    expect(out).toEqual([0, 0, 3]);
    f.field = { ...defaultField('VORTEX'), strength: 1 };
    out = [0, 0, 0];
    effectorForce(collectEffectors({ doc, graph: null }, 1), 1, 0, 0, 0, 0, 0, 1, out);
    expect(out[1]).toBeCloseTo(1);
    f.field = { ...defaultField('DRAG'), strength: 0.5, flow: 0 };
    out = [0, 0, 0];
    effectorForce(collectEffectors({ doc, graph: null }, 1), 1, 0, 0, 2, 0, 0, 1, out);
    expect(out[0]).toBeCloseTo(-1);
    // max distance falloff
    f.field = { ...defaultField('FORCE'), strength: 1, use_max_distance: true, distance_max: 0.5 };
    out = [0, 0, 0];
    effectorForce(collectEffectors({ doc, graph: null }, 1), 1, 0, 0, 0, 0, 0, 1, out);
    expect(out[0]).toBe(0);
  });

  it('wind affects particles', () => {
    caches.clear();
    const make = (withWind: boolean) => {
      const doc = emptyDocument();
      doc.scene.use_gravity = false;
      const ob = addMesh(doc, 'Emitter', plane(1), [0, 0, 0]);
      const ps = defaultParticleSettings(uid('pa'), 'P');
      ps.count = 50;
      ps.frame_end = 2;
      ps.normal_factor = 0;
      doc.particles[ps.id] = ps;
      ob.particle_systems.push({ name: 'P', settings: ps.id, seed: 1, id: 'ps1', point_cache: defaultPointCache() } as never);
      const m = newModifier('PARTICLE_SYSTEM', uid('md'), []);
      m.particle_system = 'ps1';
      ob.modifiers.push(m);
      if (withWind) {
        const w = addEmpty(doc, 'Wind', [0, 0, -1]);
        w.rotation_euler = [0, Math.PI / 2, 0]; // +Z axis → +X
        w.field = { ...defaultField('WIND'), strength: 5 };
      }
      const g = new Depsgraph(doc);
      evalAt(g, doc, 25);
      const pts = particleDraw.get(`${ob.id}:${m.id}`)!.points!;
      let x = 0;
      for (let i = 0; i < pts.length; i += 3) x += pts[i];
      return x / (pts.length / 3);
    };
    expect(Math.abs(make(false))).toBeLessThan(0.5);
    expect(make(true)).toBeGreaterThan(2);
  });

  it('wind affects cloth', () => {
    caches.clear();
    const doc = emptyDocument();
    doc.scene.use_gravity = false;
    const ob = addMesh(doc, 'Cloth', grid(6, 6, 1), [0, 0, 0]);
    ob.modifiers.push(newModifier('CLOTH', uid('md'), []));
    const w = addEmpty(doc, 'Wind', [0, 0, -2]);
    w.field = { ...defaultField('WIND'), strength: 4 };
    const g = new Depsgraph(doc);
    evalAt(g, doc, 20);
    expect(centroidZ(g.get(ob.id)!.mesh!.positions)).toBeGreaterThan(0.2);
  });
});

describe('soft body', () => {
  it('goal weight keeps the mesh near its shape while it jiggles; without goal it falls', () => {
    caches.clear();
    const doc = emptyDocument();
    const ob = addMesh(doc, 'Soft', icoSphere(1, 0.5), [0, 0, 2]);
    const m = newModifier('SOFT_BODY', uid('md'), []) as SoftBodyModifier;
    ob.modifiers.push(m);
    const g = new Depsgraph(doc);
    evalAt(g, doc, 30);
    const zGoal = centroidZ(g.get(ob.id)!.mesh!.positions);
    expect(zGoal).toBeLessThan(0.05);
    expect(zGoal).toBeGreaterThan(-0.5);
    m.settings.use_goal = false;
    evalAt(g, doc, 30);
    expect(centroidZ(g.get(ob.id)!.mesh!.positions)).toBeLessThan(-1);
  });

  it('shape matching preserves volume when falling onto a collider', () => {
    caches.clear();
    const doc = emptyDocument();
    const floor = addMesh(doc, 'Floor', plane(10), [0, 0, 0]);
    floor.collision = { use: true, thickness_outer: 0.02, cloth_friction: 5, damping: 0.1, use_culling: false };
    const ob = addMesh(doc, 'Soft', icoSphere(2, 0.5), [0, 0, 1.5]);
    const m = newModifier('SOFT_BODY', uid('md'), []) as SoftBodyModifier;
    m.settings.use_goal = false;
    m.settings.use_shape_match = true;
    m.settings.shape_stiffness = 0.3;
    ob.modifiers.push(m);
    const g = new Depsgraph(doc);
    for (let f = 1; f <= 80; f++) evalAt(g, doc, f);
    const p = g.get(ob.id)!.mesh!.positions;
    let mn = Infinity,
      mx = -Infinity;
    for (let i = 2; i < p.length; i += 3) {
      mn = Math.min(mn, p[i] + 1.5);
      mx = Math.max(mx, p[i] + 1.5);
    }
    expect(mn).toBeGreaterThan(-0.05);
    expect(mx - mn).toBeGreaterThan(0.7);
  });
});

describe('caches', () => {
  it('a baked cache is not invalidated by settings changes; freeing it allows recomputation', () => {
    caches.clear();
    const doc = emptyDocument();
    const ob = addMesh(doc, 'Cloth', grid(5, 5, 1), [0, 0, 1]);
    const m = newModifier('CLOTH', uid('md'), []) as ClothModifier;
    m.point_cache.frame_end = 20;
    ob.modifiers.push(m);
    const g = new Depsgraph(doc);
    for (let f = 1; f <= 20; f++) evalAt(g, doc, f);
    const key = meshSimKey('CLOTH', ob, m);
    expect(getCache(key).frames.size).toBe(20);
    m.point_cache.is_baked = true;
    m.settings.mass = 3;
    evalAt(g, doc, 10);
    expect(getCache(key).frames.size).toBe(20);
    m.point_cache.is_baked = false;
    evalAt(g, doc, 10);
    expect(getCache(key).frames.size).toBe(10);
  });

  it('the time budget stops stepping and resumes on the next evaluation', () => {
    caches.clear();
    const doc = emptyDocument();
    const ob = addMesh(doc, 'Cloth', grid(30, 30, 1), [0, 0, 1]);
    const m = newModifier('CLOTH', uid('md'), []) as ClothModifier;
    ob.modifiers.push(m);
    const g = new Depsgraph(doc);
    doc.scene.frame_current = 200;
    startBudget(1);
    g.evaluate(doc);
    const key = meshSimKey('CLOTH', ob, m);
    const partial = getCache(key).last;
    expect(partial).toBeLessThan(200);
    expect(simBudget.exceeded).toBe(true);
    startBudget(Infinity);
    g.evaluate(doc);
    expect(getCache(key).last).toBe(200);
  });
});

describe('rigid body extras', () => {
  it('a hinge constraint keeps a body attached to a fixed anchor', () => {
    caches.clear();
    const doc = emptyDocument();
    doc.scene.rigidbody_world = defaultRigidBodyWorld(1, 250);
    const anchor = addMesh(doc, 'Anchor', cube(0.2), [0, 0, 3]);
    anchor.rigid_body = { ...defaultRigidBody('PASSIVE'), collision_shape: 'BOX' };
    const bob = addMesh(doc, 'Bob', cube(0.4), [1, 0, 3]);
    bob.rigid_body = { ...defaultRigidBody('ACTIVE'), collision_shape: 'BOX' };
    const c = addEmpty(doc, 'Constraint', [0, 0, 3]) as ObjectPhysics;
    c.rotation_euler = [Math.PI / 2, 0, 0]; // hinge axis along -Y
    c.rigid_body_constraint = { type: 'HINGE', enabled: true, disable_collisions: true, object1: anchor.id, object2: bob.id };
    const g = new Depsgraph(doc);
    for (const f of [20, 40, 60]) {
      const e = evalAt(g, doc, f).get(bob.id)!.world.elements;
      expect(Math.hypot(e[12], e[13], e[14] - 3)).toBeCloseTo(1, 1);
      expect(Math.abs(e[13])).toBeLessThan(0.05);
    }
    // it swings below the anchor
    expect(evalAt(g, doc, 13).get(bob.id)!.world.elements[14]).toBeLessThan(2.3);
    expect(rigidBodyCache().frames.size).toBeGreaterThan(30);
  });

  it('animated passive bodies follow their animation and push active ones', () => {
    caches.clear();
    const doc = emptyDocument();
    doc.scene.rigidbody_world = defaultRigidBodyWorld(1, 250);
    const ground = addMesh(doc, 'Ground', plane(40));
    ground.rigid_body = { ...defaultRigidBody('PASSIVE'), collision_shape: 'BOX' };
    const pusher = addMesh(doc, 'Pusher', cube(1), [-3, 0, 0.5]);
    pusher.rigid_body = { ...defaultRigidBody('PASSIVE'), collision_shape: 'BOX', kinematic: true };
    const act = { id: uid('ac'), name: 'Push', fcurves: [{ data_path: 'location', array_index: 0, keyframe_points: [], extrapolation: 'CONSTANT' as const, modifiers: [] }] };
    const k = (f: number, v: number) => ({ co: [f, v] as [number, number], handle_left: [f - 1, v] as [number, number], handle_right: [f + 1, v] as [number, number], handle_left_type: 'VECTOR' as const, handle_right_type: 'VECTOR' as const, interpolation: 'LINEAR' as const, easing: 'AUTO' as const, type: 'KEYFRAME' as const });
    act.fcurves[0].keyframe_points.push(k(1, -3) as never, k(60, 3) as never);
    doc.actions[act.id] = act as never;
    pusher.animation_data = { action: act.id, nla_tracks: [], drivers: [] };
    const box = addMesh(doc, 'Box', cube(1), [0, 0, 0.5]);
    box.rigid_body = { ...defaultRigidBody('ACTIVE'), collision_shape: 'BOX' };
    const g = new Depsgraph(doc);
    evalAt(g, doc, 80);
    expect(g.get(box.id)!.world.elements[12]).toBeGreaterThan(2.5);
  });
});

describe('particle instancing', () => {
  it('object render type produces instances relative to the emitter', () => {
    caches.clear();
    const doc = emptyDocument();
    const ob = addMesh(doc, 'Emitter', plane(1), [0, 0, 5]);
    const inst = addMesh(doc, 'Pebble', cube(0.2), [10, 0, 0]);
    const ps = defaultParticleSettings(uid('pa'), 'P');
    ps.count = 30;
    ps.frame_end = 1;
    ps.render_type = 'OBJECT';
    ps.instance_object = inst.id;
    ps.particle_size = 1;
    doc.particles[ps.id] = ps;
    ob.particle_systems.push({ name: 'P', settings: ps.id, seed: 1, id: 'ps1', point_cache: defaultPointCache() } as never);
    const m = newModifier('PARTICLE_SYSTEM', uid('md'), []);
    m.particle_system = 'ps1';
    ob.modifiers.push(m);
    const g = new Depsgraph(doc);
    evalAt(g, doc, 10);
    const instances = g.get(ob.id)!.mesh!.instances!;
    expect(instances.length).toBe(30);
    expect(instances[0].objectId).toBe(inst.id);
    // relative matrices: particles fell below the emitter
    expect(instances[0].matrix[14]).toBeLessThan(0);
  });
});
