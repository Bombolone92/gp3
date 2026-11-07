import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DocxPackage } from '../src/engine/docx.js';
import { readShapeGeometry } from '../src/engine/docx-shapes.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const geometry=(kind,adjustments='',width=200,height=90)=>readShapeGeometry(new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="${kind}"><a:avLst>${adjustments}</a:avLst></a:prstGeom></a:spPr>`,'application/xml').documentElement,{width,height});
it('star5 applies the standard adjustment clamp and preserves asymmetric text bounds', () => {
 const g=adj=>geometry('star5',`<a:gd name="adj" fmla="val ${adj}"/>`);
 expect(g(-5000)).toEqual(g(0));expect(g(75000)).toEqual(g(50000));expect(geometry('star5')).toEqual(g(19098));
 const star=geometry('star5');expect(star.paths[0].points).toHaveLength(11);
 expect(star.paths[0].points[2]).toEqual(['L',100,0]);
 expect(star.textRect.left+star.textRect.right).toBeCloseTo(1,10);
 expect(star.textRect.top+star.textRect.bottom).not.toBeCloseTo(1,4);
});
it.each(['<a:gd name="unknown" fmla="val 1"/>','<a:gd name="adj" fmla="*/ 1 2 0"/>','<a:gd name="hf" fmla="val missing"/>'])('star5 rejects invalid adjustment %s',xml=>expect(()=>geometry('star5',xml)).toThrow());
it('round2SameRect imports independently generated native controls', async () => {
 const source=readFileSync('public/fixtures/corner-round2SameRect.docx'),root='tests/fixtures/corner-round2SameRect/',ref=JSON.parse(readFileSync(root+'reference.json'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);
 expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
 const pkg=await DocxPackage.open(source),scenes=Object.values(pkg.assets).map(a=>a.scene);
 expect(scenes).toHaveLength(8);expect(scenes.filter(s=>s.text)).toHaveLength(3);
});
it('round2SameRect uses independent top/bottom radii and the larger side text inset', () => {
 const g=(a,b,w=200,h=90)=>geometry('round2SameRect',`<a:gd name="adj1" fmla="val ${a}"/><a:gd name="adj2" fmla="val ${b}"/>`,w,h);
 expect(g(-5000,75000)).toEqual(g(0,50000));
 expect(g(75000,-5000)).toEqual(g(50000,0));
 expect(geometry('round2SameRect')).toEqual(g(16667,0));
 for(const [w,h] of [[200,90],[90,200]]) {
  const rect=g(10000,40000,w,h).textRect,short=Math.min(w,h);
  expect(rect.top*h).toBeCloseTo(short*.1*.29289,9);
  expect((1-rect.bottom)*h).toBeCloseTo(short*.4*.29289,9);
  expect(rect.left*w).toBeCloseTo(short*.4*.29289,9);
  expect(rect.left+rect.right).toBeCloseTo(1,9);
 }
});
it.each(['<a:gd name="adj" fmla="val 1"/>','<a:gd name="adj1" fmla="*/ 1 2 0"/>','<a:gd name="adj2" fmla="val missing"/>','<a:gd name="adj2" fmla="val 1" unexpected="1"/>'])('round2SameRect rejects invalid adjustments %s', xml=>expect(()=>geometry('round2SameRect',xml)).toThrow());
for(const kind of ['octagon','plaque','roundRect']){
 it(`${kind} imports the independent native controls and binds their reference hashes`,async()=>{
  const source=readFileSync(`public/fixtures/corner-${kind}.docx`),root=`tests/fixtures/corner-${kind}/`,ref=JSON.parse(readFileSync(root+'reference.json'));
  expect(createHash('sha256').update(source).digest('hex')).toBe(ref.sourceSha256);
  expect(createHash('sha256').update(readFileSync(root+'native.pdf')).digest('hex')).toBe(ref.pdfSha256);
  const pkg=await DocxPackage.open(source),scenes=Object.values(pkg.assets).map(a=>a.scene);
  expect(scenes).toHaveLength(8);expect(scenes.filter(s=>s.text)).toHaveLength(3);
  expect(scenes[5].width).toBe(200*12700);expect(scenes[5].height).toBe(90*12700);
 });
 it(`${kind} clamps negative and excessive corner depths without changing rectangle bounds`,()=>{
  const g=adj=>geometry(kind,`<a:gd name="adj" fmla="val ${adj}"/>`);
  expect(g(-5000)).toEqual(g(0));expect(g(75000)).toEqual(g(50000));
  for(const [w,h]of [[200,90],[90,200]]){
   const r=geometry(kind,'',w,h).textRect;
   expect(r.left*w).toBeCloseTo(r.top*h,9);expect(r.left+r.right).toBeCloseTo(1);expect(r.top+r.bottom).toBeCloseTo(1);
  }
 });
 it.each(['<a:gd name="adj2" fmla="val 10000"/>','<a:gd name="adj" fmla="*/ 1 2 0"/>','<a:gd name="adj" fmla="val missing"/>'])(`${kind} rejects invalid adjustment %s`,xml=>expect(()=>geometry(kind,xml)).toThrow());
}
