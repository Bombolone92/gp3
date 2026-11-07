import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {readShapeGeometry} from '../src/engine/docx-shapes.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
function geometry(a, b, width = 200, height = 100) {
 const attrs = [['adj1',a],['adj2',b]].filter(([,v])=>v!==undefined).map(([name,v])=>`<a:gd name="${name}" fmla="${v}"/>`).join('');
 const node=new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="halfFrame"><a:avLst>${attrs}</a:avLst></a:prstGeom></a:spPr>`,'application/xml').documentElement;
 return readShapeGeometry(node,{width,height});
}
it('uses the full shape for text despite the open lower-right region',()=>{
 const g=geometry();expect(g.textRect).toEqual({left:0,top:0,right:1,bottom:1});
 expect(g.paths[0].points[3]).toEqual(['L',33.333,33.333]);
});
it.each([
 ['val 80000','val 100000',200,100,100,50],
 ['val 50000','val 75000',100,200,75,50],
 ['val -10000','val -10000',200,100,0,0],
 ['val 200000','val 200000',100,200,100,0],
 ['val 0','val 0',200,100,0,0],
 ['val 10000','val 25000',200,100,25,10],
])('pins both arms without crossing the diagonal (%s,%s,%s,%s)',(a,b,w,h,x,y)=>{
 const path=geometry(a,b,w,h).paths[0];
 expect(path.points[3]).toEqual(['L',x,y]);
 const upper=path.points[2],lower=path.points[4];
 expect(upper[1]/w+upper[2]/h).toBeCloseTo(1,12);
 expect(lower[1]/w+lower[2]/h).toBeCloseTo(1,12);
 expect(upper[1]).toBeGreaterThanOrEqual(x);expect(lower[2]).toBeGreaterThanOrEqual(y);
});
it.each(['val missing','*/ 1 2 0','bogus 1'])('rejects invalid adjustment %s',f=>{
 expect(()=>geometry(f)).toThrow();expect(()=>geometry(undefined,f)).toThrow();
});
it('rejects undefined zero-dimensional geometry',()=>{
 expect(()=>geometry(undefined,undefined,0,100)).toThrow();
 expect(()=>geometry(undefined,undefined,100,0)).toThrow();
});
it('preserves native controls through editing, undo and reopening',async()=>{
 const root='tests/fixtures/half-frames/',source=readFileSync(root+'control.docx'),reference=JSON.parse(readFileSync(root+'reference.json'));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(source)).toBe(reference.sourceSha256);expect(hash(readFileSync(root+'native.pdf'))).toBe(reference.pdfSha256);
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 expect(Object.values(p.assets).filter(a=>a.scene).length).toBe(8);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const parts=unzipSync(source),check=(bytes,edited=false)=>{const out=unzipSync(bytes);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const[n,b]of Object.entries(parts))if(!edited||n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 check(await save());d.select(0);d.replace('Added ');const edited=await save();check(edited,true);
 const reopened=await DocxPackage.open(edited);expect(Object.values(reopened.assets).map(a=>a.scene)).toEqual(Object.values(p.assets).map(a=>a.scene));
 d.undo();check(await save());
});
