import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const folder='tests/fixtures/first-cell-keep',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/3});
const layout=p=>layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables,p.pageStories,{styles:p.styles});
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
for(const [name,ref]of Object.entries(refs))it(`${name}: follows original native row/page boundaries`,async()=>{
 for(const[n,h]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);
 const p=await DocxPackage.open(readFileSync(`${folder}/${name}.docx`)),l=layout(p);expect(l.pageCount).toBe(ref.pages);
 for(const[m,pages]of Object.entries(ref.markers))expect(l.lines.filter(l=>l.fragments.map(f=>f.text||'').join('')===m).map(l=>l.page),m).toEqual(pages);
});
it('reflows a kept first cell, preserves package parts and exactly undoes the edit',async()=>{
 const bytes=readFileSync(`${folder}/left.docx`),p=await DocxPackage.open(bytes),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const heading=x=>layout(x).lines.find(l=>l.fragments.some(f=>f.text==='Heading')).page;
 expect(heading(d)).toBe(1);d.selectCell(d.tables[0].rows[0].cells[0].id);d.setParagraphFormat({keepNext:false});expect(heading(d)).toBe(0);
 const edited=await save(p,d),parts=unzipSync(edited);for(const[n,b]of Object.entries(unzipSync(bytes)))if(n!=='word/document.xml')expect(parts[n]).toEqual(b);
 expect(heading(await DocxPackage.open(edited))).toBe(0);d.undo();expect(heading(d)).toBe(1);expect(unzipSync(await save(p,d))).toEqual(unzipSync(bytes));
});
it('reflows the tight row when its first-cell keep changes and preserves the package through undo',async()=>{
 const bytes=readFileSync('tests/fixtures/row-keep-fitting/tight-1.docx');
 const p=await DocxPackage.open(bytes),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const heading=x=>layout(x).lines.find(l=>l.fragments.some(f=>f.text==='Heading 1')).page;
 expect(heading(d)).toBe(1);
 d.selectCell(d.tables[0].rows[0].cells[0].id);d.setParagraphFormat({keepNext:false});
 expect(heading(d)).toBe(0);
 const edited=await save(p,d),parts=unzipSync(edited);
 for(const [name,data]of Object.entries(unzipSync(bytes)))if(name!=='word/document.xml')expect(parts[name]).toEqual(data);
 expect(heading(await DocxPackage.open(edited))).toBe(0);
 d.undo();expect(heading(d)).toBe(1);expect(unzipSync(await save(p,d))).toEqual(unzipSync(bytes));
 d.redo();expect(heading(d)).toBe(0);
});
