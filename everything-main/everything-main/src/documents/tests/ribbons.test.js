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
import {ribbonGeometry} from '../src/engine/ribbon-geometry.js';
it.each([[200,90],[60,90],[90,200]])('bounds the text to the central panel at %s by %s',(w,h)=>{
 const g=ribbonGeometry(w,h);expect(g.textRect.left).toBe(.25);expect(g.textRect.right).toBe(.75);expect(g.textRect.bottom).toBeCloseTo(.83333,10);
 expect(g.paths.map(p=>[p.fill,p.stroke,p.fillMode])).toEqual([[true,false,undefined],[true,false,'darkenLess'],[false,true,undefined]]);
 for(const path of g.paths)for(const op of path.points)expect(op.slice(1).every(Number.isFinite)).toBe(true);
});
it('pins both guide ranges and collapses zero-height fold arcs',()=>{
 expect(ribbonGeometry(200,90,-10,0)).toEqual(ribbonGeometry(200,90,0,25000));
 expect(ribbonGeometry(200,90,999999,999999)).toEqual(ribbonGeometry(200,90,33333,75000));
 const g=ribbonGeometry(200,90,0,25000);expect(g.textRect).toEqual({left:.375,top:0,right:.625,bottom:1});
 expect(g.paths.every(p=>p.points.every(op=>op[0]!=='C'))).toBe(true);
});
it.each([[0,90],[200,0],[-1,90],[NaN,90]])('guards undefined extents %s,%s',(w,h)=>expect(()=>ribbonGeometry(w,h)).toThrow());
it.each(['val missing','*/ 1 2 0','bogus 1'])('guards invalid adjustment %s',formula=>{
 const node=new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="ribbon2"><a:avLst><a:gd name="adj1" fmla="${formula}"/></a:avLst></a:prstGeom></a:spPr>`,'application/xml').documentElement;
 expect(()=>readShapeGeometry(node,{width:200,height:90})).toThrow();
});
it('preserves native controls through editing, undo and reopening',async()=>{
 const root='tests/fixtures/ribbons/',source=readFileSync(root+'control.docx'),reference=JSON.parse(readFileSync(root+'reference.json'));
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
