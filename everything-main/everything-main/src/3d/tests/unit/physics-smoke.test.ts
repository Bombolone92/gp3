import { describe, it, expect, beforeAll } from 'vitest';
import { emptyDocument, newObject, newMeshData, uid } from '../../src/data/defaults';
import { cube } from '../../src/mesh/primitives';
import { Depsgraph } from '../../src/eval/depsgraph';
import { newModifier } from '../../src/eval/modifiers';
import type { DocumentData, ObjectData } from '../../src/data/types';
import '../../src/physics/engine';
import { caches, startBudget } from '../../src/physics/common';
import { smokeDraw, type FluidModifier } from '../../src/physics/fluid';
import { newGrid, stepGas } from '../../src/physics/smoke-solver';

function addMesh(doc: DocumentData, name: string, size: number, loc: [number, number, number]): ObjectData {
  const me = newMeshData(name, cube(size));
  doc.meshes[me.id] = me;
  const ob = newObject(name, 'MESH', me.id);
  ob.location = loc;
  doc.objects[ob.id] = ob;
  doc.object_order.push(ob.id);
  doc.collections[doc.scene.collection].objects.push(ob.id);
  return ob;
}

function smokeScene(flowType: 'SMOKE' | 'FIRE' | 'BOTH' = 'SMOKE') {
  caches.clear();
  const doc = emptyDocument();
  const domain = addMesh(doc, 'Domain', 4, [0, 0, 2]);
  const dm = newModifier('FLUID', uid('md'), []) as FluidModifier;
  dm.fluid_type = 'DOMAIN';
  dm.domain_settings.resolution_max = 24;
  domain.modifiers.push(dm);
  const flow = addMesh(doc, 'Emitter', 0.6, [0, 0, 0.6]);
  const fm = newModifier('FLUID', uid('md'), []) as FluidModifier;
  fm.fluid_type = 'FLOW';
  fm.flow_settings.flow_type = flowType;
  flow.modifiers.push(fm);
  return { doc, domain, dm, key: `${domain.id}:${dm.id}` };
}

/** density-weighted mean height (grid cells) and total density */
function stats(d: { nx: number; ny: number; nz: number; data: Uint8Array }, channel = 0) {
  let sum = 0,
    zsum = 0;
  for (let k = 0; k < d.nz; k++)
    for (let j = 0; j < d.ny; j++)
      for (let i = 0; i < d.nx; i++) {
        const v = d.data[(i + j * d.nx + k * d.nx * d.ny) * 2 + channel];
        sum += v;
        zsum += v * k;
      }
  return { sum, z: sum ? zsum / sum : 0 };
}

beforeAll(() => startBudget(Infinity));

describe('smoke', () => {
  it('a hot smoke source emits smoke that rises', () => {
    const { doc, key } = smokeScene();
    const g = new Depsgraph(doc);
    doc.scene.frame_current = 10;
    g.evaluate(doc);
    const a = stats(smokeDraw.get(key)!);
    doc.scene.frame_current = 40;
    g.evaluate(doc);
    const b = stats(smokeDraw.get(key)!);
    expect(a.sum).toBeGreaterThan(0);
    expect(b.sum).toBeGreaterThan(a.sum);
    expect(b.z).toBeGreaterThan(a.z + 1);
  });

  it('fire produces flame and smoke; results are cached and deterministic', () => {
    const { doc, key } = smokeScene('FIRE');
    const g = new Depsgraph(doc);
    doc.scene.frame_current = 20;
    g.evaluate(doc);
    const d = smokeDraw.get(key)!;
    expect(stats(d, 1).sum).toBeGreaterThan(0);
    expect(stats(d, 0).sum).toBeGreaterThan(0);
    const snapshot = Array.from(d.data);
    doc.scene.frame_current = 5;
    g.evaluate(doc);
    doc.scene.frame_current = 20;
    g.evaluate(doc);
    expect(Array.from(smokeDraw.get(key)!.data)).toEqual(snapshot);
  });

  it('pressure projection removes divergence', () => {
    const g = newGrid(12, 12, 12);
    // a blob of heat drives a plume; velocity field must stay near divergence free
    for (let k = 2; k < 5; k++) for (let j = 5; j < 7; j++) for (let i = 5; i < 7; i++) g.heat[i + j * 12 + k * 144] = 1;
    const P = { dt: 0.04, up: [0, 0, 1] as [number, number, number], gravity: 40, alpha: 1, beta: 1, vorticity: 0, flameVorticity: 0, burningRate: 0, flameSmoke: 0, flameMaxTemp: 3, dissolve: 0, heatDecay: 0, pressureIterations: 60, closed: [true, true, true, true, true, true] as [boolean, boolean, boolean, boolean, boolean, boolean] };
    for (let s = 0; s < 5; s++) stepGas(g, P);
    let maxDiv = 0,
      maxVel = 0;
    for (let k = 1; k < 11; k++)
      for (let j = 1; j < 11; j++)
        for (let i = 1; i < 11; i++) {
          const o = i + j * 12 + k * 144;
          const d = 0.5 * (g.u[o + 1] - g.u[o - 1] + g.v[o + 12] - g.v[o - 12] + g.w[o + 144] - g.w[o - 144]);
          maxDiv = Math.max(maxDiv, Math.abs(d));
          maxVel = Math.max(maxVel, Math.abs(g.w[o]));
        }
    expect(maxVel).toBeGreaterThan(0.1);
    expect(maxDiv / maxVel).toBeLessThan(0.35);
  });
});
