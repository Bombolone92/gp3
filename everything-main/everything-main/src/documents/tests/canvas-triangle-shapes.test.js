import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { readShapeGeometry } from '../src/engine/docx-shapes.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
function geometry(kind, adjustment, width=200, height=90, name='adj') {
 const xml = new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="${kind}"><a:avLst>${adjustment === undefined ? '' : `<a:gd name="${name}" fmla="${adjustment}"/>`}</a:avLst></a:prstGeom></a:spPr>`, 'application/xml');
 return readShapeGeometry(xml.documentElement, {width,height});
}
it.each([[undefined,.5],['val 20000',.2],['val 0',0],['val 100000',1],['val -5000',0],['val 125000',1]])('resolves triangle apex and text rectangle for %s', (formula, apex) => {
 const result=geometry('triangle',formula);
 expect(result.paths[0].points).toEqual([['M',0,90],['L',200*apex,0],['L',200,90],['Z']]);
 expect(result.textRect).toEqual({left:apex/2,top:.5,right:apex/2+.5,bottom:1});
});
it('retains the distinct right triangle text rectangle in portrait dimensions',()=>{
 const result=geometry('rtTriangle',undefined,90,200);
 expect(result.paths[0].points).toEqual([['M',0,200],['L',0,0],['L',90,200],['Z']]);
 expect(result.textRect).toEqual({left:1/12,top:7/12,right:7/12,bottom:11/12});
});
it.each(['val missing','*/ 1 2 0','val','bogus 12'])('rejects invalid triangle formula %s', f=>expect(()=>geometry('triangle',f)).toThrow());
it('rejects unknown adjustments instead of discarding their meaning',()=>{
 expect(()=>geometry('triangle','val 25000',200,90,'adj2')).toThrow();
 expect(()=>geometry('rtTriangle','val 25000')).toThrow();
});
it('retains all independent controls as drawing scenes',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/triangle-shapes.docx'));
 const scenes=Object.values(pkg.assets).map(a=>a.scene);
 expect(scenes).toHaveLength(8);
 for(const scene of scenes) expect(scene.paths[0].points).toHaveLength(4);
 expect(scenes.filter(s=>s.text).map(s=>s.text.paragraphs.flatMap(p=>p.runs.map(r=>r.text)).join(''))).toEqual(['Inset text','Inset text','Inset text']);
});
