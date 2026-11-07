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
it.each([[200,90],[60,90],[90,200]])('keeps the text body above the tip at %s by %s',(width,height)=>{
 const node=new DOMParser().parseFromString('<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="flowChartOffpageConnector"><a:avLst/></a:prstGeom></a:spPr>','application/xml').documentElement;
 const g=readShapeGeometry(node,{width,height});
 expect(g.textRect).toEqual({left:0,top:0,right:1,bottom:.8});
 expect(g.paths).toHaveLength(1);
 expect(g.paths[0].points).toEqual([['M',0,0],['L',10,0],['L',10,8],['L',5,10],['L',0,8],['Z']]);
});
it('does not silently ignore unsupported adjustments',()=>{
 const node=new DOMParser().parseFromString('<a:spPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:prstGeom prst="flowChartOffpageConnector"><a:avLst><a:gd name="adj" fmla="val 25000"/></a:avLst></a:prstGeom></a:spPr>','application/xml').documentElement;
 expect(()=>readShapeGeometry(node,{width:100,height:100})).toThrow();
});
it('preserves native controls through editing, undo and reopening',async()=>{
 const root='tests/fixtures/offpage-connectors/',source=readFileSync(root+'control.docx'),reference=JSON.parse(readFileSync(root+'reference.json'));
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
