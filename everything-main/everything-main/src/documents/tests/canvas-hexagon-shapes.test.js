import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DocxPackage } from '../src/engine/docx.js';
import { readShapeGeometry } from '../src/engine/docx-shapes.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
function geometry(values=[],width=200,height=90) {
 const xml=new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="hexagon"><a:avLst>${values.map(([name,formula])=>`<a:gd name="${name}" fmla="${formula}"/>`).join('')}</a:avLst></a:prstGeom></a:spPr>`,'application/xml');
 return readShapeGeometry(xml.documentElement,{width,height});
}
it.each([[200,90,undefined,22.5],[90,200,undefined,22.5],[100,100,undefined,25],[200,90,-5000,0],[200,90,250000,100],[80,110,125000,40]])('resolves shorter-side depth and clamps to half width (%s,%s,%s)',(width,height,adj,depth)=>{
 const g=geometry(adj===undefined?[]:[['adj',`val ${adj}`]],width,height),points=g.paths[0].points;
 expect(points[0]).toEqual(['M',0,height/2]);expect(points[1][1]).toBeCloseTo(depth,8);
 expect(points[2][1]).toBeCloseTo(width-depth,8);expect(points[3]).toEqual(['L',width,height/2]);
 expect(points[1][2]+points[5][2]).toBeCloseTo(height,8);expect(points.at(-1)).toEqual(['Z']);
});
it.each([[0,2/24],[25000,3/24],[50000,4/24],[75000,5.5/24],[100000,7/24]])('retains the two-piece text rectangle for adj %s',(adj,inset)=>{
 const g=geometry([['adj',`val ${adj}`]],200,100);
 expect(g.textRect).toEqual({left:inset,top:inset,right:1-inset,bottom:1-inset});
});
it('uses vf and resolves missing defaults independently of adjustment order',()=>{
 const a=geometry([['vf','val 80000']]),b=geometry([['vf','val 80000'],['adj','val 25000']]);
 expect(a).toEqual(b);expect(a.paths[0].points[1][2]).toBeCloseTo(45-36*Math.sin(Math.PI/3),8);
 expect(geometry([['adj','val 25000']])).toEqual(geometry());
});
it.each(['val missing','*/ 1 2 0','val','bogus 12'])('rejects malformed adjustment %s',formula=>expect(()=>geometry([['adj',formula]])).toThrow());
it('rejects unknown adjustments',()=>expect(()=>geometry([['adj2','val 20000']])).toThrow());
it('pins the native reference and imports all eight independent scenes',async()=>{
 const ref=JSON.parse(readFileSync('tests/fixtures/hexagon-shapes/reference.json'));
 for(const [path,hash] of [['public/fixtures/hexagon-shapes.docx',ref.sourceSha256],['tests/fixtures/hexagon-shapes/native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(hash);
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/hexagon-shapes.docx'));
 const scenes=Object.values(pkg.assets).map(a=>a.scene);expect(scenes).toHaveLength(8);
 for(const scene of scenes)expect(scene.paths[0].points).toHaveLength(7);
 expect(scenes.filter(s=>s.text)).toHaveLength(3);
});
it('accepts standards-valid partial and reordered adjustment lists despite reference import restrictions',async()=>{
 const root='tests/fixtures/hexagon-shapes/';
 const ref=JSON.parse(readFileSync(root+'adjustment-import.json','utf8').replace(/^\uFEFF/,'')),scenes={};
 expect(ref.results.map(r=>r.opened)).toEqual([true,false,true,false]);
 for(const entry of ref.results){
  const bytes=readFileSync(root+`adjustments-${entry.name}.docx`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.sourceSha256);
  const pkg=await DocxPackage.open(bytes);scenes[entry.name]=Object.values(pkg.assets)[0].scene;
 }
 expect(scenes.partial.paths).toEqual(scenes.empty.paths);
 expect(scenes.reversed.paths).toEqual(scenes.ordered.paths);
});
