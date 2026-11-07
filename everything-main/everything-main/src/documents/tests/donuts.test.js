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
function geometry(value, width = 200, height = 100) {
 const adj=value===undefined?'':`<a:gd name="adj" fmla="${value}"/>`;
 const node=new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="donut"><a:avLst>${adj}</a:avLst></a:prstGeom></a:spPr>`,'application/xml').documentElement;
 return readShapeGeometry(node,{width,height});
}
it.each([[undefined,25],['val 0',0],['val -100',0],['val 50000',50],['val 100000',50]])('clamps the ring thickness and keeps opposite winding (%s)',(formula,inset)=>{
 const g=geometry(formula),p=g.paths[0].points;
 expect(p[0]).toEqual(['M',0,50]);expect(p[10]).toEqual(['M',inset,50]);
 expect(p[1][2]).toBeLessThan(50);expect(p[11][2]).toBeGreaterThanOrEqual(50);
 expect(p.filter(x=>x[0]==='Z')).toHaveLength(2);
 expect(p.flat().filter(x=>typeof x==='number').every(Number.isFinite)).toBe(true);
 expect(g.textRect.left).toBeCloseTo((1-Math.SQRT1_2)/2,12);
});
it('uses the shorter dimension for elliptical ring thickness',()=>{
 expect(geometry('val 10000',100,200).paths[0].points[10]).toEqual(['M',10,100]);
});
it.each(['val missing','*/ 1 2 0','bogus 1'])('rejects invalid adjustment %s',f=>expect(()=>geometry(f)).toThrow());
it('rejects zero-dimensional geometry',()=>{expect(()=>geometry(undefined,0,100)).toThrow();expect(()=>geometry(undefined,100,0)).toThrow();});
it('preserves native controls through editing, undo and reopening',async()=>{
 const root='tests/fixtures/donuts/',source=readFileSync(root+'control.docx'),reference=JSON.parse(readFileSync(root+'reference.json'));
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
