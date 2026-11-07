import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('public/fixtures/picture-sketch-outlines.docx');
const walk = n => [n, ...(n.children || []).flatMap(walk)];
const nodes = pkg => Object.values(pkg.assets).filter(a => a.scene).flatMap(a => walk(a.scene));

it('regenerates supported retained sketches in editable documents without serializing the projection', async () => {
  const pkg = await DocxPackage.open(source);
  expect(pkg.readOnly).not.toBe(true);
  expect(nodes(pkg).filter(n => n.type === 'picture')).toHaveLength(12);
  const cached = nodes(pkg).filter(n => n.outline?.cachedSketch);
  expect(cached).toHaveLength(1);
  expect(cached[0].pictureOutline).toBe(false);
  expect(cached[0].paths.map(p => [p.fill,p.stroke])).toEqual([[false,true],[true,false]]);
  expect(cached[0].paths[0].points).toContainEqual(['C',64205,13935,249370,36594,457200,0]);
  expect(pkg.parts).toEqual(unzipSync(source));
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(pkg.parts);
});

it('retains ordinary outline editing and outside placement when best-effort opening is requested', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/picture-outlines.docx'), { bestEffort: true });
  expect(pkg.readOnly).not.toBe(true);
  const outlines = nodes(pkg).filter(n => n.outline);
  expect(outlines).toHaveLength(12);
  expect(outlines.every(n => n.pictureOutline && !n.outline.cachedSketch)).toBe(true);
});

it.each([' +12345 ', '00012345', '-0'])('accepts unsigned-integer seed lexical form %s for supported retained drawings', async seed => {
  const parts = unzipSync(source);
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('sd="12345"', `sd="${seed}"`));
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(pkg.readOnly).not.toBe(true);
  expect(nodes(pkg).filter(n => n.outline?.cachedSketch)).toHaveLength(1);
  expect(pkg.parts).toEqual(parts);
});

it.each([
  ['sd="12345"','sd="-1"'], ['sd="12345"','sd="4294967296"'],
  ['lineSketchCurved','unknownSketch'],
  ['C807C97D-BFC1-408E-A445-0C87EB9F89A2','00000000-0000-0000-0000-000000000000'],
])('does not interpret malformed or unknown sketch metadata: %s', async (from,to) => {
  const parts = unzipSync(source), xml = strFromU8(parts['word/document.xml']);
  expect(xml).toContain(from); parts['word/document.xml'] = strToU8(xml.replace(from,to));
  const changed = zipSync(parts);
  await expect(DocxPackage.open(changed)).rejects.toThrow();
  const pkg = await DocxPackage.open(changed, { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(nodes(pkg).some(n => n.outline?.cachedSketch)).toBe(false);
  expect(pkg.parts).toEqual(parts);
  expect(() => pkg.export()).toThrow(/read-only/);
});

for (const fixture of ['sketch-regeneration', 'sketch-heldout']) {
  it(`regenerates inline sketch fill and outline together in ${fixture}`, async () => {
    const source = readFileSync(`tests/fixtures/${fixture}/control.docx`);
    const native = JSON.parse(readFileSync(`tests/fixtures/${fixture}/geometry.json`));
    const pkg = await DocxPackage.open(source, { bestEffort: true });
    const outlines = nodes(pkg).filter(n => n.outline?.cachedSketch);
    const pictures = nodes(pkg).filter(n => n.type === 'picture');
    expect(outlines).toHaveLength(native.length);
    for (const c of native) {
      const expected = c.paths.map(p => p.commands.map(n => [{ moveTo: 'M', cubicBezTo: 'C', close: 'Z' }[n.type], ...n.points.flat()]));
      expect(outlines[c.index].paths.map(p => p.points)).toEqual(expected);
      expect(pictures[c.index].clipPaths.map(p => p.points)).toEqual(expected);
    }
    expect(pkg.readOnly).not.toBe(true);
    expect(pkg.parts).toEqual(unzipSync(source));
    expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(pkg.parts);
  });
}

it.each(['missing', 'ambiguous', 'adjusted'])('retains the cache when rectangle regeneration metadata is %s', async kind => {
  const parts = unzipSync(source);
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const ASK = 'http://schemas.microsoft.com/office/drawing/2018/sketchyshapes';
  const saved = xml.getElementsByTagNameNS(ASK, 'lineSketchStyleProps')[0];
  if (kind === 'missing') saved.removeAttribute('sd');
  if (kind === 'ambiguous') { const seed = xml.createElementNS(ASK, 'ask:seed'); seed.textContent = '42'; saved.append(seed); }
  if (kind === 'adjusted') { const A = 'http://schemas.openxmlformats.org/drawingml/2006/main'; const gd = xml.createElementNS(A, 'a:gd'); gd.setAttribute('name', 'adj'); gd.setAttribute('fmla', 'val 1'); saved.getElementsByTagNameNS(A, 'avLst')[0].append(gd); }
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(nodes(pkg).find(n => n.outline?.cachedSketch).paths[0].points).toContainEqual(['L',100,100]);
  expect(pkg.readOnly).toBe(true);
  expect(pkg.parts).toEqual(parts);
});

it('regenerates fill clipping even when a sketch outline is invisible', async () => {
  const source = readFileSync('tests/fixtures/sketch-ellipse/control.docx');
  const native = JSON.parse(readFileSync('tests/fixtures/sketch-ellipse/geometry.json'));
  const pkg = await DocxPackage.open(source, { bestEffort: true });
  const pictures = nodes(pkg).filter(n => n.type === 'picture');
  expect(pictures).toHaveLength(native.length);
  for (const c of native) {
    expect(pictures[c.index].clipPaths.map(p => ({ width: p.width, height: p.height, points: p.points }))).toEqual(c.paths.map(p => ({ width: Number(p.attributes.w), height: Number(p.attributes.h), points: p.commands.map(n => [{ moveTo: 'M', cubicBezTo: 'C', close: 'Z' }[n.type], ...n.points.flat()]) })));
  }
  expect(pkg.readOnly).not.toBe(true);
  expect(pkg.parts).toEqual(unzipSync(source));
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(pkg.parts);
});

it.each(['cx', 'cy'])('keeps a zero %s sketch extent outside editable import', async axis => {
  const parts = unzipSync(source);
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const ASK = 'http://schemas.microsoft.com/office/drawing/2018/sketchyshapes', A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const saved = xml.getElementsByTagNameNS(ASK, 'lineSketchStyleProps')[0];
  const properties = saved.parentNode.parentNode.parentNode.parentNode;
  properties.getElementsByTagNameNS(A, 'xfrm')[0].getElementsByTagNameNS(A, 'ext')[0].setAttribute(axis, '0');
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(pkg.readOnly).toBe(true);
  expect(pkg.parts).toEqual(parts);
});
