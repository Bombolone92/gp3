import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {readShapeGeometry} from '../src/engine/docx-shapes.js';
import {appendEllipseArc,cloudGeometry} from '../src/engine/cloud-geometry.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
it.each([5400000,-5400000,21600000,-21600000,0])('retains ellipse endpoints for sweep %s',sweep=>{
 const points=[];const end=appendEllipseArc(points,10,0,10,5,0,sweep);
 const expected=sweep===5400000?[0,5]:sweep===-5400000?[0,-5]:[10,0];
 end.forEach((n,i)=>expect(n).toBeCloseTo(expected[i],10));
 for(const p of points)expect(p.slice(1).every(Number.isFinite)).toBe(true);
});
it('uses radial angles on noncircular ellipses',()=>{
 const points=[],end=appendEllipseArc(points,10,0,10,5,0,2700000);
 expect(end[0]).toBeCloseTo(Math.sqrt(20),10);expect(end[1]).toBeCloseTo(Math.sqrt(20),10);
});
it.each([[200,90],[60,90],[90,200]])('keeps bubbles circular in %s by %s shapes',(w,h)=>{
 const g=cloudGeometry(w,h,true,0,90000),fills=g.paths.filter(p=>p.fill);
 expect(fills).toHaveLength(4);expect(g.paths.slice(4).every(p=>!p.fill&&p.stroke)).toBe(true);
 for(const p of fills.slice(1)){
  const ends=p.points.filter(p=>p[0]==='C').map(p=>p.slice(-2));
  const xs=ends.map(p=>p[0]),ys=ends.map(p=>p[1]);
  expect(Math.max(...xs)-Math.min(...xs)).toBeCloseTo(Math.max(...ys)-Math.min(...ys),8);
 }
 expect(g.textRect.left).toBeCloseTo(2977/21600,10);
});
it.each(['val missing','*/ 1 2 0','bogus 1'])('rejects invalid cloud adjustments %s',fmla=>{
 const xml=new DOMParser().parseFromString(`<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="cloudCallout"><a:avLst><a:gd name="adj1" fmla="${fmla}"/></a:avLst></a:prstGeom></a:spPr>`,'application/xml');
 expect(()=>readShapeGeometry(xml.documentElement,{width:200,height:90})).toThrow();
});
it('preserves native controls through editing, undo and reopening',async()=>{
 const root='tests/fixtures/cloud-callouts/',source=readFileSync(root+'control.docx'),reference=JSON.parse(readFileSync(root+'reference.json'));
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
