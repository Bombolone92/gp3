import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { readPicture3d } from '../src/engine/docx-picture-3d.js';
import { create3dShader } from '../src/engine/drawing-3d-lighting.js';
import { projection3d, intersectExtrusion } from '../src/engine/drawing-3d-geometry.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const source = readFileSync('public/fixtures/picture-lighting.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/picture-lighting/reference.json'));
const settings = JSON.parse(readFileSync('tests/fixtures/picture-lighting/lights.json'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
it('ties lighting measurements to the independent source', () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
});
for (const [i, c] of reference.cases.entries()) it(`matches native reference face and side colors: ${c.name}`, () => {
  const { rig, direction, rotation } = settings[i];
  const shade = create3dShader({ rig, direction, ...(rotation === null ? {} : { revolution: rotation }) });
  const camera = projection3d({ turn: c.camera === 'perspectiveRight' ? 20 : -20, perspective: true });
  for (const [surface, samples] of [['front', c.samples], ['side', c.sideSamples]]) for (const s of samples) {
    const ray = camera.ray(s.x - 172, s.y - 194);
    const hit = intersectExtrusion(ray, { width: 144, height: 108, depth: 20, geometry: 'rect' });
    expect(hit.surface).toBe(surface);
    const [x, y] = hit.point;
    const rgb = y < 0 ? (x < 0 ? [240, 40, 30] : [30, 80, 210]) : (x < 0 ? [40, 170, 70] : [240, 180, 20]);
    const actual = shade(rgb, hit.normal, ray.direction.map(v => -v));
    actual.forEach((v, channel) => expect(Math.abs(v - s.rgb[channel]), `${surface} channel ${channel}`).toBeLessThanOrEqual(3));
  }
});
const scenes = p => Object.values(p.assets).filter(a => a.scene?.type === 'picture3d').map(a => a.scene);
it('preserves the rigs and explicit rotations through editing, reopen and exact undo', async () => {
  const p = await DocxPackage.open(source), before = scenes(p);
  expect(before).toHaveLength(settings.length);
  before.forEach((s, i) => expect(s.lighting).toEqual({ rig: settings[i].rig, direction: settings[i].direction, ...(settings[i].rotation === null ? {} : { revolution: settings[i].rotation }) }));
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
  const save = async () => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(p.parts);
  d.select(0); d.replace('Edited ');
  expect(scenes(await DocxPackage.open(await save()))).toEqual(before);
  const edited = unzipSync(await save());
  expectBodyEditParts(edited, p.parts);
  d.undo(); expect(unzipSync(await save())).toEqual(p.parts);
}, 30000);
const parse = (rot, attrs = 'rig="twoPt" dir="t"') => readPicture3d(new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="rect"/><a:scene3d><a:camera prst="orthographicFront"/><a:lightRig ${attrs}>${rot}</a:lightRig></a:scene3d><a:sp3d/></a:spPr>`, 'application/xml').documentElement);
it.each([
  '<a:rot lat="0" lon="0"/>', '<a:rot lat="0" lon="0" rev="-1"/>',
  '<a:rot lat="0" lon="0" rev="21600000"/>', '<a:rot lat="0" lon="0" rev="1.5"/>',
  '<a:rot lat="NaN" lon="0" rev="0"/>', '<a:rot lat="1" lon="0" rev="0"/>',
  '<a:rot lat="0" lon="1" rev="0"/>', '<a:rot lat="0" lon="0" rev="0" foo="1"/>',
  '<a:rot lat="0" lon="0" rev="0"><a:extLst/></a:rot>',
  '<a:rot lat="0" lon="0" rev="0"/><a:rot lat="0" lon="0" rev="0"/>',
])('rejects malformed or unsupported rotation %s', xml => expect(() => parse(xml)).toThrow());
it('validates direction even when overridden and distinguishes absent from zero rotation', () => {
  expect(() => parse('', 'rig="twoPt" dir="b"')).toThrow();
  expect(() => parse('<a:rot lat="0" lon="0" rev="0"/>', 'rig="twoPt" dir="invalid"')).toThrow();
  expect(parse('<a:rot lat="+0" lon="0" rev="+21599999"/>').lighting.revolution).toBe(21599999 / 60000);
  expect(parse('<a:rot lat="0" lon="0" rev="0"/>', 'rig="twoPt" dir="b"').lighting.revolution).toBe(0);
  expect(parse('<a:rot lat="-0" lon="-0" rev="-0"/>').lighting.revolution).toBe(0);
});
it.each([-1, 360, NaN, Infinity, null, '120'])('rejects invalid shading revolution %s', revolution => {
  expect(() => create3dShader({ revolution })).toThrow();
});
