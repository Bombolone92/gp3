import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const root='tests/fixtures/script-input-context/';
const source=readFileSync(root+'control.docx'),cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const model=pkg=>new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
const save=async(pkg,doc)=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
const flags=p=>({text:p.runs.map(r=>r.text).join(''),runs:p.runs.flatMap(r=>Array(r.text.length).fill([!!r.cs,!!r.rtl,r.fontSize,r.fontSizeCs])),mark:[!!p.markFormat.cs,!!p.markFormat.rtl,p.markFormat.fontSize,p.markFormat.fontSizeCs]});
it('edits all 252 original direct and inherited contexts and matches the native reference after source-package export',async()=>{
 const pkg=await DocxPackage.open(source),native=await DocxPackage.open(readFileSync(root+'native.docx')),doc=model(pkg);
 expect(pkg.readOnly).not.toBe(true);expect(unzipSync(await save(pkg,doc))).toEqual(pkg.parts);
 for(let i=cases.length-1;i>=0;i--){doc.select(doc.paragraphOffset(i)+1);for(const step of cases[i].steps)doc.replace(step,{checkpoint:false});}
 expect(doc.paragraphs.map(flags)).toEqual(native.paragraphs.map(flags));
 const bytes=await save(pkg,doc),out=await DocxPackage.open(bytes);
 expect(out.paragraphs.map(flags)).toEqual(native.paragraphs.map(flags));
 for(const [name,part] of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(unzipSync(bytes)[name],name).toEqual(part);
},90000);
it('keeps direct script overrides after changing inherited styles and restores exact source on undo',async()=>{
 const pkg=await DocxPackage.open(source),doc=model(pkg);
 const index=cases.findIndex(c=>c.flag==='cs'&&c.inherited),at=doc.paragraphOffset(index)+1;
 doc.select(at);const before=doc.snapshot();doc.replace('X');
 expect(doc.paragraphs[index].runs.find(r=>r.text==='X')).toMatchObject({cs:false,rtl:false,fontSize:10,fontSizeCs:16});
 doc.editParagraphStyle('cs',{run:{fontSizeCs:19}});
 expect(doc.paragraphs[index].runs.find(r=>r.text==='X')).toMatchObject({cs:false,fontSizeCs:19});
 const out=await DocxPackage.open(await save(pkg,doc));expect(out.paragraphs[index].runs.find(r=>r.text==='X')).toMatchObject({cs:false,fontSizeCs:19});
 doc.undo();doc.undo();expect(doc.snapshot()).toEqual(before);expect(unzipSync(await save(pkg,doc))).toEqual(pkg.parts);
});
