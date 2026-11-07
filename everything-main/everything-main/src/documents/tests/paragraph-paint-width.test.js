import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {paragraphBackgrounds} from '../src/engine/paragraph-backgrounds.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const refs=JSON.parse(readFileSync('tests/fixtures/paragraph-paint-width/reference.json'));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize*.5,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
for(const ref of refs)it('matches the native reference horizontal decoration bounds: '+ref.file,async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/'+ref.file)),d=model(p),l=layout(d),backgrounds=paragraphBackgrounds(l.lines,l.page,l.cells);
 expect(l.pageCount).toBe(ref.pages.length);
 for(const [index,page] of ref.pages.entries()){
  if(page.compareFill)for(const [i,label] of page.labels.entries()){
   const paragraph=d.paragraphs.find(p=>paragraphText(p)===label),line=l.lines.find(l=>l.paragraphId===paragraph.id),rect=backgrounds.get(line).rect;
   expect(line.page).toBe(index);expect(Math.abs(rect.x*.75-page.fills[i].x),label+' left').toBeLessThan(.3);
   expect(Math.abs((rect.x+rect.width)*.75-page.fills[i].right),label+' right').toBeLessThan(.3);
  }
  if(page.compareBorder && page.borderLeft!==null)expect(Math.abs(Math.min(...l.paragraphBorders.filter(b=>b.page===index).map(b=>b.x))*.75-page.borderLeft)).toBeLessThan(.3);
 }
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('moves paint bounds with indent edits while preserving source parts, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/paragraph-border-width-control.docx')),d=model(p),before=layout(d);
 d.select(d.text.indexOf('Case0Body'));d.setParagraphFormat({indentLeft:740});const after=layout(d);
 const id=d.paragraphs.find(p=>paragraphText(p)==='Case0Body').id;
 expect(after.lines.find(l=>l.paragraphId===id).paragraphFrame.x-before.lines.find(l=>l.paragraphId===id).paragraphFrame.x).toBeCloseTo(4/3);
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 const geometry=l=>l.paragraphBorders.map(({paragraphId,cellId,...border})=>border);
 expect(geometry(layout(reopened))).toEqual(geometry(after));
 for(const [name,data]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(bytes)[name]).toEqual(data);
 d.undo();expect(layout(d)).toEqual(before);expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
