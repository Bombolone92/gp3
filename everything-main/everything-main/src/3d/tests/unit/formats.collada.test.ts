import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { MiniDOMParser } from '../fixtures/formats/xmldom';
import { freshDoc, byName, worldBBox } from '../fixtures/formats/helpers';
import { commitScene } from '../../src/io/formats/to-document';
import { colladaImageFiles } from '../../src/io/formats/collada';

beforeAll(() => {
  (globalThis as unknown as { DOMParser: unknown }).DOMParser = MiniDOMParser;
});

describe('Collada import (three ColladaLoader → IR)', () => {
  it('imports hierarchy, n-gon geometry (welded), material, camera, light and animation from a Z-up document', async () => {
    const { readCollada } = await import('../../src/io/formats/collada');
    const text = readFileSync(new URL('../fixtures/formats/simple.dae', import.meta.url), 'utf8');
    const doc = freshDoc();
    const res = commitScene(doc, await readCollada(text), { mergeVertices: true });
    const names = res.objects.map((o) => o.name).sort();
    expect(names).toContain('Group');
    expect(names).toContain('Cam');
    expect(names).toContain('Lamp');
    const box = Object.values(doc.objects).find((o) => o.type === 'MESH')!;
    const me = doc.meshes[box.data!];
    // the loader triangulates the 6 quads; welding restores the 8 shared corners
    expect(me.positions.length / 3).toBe(8);
    expect(me.offsets.length - 1).toBe(12);
    expect(doc.materials[me.materials[0]!].name).toBe('Red');
    const bb = worldBBox(doc, box.name, 0);
    expect(bb.min.map((v) => +v.toFixed(4) + 0)).toEqual([-1, -1, 1]);
    expect(bb.max.map((v) => +v.toFixed(4) + 0)).toEqual([1, 1, 3]);
    // Z-up data stays Z-up: the lamp sits at (4, 1, 6)
    expect(byName(doc, 'Lamp').location.map((v) => +v.toFixed(4) + 0)).toEqual([4, 1, 6]);
    // camera with a +90° X matrix looks along +Y
    const cam = byName(doc, 'Cam');
    expect(cam.rotation_euler.map((v) => +v.toFixed(4) + 0)).toEqual([+(Math.PI / 2).toFixed(4), 0, 0]);
    expect(doc.cameras[cam.data!].sensor_fit).toBe('VERTICAL');
    // translate X animation: t=0 → frame 0 (x=0), t=1 s → frame 24 (x=3)
    const late = worldBBox(doc, box.name, 24);
    expect(late.min[0]).toBeCloseTo(2, 3);
  });
  it('lists referenced images for the companion-file prompt', () => {
    expect(colladaImageFiles('<library_images><image id="i"><init_from>textures/wood%20a.png</init_from></image></library_images>')).toEqual(['wood a.png']);
  });
});
