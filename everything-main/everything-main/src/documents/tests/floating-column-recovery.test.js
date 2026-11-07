import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {layoutPageStories} from '../src/engine/page-story-layout.js';

let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const folder='tests/fixtures/floating-column-preview/';
const measure=(text,style)=>({width:text.length*style.fontSize*.5,ascent:style.fontSize,descent:style.fontSize*.25});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const geometry=l=>l.lines.map(line=>({page:line.page,y:line.y,baseline:line.baseline,width:line.width,height:line.height,
 fragments:line.fragments.map(f=>({text:f.text,x:f.x,width:f.width,bold:f.bold,italic:f.italic,image:f.image&&{width:f.image.width,height:f.image.height}}))}));
for(const mode of ['before','after','multiple']){
 it(`${mode}: isolates floating column positioning without mutating imported cells or source`,async()=>{
  const bytes=readFileSync(folder+mode+'-unsupported.docx'),pkg=await DocxPackage.open(bytes),doc=model(pkg);
  const matched=await DocxPackage.open(readFileSync(folder+mode+'-matched.docx')),control=model(matched);
  const original=JSON.stringify({paragraphs:doc.paragraphs,tables:doc.tables});
  const layout=(d,bestEffort=false)=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables,pkg.pageStories,{bestEffort});
  expect(()=>layout(doc)).toThrow(/Floating tables in section columns/);
  const actual=layout(doc,true),expected=layout(control);
  expect(geometry(actual)).toEqual(geometry(expected));
  // Display-only pages carry an allowOversizedLines policy flag. Compare the
  // physical geometry independently of that intentionally different policy.
  const pages=l=>l.pages.map(p=>[p.width,p.height,p.left,p.right,p.top,p.bottom,p.columns]);
  expect(pages(actual)).toEqual(pages(expected));
  expect(actual.tableColumnApproximations).toHaveLength(mode==='multiple'?2:1);
  expect(actual.tableColumnApproximations.every(a=>a.message.includes('inline table at the column start'))).toBe(true);
  expect(actual.cells).toHaveLength(mode==='multiple'?12:8);
  expect(JSON.stringify({paragraphs:doc.paragraphs,tables:doc.tables})).toBe(original);
  expect(doc.tables.filter(t=>t.floating)).toHaveLength(mode==='multiple'?2:1);
  const stories=layoutPageStories(actual,pkg.pageStories,[doc.pageSettings],measure,doc.numbering,{bestEffort:true});
  expect(stories.lines.map(l=>l.fragments.map(f=>f.text).join('')).join('\n')).toContain('Healthy page header');
  expect(stories.lines.map(l=>l.fragments.map(f=>f.text).join('')).join('\n')).toContain('Healthy page footer 1');
  expect(unzipSync(new Uint8Array(await pkg.export().arrayBuffer()))).toEqual(unzipSync(bytes));
 },30000);
 it(`${mode}: leaves the matched supported document editable with exact undo`,async()=>{
  const bytes=readFileSync(folder+mode+'-matched.docx'),pkg=await DocxPackage.open(bytes),doc=model(pkg);
  const save=async()=>unzipSync(new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer()));
  const initial=layoutDocument(doc.paragraphs,measure,pageGeometry(doc.pageSettings),doc.numbering,doc.tables,pkg.pageStories);
  doc.select(0);doc.replace('Edited ');const edited=await save();
  for(const [name,part]of Object.entries(unzipSync(bytes)))if(name!=='word/document.xml'){
   if(name==='word/settings.xml'){
    // A story edit invalidates the original's saved clean proofing state.
    // Require that exact semantic change, preserving all other settings.
    const parse=bytes=>new DOMParser().parseFromString(new TextDecoder().decode(bytes),'application/xml');
    const originalSettings=parse(part),editedSettings=parse(edited[name]);
    const state=originalSettings.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','proofState')[0];
    for(const attribute of ['spelling','grammar']){
     expect(state.getAttributeNS(state.namespaceURI,attribute)).toBe('clean');
     state.setAttributeNS(state.namespaceURI,'w:'+attribute,'dirty');
    }
    expect(editedSettings.documentElement.isEqualNode(originalSettings.documentElement)).toBe(true);
   }else expect(edited[name],name).toEqual(part);
  }
  expect((await DocxPackage.open(new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer()))).readOnly).not.toBe(true);
  doc.undo();expect(await save()).toEqual(unzipSync(bytes));
  expect(geometry(layoutDocument(doc.paragraphs,measure,pageGeometry(doc.pageSettings),doc.numbering,doc.tables,pkg.pageStories))).toEqual(geometry(initial));
 },30000);
}
