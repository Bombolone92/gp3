// Bake Action: sample the evaluated animation (optionally the visual result of constraints and
// parenting) at every step and write it as keyframes into a new action.
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { app, registerOperators } from '../app/app';
import type { ActionData, ObjectData, Vec3 } from '../data/types';
import { newAction } from '../data/defaults';
import { ensureFCurve } from '../anim/keyframes';
import { insertKeyframe } from '../anim/fcurve';
import { threeOrder, compatibleEuler, toMatrix4 } from '../eval/transform';
import { uniqueName } from './object';

interface Sample {
  loc: Vec3;
  quat: [number, number, number, number]; // w x y z
  scale: Vec3;
}

function decompose(m: Matrix4): Sample {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  m.decompose(p, q, s);
  return { loc: [p.x, p.y, p.z], quat: [q.w, q.x, q.y, q.z], scale: [s.x, s.y, s.z] };
}

function writeKeys(act: ActionData, prefix: string, rotationMode: string, frames: number[], samples: Sample[], group: string) {
  let prevEuler: Vec3 | null = null;
  frames.forEach((f, k) => {
    const s = samples[k];
    s.loc.forEach((v, i) => insertKeyframe(ensureFCurve(act, `${prefix}location`, i), f, v));
    if (rotationMode === 'QUATERNION') s.quat.forEach((v, i) => insertKeyframe(ensureFCurve(act, `${prefix}rotation_quaternion`, i), f, v));
    else if (rotationMode === 'AXIS_ANGLE') {
      const q = new Quaternion(s.quat[1], s.quat[2], s.quat[3], s.quat[0]).normalize();
      const angle = 2 * Math.acos(Math.min(1, Math.max(-1, q.w)));
      const sn = Math.sqrt(1 - q.w * q.w) || 1;
      [angle, q.x / sn, q.y / sn, q.z / sn].forEach((v, i) => insertKeyframe(ensureFCurve(act, `${prefix}rotation_axis_angle`, i), f, v));
    } else {
      const e = new Euler().setFromQuaternion(new Quaternion(s.quat[1], s.quat[2], s.quat[3], s.quat[0]), threeOrder(rotationMode as never));
      let ev: Vec3 = [e.x, e.y, e.z];
      if (prevEuler) ev = compatibleEuler(ev, prevEuler);
      prevEuler = ev;
      ev.forEach((v, i) => insertKeyframe(ensureFCurve(act, `${prefix}rotation_euler`, i), f, v));
    }
    s.scale.forEach((v, i) => insertKeyframe(ensureFCurve(act, `${prefix}scale`, i), f, v));
  });
  for (const fc of act.fcurves) if (fc.data_path.startsWith(prefix) && !fc.group) fc.group = group;
}

