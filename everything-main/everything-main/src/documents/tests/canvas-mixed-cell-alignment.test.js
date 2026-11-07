import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync,zipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {layoutDocument} from '../src/engine/layout.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('tests/fixtures/mixed-cell-alignment/control.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const measure=(t,s)=>({width:t.length*s.fontSize*.45,ascent:s.fontSize,descent:s.fontSize/3});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
it('aligns floating bounds with cell text without growing rows and preserves edits',async()=>{
 const p=await DocxPackage.open(source),d=model(p),before=layout(d);
 expect(before.pageCount).toBe(12);expect(before.floatingObjects).toHaveLength(12);
 for(let base=0;base<12;base+=3){const[top,center,bottom]=before.floatingObjects.slice(base,base+3);expect(center.y-top.y).toBeGreaterThan(0);expect(bottom.y-top.y).toBeCloseTo(2*(center.y-top.y));}
 for(const frame of before.floatingObjects){
  const line=before.lines.find(l=>l.fragments.some(f=>f.image?.id===frame.image.id)),cell=before.cells.find(c=>c.id===line.cellId&&c.page===line.page);
  expect(frame.y).toBeCloseTo(cell.y+16+line.cellAlignmentShift);expect(cell.height).toBeCloseTo(80*4/3);expect(frame.cellClip).toBeUndefined();
  expect(frame.x).toBeCloseTo(cell.x+10*4/3+(frame.image.anchor.horizontal==='column'?16:0));
 }
 const frames=d=>layout(d).floatingObjects.map(f=>[f.page,f.x,f.y,f.width,f.height]);
 const save=async()=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
 const exact=parts=>{expect(Object.keys(parts).sort()).toEqual(Object.keys(p.parts).sort());for(const[n,b]of Object.entries(p.parts))expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);};
 exact(await save());d.select(d.text.indexOf('Anchor cell'));d.replace('Edit ');const out=await save();expect(frames(model(await DocxPackage.open(zipSync(out))))).toEqual(frames(d));
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);
 d.undo();expect(frames(d)).toEqual(before.floatingObjects.map(f=>[f.page,f.x,f.y,f.width,f.height]));exact(await save());
},30000);
