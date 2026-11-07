import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { readPicture3d } from '../src/engine/docx-picture-3d.js';
import { create3dShader } from '../src/engine/drawing-3d-lighting.js';
import { bevelProfile, prepareBevel } from '../src/engine/drawing-bevel-geometry.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';

const folder = 'tests/fixtures/picture-bevel/';
const read = name => JSON.parse(readFileSync(folder + name, 'utf8'));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
for (const stem of ['source', 'lighting', 'density']) {
  const ref = read(stem === 'source' ? 'reference.json' : `${stem}-reference.json`);
  const cases = read(stem === 'source' ? 'cases.json' : `${stem}-cases.json`);
  it(`ties ${stem} measurements to the independently captured source and native reference PDF`, () => {
    expect(createHash('sha256').update(readFileSync(folder + `${stem}.docx`)).digest('hex')).toBe(ref.sourceSha256);
    expect(createHash('sha256').update(readFileSync(folder + (stem === 'source' ? 'native.pdf' : `${stem}.pdf`))).digest('hex')).toBe(ref.pdfSha256);
  });
  for (const [i, c] of cases.entries()) {
    const lighting = create3dShader({ rig: c.rig || 'threePt', ...(c.rotation === undefined ? {} : { revolution: c.rotation }) });
    if (stem === 'lighting') it(`matches the native reference on all four sloped faces: ${c.name}`, () => {
      for (const sample of ref.pages[i].slopes) lighting(sample.color, sample.normal, [0, 0, 1]).forEach((v, k) => expect(Math.abs(v - sample.rgb[k])).toBeLessThanOrEqual(3));
    });
    const samples = ref.pages[i].rawTop?.samples;
    if (stem !== 'lighting' && samples?.length && (!c.geometry || c.geometry === 'rect')) it(`matches native curved highlight profiles: ${stem}/${c.name}`, () => {
      const width = c.bevel.w ?? 6, height = c.bevel.h ?? 6;
      const profile = bevelProfile({ width, height, preset: c.bevel.prst || 'circle' });
      const colorAt = inset => {
        if (!height || inset >= width) return lighting([30, 80, 210], [0, 0, 1], [0, 0, 1]);
        const i = Math.max(1, profile.findIndex(p => p.inset >= inset)), a = profile[i - 1], b = profile[i];
        const mix = Math.max(0, (inset - a.inset) / (b.inset - a.inset));
        return lighting.interpolate([30, 80, 210], [a, b].map((p, i) => ({ normal: [0, -p.normal[0], p.normal[1]], view: [0, 0, 1], weight: i ? mix : 1 - mix })));
      };
      for (const sample of samples) {
        const pitch = ref.pages[i].rawTop.pixelPitch;
        const filter = ref.pages[i].rawTop.imageFilter;
        expect(['/FlateDecode', '/DCTDecode']).toContain(filter);
        const luma = rgb => .299 * rgb[0] + .587 * rgb[1] + .114 * rgb[2];
        const difference = rgb => filter === '/DCTDecode'
          ? Math.abs(luma(rgb) - luma(sample.rgb))
          : Math.max(...rgb.map((v, k) => Math.abs(v - sample.rgb[k])));
        const error = Math.min(...Array.from({ length: 33 }, (_, j) => colorAt(Math.max(0, sample.inset + (j / 16 - 1) * pitch))).map(difference));
        // One native texel accounts for quantized mesh coverage and PDF image
        // placement. Lossless references check all RGB channels. JPEG exports
        // check luminance: their chroma ringing is not part of the reference lighting.
        // The independent lossless curved and four-face controls check color.
        expect(error, `inset ${sample.inset}`).toBeLessThanOrEqual(4);
      }
    });
  }
}
const scenes = p => Object.values(p.assets).filter(a => a.scene?.type === 'picture3d').map(a => a.scene);
it('retains all bevel declarations through editing, reopen and exact undo', async () => {
  const p = await DocxPackage.open(readFileSync(folder + 'source.docx')), before = scenes(p);
  expect(before).toHaveLength(23);
  expect(before[1].bevel).toEqual({ width: 6, height: 6, preset: 'circle' });
  expect(before[1].bevel).toEqual(before[2].bevel);
  expect(before[3].bevel).toEqual({ width: 2, height: 1.5, preset: 'circle' });
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
  const save = async () => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(p.parts);
  d.select(0); d.replace('Edited ');
  const edited = await save(); expect(scenes(await DocxPackage.open(edited))).toEqual(before);
  expectBodyEditParts(unzipSync(edited), p.parts);
  d.undo(); expect(unzipSync(await save())).toEqual(p.parts);
}, 45000);
const parse = xml => readPicture3d(new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="rect"/><a:scene3d><a:camera prst="orthographicFront"/><a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d>${xml}</a:sp3d></a:spPr>`, 'application/xml').documentElement);
it.each(['<a:bevelT w="-1"/>', '<a:bevelT h="1.5"/>', '<a:bevelT w="NaN"/>', '<a:bevelT w="27273042316901"/>', '<a:bevelT prst="divot"/>', '<a:bevelT foo="1"/>', '<a:bevelT><a:extLst/></a:bevelT>', '<a:bevelT/><a:bevelT/>', '<a:bevelB/>'])('guards unsupported or malformed bevel data: %s', xml => expect(() => parse(xml)).toThrow());
it('uses the full ST_PositiveCoordinate range for bevel dimensions', () => {
  expect(parse('<a:bevelT w="27273042316900" h="2147483648"/>').bevel).toEqual({ width: 27273042316900 / 12700, height: 2147483648 / 12700, preset: 'circle' });
});
it('accepts explicit zero, signed zero, and token whitespace without replacing them with defaults', () => {
  expect(parse('<a:bevelT w="-0" h="+0" prst=" circle "/>').bevel).toEqual({ width: 0, height: 0, preset: 'circle' });
});
it.each(['rect', 'ellipse'])('raises the face and retains the extrusion for %s', geometry => {
  const hit = prepareBevel({ width: 144, height: 108, depth: 20, geometry }, { width: 6, height: 6, preset: 'circle' });
  expect(hit({ origin: [0, 0, 100], direction: [0, 0, -1] }).point).toEqual([0, 0, 6]);
  expect(hit({ origin: [100, 0, -10], direction: [-1, 0, 0] }).point).toEqual([72, 0, -10]);
  expect(hit({ origin: [100, 100, 100], direction: [0, 0, -1] })).toBeNull();
});
it('distinguishes a zero-height bevel from a zero-width raised face', () => {
  const shape = { width: 144, height: 108, geometry: 'rect' }, ray = { origin: [0, 0, 100], direction: [0, 0, -1] };
  expect(prepareBevel(shape, { width: 6, height: 0 })(ray).point[2]).toBe(0);
  expect(prepareBevel(shape, { width: 0, height: 6 })(ray).point[2]).toBe(6);
});
it('clips an oversized bevel at the meeting of opposing edges', () => {
  const hit = prepareBevel({ width: 144, height: 108, geometry: 'rect' }, { width: 80, height: 6 })({ origin: [0, 0, 100], direction: [0, 0, -1] });
  expect(hit.point[2]).toBeGreaterThan(0); expect(hit.point[2]).toBeLessThan(6);
});
it('rejects invalid geometry and interpolation weights', () => {
  for (const b of [{ width: -1, height: 6 }, { width: 6, height: NaN }, { width: 6, height: 6, preset: 'divot' }]) expect(() => bevelProfile(b)).toThrow();
  const shade = create3dShader(), s = weight => ({ normal: [0, 0, 1], view: [0, 0, 1], weight });
  for (const samples of [[], [s(-1)], [s(NaN)], [s(.2)], [s(1), s(1)]]) expect(() => shade.interpolate([1, 2, 3], samples)).toThrow();
});
