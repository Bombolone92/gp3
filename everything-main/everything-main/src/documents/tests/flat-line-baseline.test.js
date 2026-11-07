import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,imageAtPoint} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for(const mode of [12,15]){
 const source=readFileSync(`tests/fixtures/flat-line-baseline/mode-${mode}.docx`);
 it(`keeps zero-height objects on the mark baseline and hittable in mode ${mode}`,async()=>{
  const p=await DocxPackage.open(source);
  const measure=(text,style)=>{const scale=(style.fontSize||12)/12;return {width:text.length*6*scale,ascent:10*scale,descent:3*scale};};
  const layout=layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
  for(const name of ['arial-zero','large-run-small-mark','table-zero']){
   const line=layout.lines.find(l=>l.fragments.some(f=>f.image?.name===name));
   expect(line.ascent,name).toBe(10);expect(line.descent,name).toBe(3);
   const f=line.fragments.find(f=>f.image);
   expect(imageAtPoint(layout,line.page,f.x+20,line.baseline)?.image.id,name).toBe(f.image.id);
  }
 });
 it(`retains flat drawings through edits and exact package undo in mode ${mode}`,async()=>{
  const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edit ');
  const bytes=await save(),parts=unzipSync(bytes),reopened=await DocxPackage.open(bytes);
  for(const name of Object.keys(p.parts))if(name!=='word/document.xml')expect(parts[name],name).toEqual(p.parts[name]);
  const shells=p=>p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image.shell));
  expect(shells(reopened)).toEqual(shells(p));d.undo();expect(unzipSync(await save())).toEqual(p.parts);
 });
}
