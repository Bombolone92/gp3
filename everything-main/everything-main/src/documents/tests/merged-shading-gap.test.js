import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraphText} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const folder='tests/fixtures/merged-shading-gap/';
const source=readFileSync(folder+'control.docx'),reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('ties the native padding controls to their exact source and native reference PDF',()=>{
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(source)).toBe(reference.sourceSha256);expect(hash(readFileSync(folder+'native.pdf'))).toBe(reference.pdfSha256);
 expect(reference.cases.map(({spans,...c})=>c)).toEqual(JSON.parse(readFileSync(folder+'cases.json','utf8')));
 expect(reference.cases[11].spans[1][0]-reference.cases[11].spans[0][1]).toBe(6);
 expect(reference.cases[12].spans).toHaveLength(1);
});
it('retains the restart padding for merged fills while keeping ordinary cell geometry intact',async()=>{
 const p=await DocxPackage.open(source),d=model(p),result=layout(d);
 const expected=[0,0,0,0,0,0,0,0,0,0,29/15,8,0,8,8,0,0,8,0,-8,8];
 expect(d.tables).toHaveLength(expected.length);
 for(const [i,table]of d.tables.entries()){
  const cell=table.rows[0].cells[1],box=result.cells.find(c=>c.id===cell.id);
  expect(box.fillBottomInset||0,reference.cases[i].name).toBeCloseTo(expected[i]);
 }
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
it('recomputes the fill edge after neighboring padding edits and preserves exact undo and export',async()=>{
 const p=await DocxPackage.open(source),d=model(p),table=d.tables[11],owner=table.rows[0].cells[1].id,neighbor=table.rows[2].cells[0].id;
 let offset=0;
 for(const paragraph of d.paragraphs){if(paragraph.cellId===neighbor)break;offset+=paragraphText(paragraph).length+1;}
 d.select(offset);expect(layout(d).cells.find(c=>c.id===owner).fillBottomInset).toBe(8);
 d.setCellMargins({bottom:0});expect(layout(d).cells.find(c=>c.id===owner).fillBottomInset||0).toBe(0);
 const out=await save(p,d),again=model(await DocxPackage.open(out));
 expect(layout(again).cells.filter(c=>c.tableId===again.tables[11].id)[0].height).toBeGreaterThan(0);
 expect(again.tables[11].rows[2].cells[0].margins.bottom).toBe(0);
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(out)[name]).toEqual(bytes);
 d.undo();expect(layout(d).cells.find(c=>c.id===owner).fillBottomInset).toBe(8);expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('uses each page fragment’s physical padding without changing the merged content bounds',async()=>{
 const bytes=readFileSync(folder+'paged.docx'),ref=JSON.parse(readFileSync(folder+'paged-reference.json','utf8'));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(bytes)).toBe(ref.sourceSha256);expect(hash(readFileSync(folder+'paged-native.pdf'))).toBe(ref.pdfSha256);
 expect(ref.cases).toHaveLength(6);expect(ref.cases[1].spans[0][0]).toBe(60);
 const d=model(await DocxPackage.open(bytes)),result=layout(d);
 const first=result.cells.filter(c=>c.id===d.tables[0].rows[0].cells[1].id);
 expect(first.map(c=>[c.fillTopInset,c.fillBottomInset])).toEqual([[0,0],[8,8]]);
 const second=result.cells.filter(c=>c.id===d.tables[1].rows[0].cells[1].id);
 expect(second.map(c=>[c.fillTopInset,c.fillBottomInset])).toEqual([[0,-8],[0,-8]]);
 expect(first.every(c=>c.height>0)).toBe(true);
});
