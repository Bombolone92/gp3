import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument,imageAtPoint,selectionRects} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const refs=JSON.parse(readFileSync('tests/fixtures/cell-anchor-flow/reference.json'));
const origins=JSON.parse(readFileSync('tests/fixtures/cell-anchor-flow/origins.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize*.6,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
for(const ref of origins)it('resolves a displaced second-cell origin with both layoutInCell values: '+ref.file,async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/'+ref.file)),d=model(p),l=layout(d);
 expect(l.pageCount).toBe(2);expect(l.floatingObjects).toHaveLength(2);
 l.floatingObjects.forEach((f,page)=>[f.x,f.y,f.width,f.height].forEach((v,i)=>expect(v*.75).toBeCloseTo(ref.frames[page][0][i],1)));
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
for(const ref of refs)it('matches the native reference cell flow, alignment and overflow: '+ref.file,async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/'+ref.file)),d=model(p),l=layout(d);
 expect(l.pageCount).toBe(ref.pages.length);expect(l.floatingObjects).toHaveLength(ref.pages.length);
 for(const [index,expected] of ref.pages.entries()){
  const c=l.cells.find(c=>c.page===index),f=l.floatingObjects[index];
  [c.x,c.y,c.width,c.height].forEach((v,i)=>expect(v*.75,'cell '+index).toBeCloseTo(expected.cell[i],0));
  [f.x,f.y,f.width,f.height].forEach((v,i)=>expect(v*.75,'frame '+index).toBeCloseTo(expected.frames[0][i],1));
  expect(f.cellClip).toBeUndefined();expect(imageAtPoint(l,index,f.x+f.width/2,f.y+f.height-1)).toBe(f);
  expect(selectionRects(l,f.start,f.end)).toContainEqual({page:index,x:f.x,y:f.y,width:f.width,height:f.height});
  const find=text=>d.paragraphs.find(p=>paragraphText(p).replaceAll('\ufffc','')===text);
  const first=find(expected.lines[0].text),firstLine=l.lines.find(l=>l.paragraphId===first.id);
  for(const entry of expected.lines){const p=find(entry.text),line=l.lines.find(l=>l.paragraphId===p.id);expect(line.page).toBe(index);expect((line.baseline-firstLine.baseline)*.75,entry.text).toBeCloseTo(entry.baseline-expected.lines[0].baseline,0);}
 }
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('resizes an unwrapped drawing without moving following text or growing its row; preserves undo and export',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/cell-anchor-flow.docx')),d=model(p),before=layout(d),f=before.floatingObjects[0];
 d.select(f.start,f.end);d.setImageProperties({height:914400});const after=layout(d);
 expect(after.cells.map(c=>[c.page,c.x,c.y,c.height])).toEqual(before.cells.map(c=>[c.page,c.x,c.y,c.height]));
 expect(after.lines.map(l=>[l.paragraphId,l.page,l.y,l.height])).toEqual(before.lines.map(l=>[l.paragraphId,l.page,l.y,l.height]));
 expect(after.floatingObjects[0].height).toBe(96);
 const bytes=await save(p,d),reopened=layout(model(await DocxPackage.open(bytes)));expect(reopened.floatingObjects[0].height).toBe(96);
 for(const [name,part] of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(bytes)[name]).toEqual(part);
 d.undo();expect(layout(d)).toEqual(before);expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
