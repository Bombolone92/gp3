// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

(globalThis as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number;

import { App, setApp, app } from '../../src/app/app';
import { startupDocument } from '../../src/data/defaults';
import '../../src/nodes/shader/defs';
import { runJavaScript, output } from '../../src/scripting/runner';
import { clearScriptFiles, offerScriptFile } from '../../src/scripting/files';
import type { MeshData } from '../../src/data/types';

function run(code: string) {
  output.clear();
  const r = runJavaScript(code);
  if (!r.ok) throw new Error(`${r.error} (line ${r.line})`);
  return output.lines.map((l) => l.text).join('\n');
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const cubeMesh = () => app.doc.meshes[Object.values(app.doc.objects).find((o) => o.name === 'Cube')!.data!] as MeshData;

beforeEach(() => {
  setApp(new App(startupDocument()));
  clearScriptFiles();
});

describe('D.images.load', () => {
  it('opens a file offered to scripts as an image data-block, by name whatever the case or folder', () => {
    offerScriptFile({ name: 'Photo.png', bytes: PNG, mime: 'image/png', width: 640, height: 480 });
    expect(run(`const im = D.images.load('/tmp/photo.PNG'); print(im.name, im.size[0], im.size[1], im.filepath, im.has_data)`)).toBe('Photo.png 640 480 Photo.png true');
    const im = Object.values(app.doc.images).find((x) => x.name === 'Photo.png')!;
    expect(im.bytes).toBe(PNG);
    expect(im.mime).toBe('image/png');
  });

  it('reuses the loaded image with check_existing, and loads a copy without', () => {
    offerScriptFile({ name: 'a.png', bytes: PNG, mime: 'image/png', width: 2, height: 2 });
    run(`D.images.load('a.png'); D.images.load('a.png', {check_existing: true}); D.images.load('a.png')`);
    expect(Object.values(app.doc.images).filter((x) => x.filepath === 'a.png').map((x) => x.name).sort()).toEqual(['a.png', 'a.png.001']);
  });

  it('names the files it can load when asked for another', () => {
    expect(() => run(`D.images.load('x.png')`)).toThrow(/no file system access.*Image › Open/);
    offerScriptFile({ name: 'ref.jpg', bytes: PNG, mime: 'image/jpeg', width: 2, height: 2 });
    expect(() => run(`D.images.load('x.png')`)).toThrow(/Files that can be loaded: "ref.jpg"/);
  });
});

describe('Image Texture nodes', () => {
  it('take an image, which reads back as the data-block', () => {
    run(`const img = D.images.new('Grid', 8, 8);
      const tex = D.materials.new('M').node_tree.nodes.new('ShaderNodeTexImage');
      print(tex.image); tex.image = img; print(tex.image.name)`);
    expect(output.lines.map((l) => l.text)).toEqual(['null', 'Grid']);
    const tex = Object.values(app.doc.materials).find((m) => m.name === 'M')!.tree.nodes.find((n) => n.type === 'ShaderNodeTexImage')!;
    expect(app.doc.images[tex.props.image as string].name).toBe('Grid');
  });

  it('refuse what is not an image, and nodes without one have no image', () => {
    expect(() => run(`D.materials.new('M').node_tree.nodes.new('ShaderNodeTexImage').image = D.objects['Cube']`)).toThrow(/expected an Image/);
    expect(() => run(`D.materials.new('M').node_tree.nodes.new('ShaderNodeTexNoise').image = D.images.new('I', 2, 2)`)).toThrow(/has no attribute 'image'/);
  });
});

describe('UV maps', () => {
  it('are read and written per loop', () => {
    const loops = cubeMesh().indices.length;
    expect(run(`const me = D.objects['Cube'].data; const uv = me.uv_layers.active; print(me.uv_layers.length, uv.name, uv.data.length)`)).toBe(`1 UVMap ${loops}`);
    run(`const uv = D.objects['Cube'].data.uv_layers.active; uv.data[3].uv = [0.25, 0.75]; uv.data[4].uv.x = 0.5`);
    expect(Array.from(cubeMesh().uvs.slice(6, 9))).toEqual([0.25, 0.75, 0.5]);
    run(`const uv = D.objects['Cube'].data.uv_layers.active; uv.foreach_set('uv', Array(${loops * 2}).fill(0.5))`);
    expect(cubeMesh().uvs.every((x) => x === 0.5)).toBe(true);
    expect(() => run(`D.objects['Cube'].data.uv_layers.active.foreach_set('uv', [0, 0])`)).toThrow(/expected \d+ values/);
  });

  it('are made for a mesh built from data, and loops give their vertices', () => {
    expect(run(`const me = D.meshes.new('Tri'); me.from_pydata([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [], [[0, 1, 2]]);
      const uv = me.uv_layers.new('Proj'); print(me.uv_layers.active.name, uv.data.length, me.loops[2].vertex_index, me.loops.foreach_get('vertex_index').join(','))`)).toBe('Proj 3 2 0,1,2');
  });
});

describe('bpy_extras.object_utils.world_to_camera_view', () => {
  it('places points in the camera frame from 0 to 1, with the depth', () => {
    // A camera at z = 10 looking straight down, 36 mm sensor and 36 mm lens: the frame is 10 m wide at the floor.
    const out = run(`const cam = D.objects['Camera']; cam.location = [0, 0, 10]; cam.rotation_euler = [0, 0, 0];
      cam.data.lens = 36; cam.data.sensor_width = 36; cam.data.sensor_fit = 'AUTO'; cam.data.shift_x = 0; cam.data.shift_y = 0;
      C.scene.render.resolution_x = 1000; C.scene.render.resolution_y = 500; C.scene.render.pixel_aspect_x = 1; C.scene.render.pixel_aspect_y = 1;
      const f = (p) => { const v = bpy_extras.object_utils.world_to_camera_view(C.scene, cam, p); return [v.x, v.y, v.z].map((x) => +x.toFixed(4)).join(' '); };
      print(f([0, 0, 0])); print(f([5, 2.5, 0])); print(f([-5, -2.5, 0])); print(f([2.5, 0, 5]))`);
    expect(out.split('\n')).toEqual(['0.5 0.5 10', '1 1 10', '0 0 10', '1 0.5 5']);
  });
});
