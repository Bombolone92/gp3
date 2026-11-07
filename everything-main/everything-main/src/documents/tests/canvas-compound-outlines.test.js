import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { closedOutlinePath, compoundContourPoints } from '../src/engine/compound-outlines.js';
const source = readFileSync('public/fixtures/shape-compound-outlines.docx');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
function changed(change) {
  const parts = unzipSync(source), xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  change(xml); parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); return zipSync(parts);
}
it('imports every closed compound type and retains its XML through editing and undo', async () => {
  const pkg = await DocxPackage.open(source), scenes = Object.values(pkg.assets).map(a => a.scene);
  expect(scenes.map(s => s.outline.compound)).toEqual(['dbl','dbl','thickThin','thickThin','thinThick','thinThick','tri','tri']);
  expect(scenes.filter(s => s.outline.dash === 'sysDash')).toHaveLength(4);
  for (const scene of scenes) expect(scene.paths[0].points[0]).toEqual(['M', 0, 0]);
  const d = new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
  const save = async () => new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  d.select(0); d.replace('Edit ');
  const edited = await save(), reopened = await DocxPackage.open(edited);
  expect(Object.values(reopened.assets).map(a => a.scene)).toEqual(scenes);
  d.undo();
  const original = unzipSync(source), restored = unzipSync(await save());
  expect(Object.keys(restored).sort()).toEqual(Object.keys(original).sort());
  for (const name of Object.keys(original)) expect(Buffer.from(restored[name]).equals(Buffer.from(original[name])),name).toBe(true);
});
it.each(['', 'double', 'future'])('rejects malformed compound type %j', async value => {
  await expect(DocxPackage.open(changed(x => x.getElementsByTagNameNS(A,'ln')[0].setAttribute('cmpd',value)))).rejects.toMatchObject({name:'UnsupportedDocumentError'});
});
it('imports open compound paths without inventing a closing edge', async () => {
  const pkg=await DocxPackage.open(changed(x => x.getElementsByTagNameNS(A,'prstGeom')[0].setAttribute('prst','line')));
  const scene=Object.values(pkg.assets)[0].scene;
  expect(scene.outline.compound).toBe('dbl');
  expect(closedOutlinePath(scene.paths[0])).toBe(false);
});
it('requires every subpath to close, including when a later contour is closed', () => {
  expect(closedOutlinePath({points:[['M',0,0],['L',1,1],['M',2,2],['Z']]})).toBe(false);
  expect(closedOutlinePath({points:[['M',0,0],['Z'],['E'],['Z']]})).toBe(true);
  expect(closedOutlinePath({points:[['M',0,0],['Z'],['L',1,1]]})).toBe(false);
});
it('keeps zero-width compound hairlines guarded until their minimum-width rules are implemented',async()=>{
  await expect(DocxPackage.open(changed(x=>x.getElementsByTagNameNS(A,'ln')[0].setAttribute('w','0')))).rejects.toThrow(/zero-width compound outlines/);
});
it.each([[200,90,.03,46.16],[100,45,.07,23.66]])('matches the native reference curve seam at physical size %s by %s points', (width,height,x,y) => {
  const matrix={a:1,b:0,c:0,d:1,e:0,f:0},path={width,height,points:[['E'],['Z']]};
  const points=compoundContourPoints(path,width,height,matrix,1)[0];
  expect(points[0][0]).toBeCloseTo(x,1);expect(points[0][1]).toBeCloseTo(y,1);
  const scaled=compoundContourPoints(path,width/2,height*2,{...matrix,a:2,d:.5},1)[0];
  expect(scaled).toEqual(points);
});
it('does not flatten a collinear reversing curve into a straight segment',()=>{
  const points=compoundContourPoints({width:100,height:100,points:[['M',0,0],['C',100,0,-100,0,1,0],['Z']]},100,100,{a:1,b:0,c:0,d:1,e:0,f:0},1)[0];
  expect(Math.max(...points.map(p=>p[0]))).toBeGreaterThan(20);
  expect(Math.min(...points.map(p=>p[0]))).toBeLessThan(-20);
});

it('uses the 0.75-point default only when outline width is absent', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/shape-outline-default-width.docx'));
  expect(Object.values(pkg.assets).map(a => a.scene.outline.width)).toEqual(Array(8).fill(9525));
  const explicit = await DocxPackage.open(source);
  expect(Object.values(explicit.assets).map(a => a.scene.outline.width)).toEqual(Array(8).fill(114300));
});
