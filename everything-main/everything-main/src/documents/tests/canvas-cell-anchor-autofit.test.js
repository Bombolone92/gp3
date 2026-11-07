import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const root='tests/fixtures/cell-anchor-autofit/';
const refs=JSON.parse(readFileSync(root+'reference.json')).cases;
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize*.45,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('excludes unwrapped floating extents and offsets from AutoFit, matching native cell widths',async()=>{
 const p=await DocxPackage.open(readFileSync(root+'control.docx')),d=model(p),l=layout(d);
 expect(l.pageCount).toBe(9);expect(l.floatingObjects).toHaveLength(9);
 for(const ref of refs){
  const cells=l.cells.filter(c=>c.page===ref.page);
  expect(cells).toHaveLength(2);
  cells.forEach((c,i)=>{expect(c.x*.75).toBeCloseTo(ref.cells[i][0],0);expect(c.width*.75).toBeCloseTo(ref.cells[i][2],0);});
  const f=l.floatingObjects[ref.page];
  expect(f.x*.75).toBeCloseTo(ref.images[0][0],0);expect(f.width*.75).toBeCloseTo(ref.images[0][2],0);
 }
 const exact=bytes=>{const parts=unzipSync(bytes);expect(Object.keys(parts).sort()).toEqual(Object.keys(p.parts).sort());for(const[n,b]of Object.entries(p.parts))expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);};
 exact(await save(p,d));
 const f=l.floatingObjects[0];d.select(f.start,f.end);d.setImageProperties({width:12700*120});
 const after=layout(d),geometry=l=>l.cells.map(c=>[c.page,c.x,c.y,c.width,c.height]);
 expect(geometry(after)).toEqual(geometry(l));expect(after.floatingObjects[0].width*.75).toBeCloseTo(120,5);
 const bytes=await save(p,d),again=layout(model(await DocxPackage.open(bytes)));
 expect(geometry(again)).toEqual(geometry(l));expect(again.floatingObjects[0].width*.75).toBeCloseTo(120,5);
 const edited=unzipSync(bytes);for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(edited[n]).equals(Buffer.from(b)),n).toBe(true);
 d.undo();exact(await save(p,d));expect(geometry(layout(d))).toEqual(geometry(l));
},30000);