registerOperators([
  {
    idname: 'nla.bake',
    label: 'Bake Action',
    description: 'Bake all selected objects (or selected pose bones) animation to a new action',
    props: [
      { id: 'frame_start', label: 'Start Frame', type: 'int', default: 1, min: 0 },
      { id: 'frame_end', label: 'End Frame', type: 'int', default: 250, min: 1 },
      { id: 'step', label: 'Frame Step', type: 'int', default: 1, min: 1, max: 120 },
      { id: 'only_selected', label: 'Only Selected Bones', type: 'bool', default: true },
      { id: 'visual_keying', label: 'Visual Keying', type: 'bool', default: false },
      { id: 'clear_constraints', label: 'Clear Constraints', type: 'bool', default: false },
      { id: 'clear_parents', label: 'Clear Parents', type: 'bool', default: false },
      { id: 'bake_types', label: 'Bake Data', type: 'enum', default: 'OBJECT', items: [['OBJECT', 'Object'], ['POSE', 'Pose']] },
    ],
    poll: (ctx) => (ctx.doc.mode === 'OBJECT' || ctx.doc.mode === 'POSE') && app.selectedObjects().length > 0,
    invoke: (ctx, p) => {
      p.frame_start = ctx.doc.scene.frame_start;
      p.frame_end = ctx.doc.scene.frame_end;
      if (ctx.doc.mode === 'POSE') p.bake_types = 'POSE';
      return app.run('nla.bake', p, { invoke: false }) === 'FINISHED' ? 'CANCELLED' : 'CANCELLED';
    },
    exec: (ctx, p) => {
      const doc = ctx.doc;
      const start = p.frame_start as number,
        end = Math.max(start, p.frame_end as number),
        step = Math.max(1, p.step as number);
      const frames: number[] = [];
      for (let f = start; f <= end; f += step) frames.push(f);
      const objects = app.selectedObjects();
      const pose = p.bake_types === 'POSE';
      const savedFrame = doc.scene.frame_current;
      // sample everything first, then write keys (so new keys don't feed back into sampling)
      const objSamples = new Map<string, Sample[]>();
      const boneSamples = new Map<string, Map<string, Sample[]>>();
      for (const f of frames) {
        app.setFrame(f);
        app.flush();
        for (const ob of objects) {
          const ev = app.graph.get(ob.id);
          if (!ev) continue;
          if (!pose) {
            let m: Matrix4;
            if (p.visual_keying || p.clear_parents) {
              m = ev.world.clone();
              if (!p.clear_parents && ob.parent) {
                const par = app.graph.get(ob.parent);
                if (par) m = par.world.clone().multiply(toMatrix4(ob.matrix_parent_inverse)).invert().multiply(m);
              }
              const s = decompose(m);
              (objSamples.get(ob.id) ?? objSamples.set(ob.id, []).get(ob.id)!).push(s);
            } else {
              const q = new Quaternion().setFromEuler(new Euler(...ob.rotation_euler, threeOrder(ob.rotation_mode as never)));
              const quat: [number, number, number, number] = ob.rotation_mode === 'QUATERNION' ? [...ob.rotation_quaternion] as [number, number, number, number] : [q.w, q.x, q.y, q.z];
              (objSamples.get(ob.id) ?? objSamples.set(ob.id, []).get(ob.id)!).push({ loc: [...ob.location] as Vec3, quat, scale: [...ob.scale] as Vec3 });
            }
          } else if (ob.type === 'ARMATURE' && ob.pose && ev.pose && ob.data) {
            const arm = doc.armatures[ob.data];
            const bones = arm.bones.filter((b) => !p.only_selected || ob.pose![b.name]?.select);
            const per = boneSamples.get(ob.id) ?? boneSamples.set(ob.id, new Map()).get(ob.id)!;
            for (const b of bones) {
              const be = ev.pose.bones.get(b.name);
              if (!be) continue;
              // local pose = (parent pose · parent rest⁻¹ · rest)⁻¹ · pose
              const parent = b.parent ? ev.pose.bones.get(b.parent) : undefined;
              const restInParent = parent ? parent.pose.clone().multiply(parent.restInv).multiply(be.rest) : be.rest.clone();
              const local = restInParent.invert().multiply(be.pose);
              (per.get(b.name) ?? per.set(b.name, []).get(b.name)!).push(decompose(local));
            }
          }
        }
      }
      // write new actions
      const assign = (ob: ObjectData) => {
        const act = newAction(uniqueName(doc, `${ob.name}Action`, 'actions'));
        doc.actions[act.id] = act;
        ob.animation_data ??= { action: null, nla_tracks: [], drivers: [] };
        ob.animation_data.action = act.id;
        return act;
      };
      let baked = 0;
      for (const ob of objects) {
        if (!pose) {
          const smp = objSamples.get(ob.id);
          if (!smp?.length) continue;
          const act = assign(ob);
          writeKeys(act, '', ob.rotation_mode, frames, smp, 'Object Transforms');
          if (p.clear_parents && ob.parent) {
            ob.parent = null;
            ob.matrix_parent_inverse = Array.from(new Matrix4().elements);
          }
          if (p.clear_constraints) ob.constraints = [];
          baked++;
        } else {
          const per = boneSamples.get(ob.id);
          if (!per?.size) continue;
          // keep other (non-bone) curves of the current action
          const prevAct = ob.animation_data?.action ? doc.actions[ob.animation_data.action] : undefined;
          const act = assign(ob);
          if (prevAct) act.fcurves = prevAct.fcurves.filter((fc) => !fc.data_path.startsWith('pose.bones[')).map((fc) => structuredClone(fc));
          for (const [name, smp] of per) {
            const pb = ob.pose![name];
            writeKeys(act, `pose.bones["${name}"].`, pb.rotation_mode, frames, smp, name);
            if (p.clear_constraints) pb.constraints = [];
          }
          baked++;
        }
      }
      app.setFrame(savedFrame);
      if (!baked) {
        app.report('WARNING', 'Nothing to bake');
        return 'CANCELLED';
      }
      app.report('INFO', `Baked ${frames.length} frame(s) for ${baked} object(s)`);
    },
  },
]);
