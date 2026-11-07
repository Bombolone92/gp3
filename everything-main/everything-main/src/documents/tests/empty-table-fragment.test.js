import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
vi.setConfig({testTimeout:60000});
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/empty-table-fragment.docx');
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/3});
const layout=p=>layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it('moves borders and all cells when spacing or keeps postpone the first content',async()=>{
 const p=await DocxPackage.open(source),l=layout(p);
 expect(l.pageCount).toBe(18);
 for(let i=0;i<8;i++){
  expect(l.cells.filter(c=>c.tableId===p.tables[i].id).map(c=>c.page),`case ${i}`).toEqual([i*2+1,i*2+1]);
  for(let col=0;col<2;col++)expect(l.lines.find(l=>l.fragments.some(f=>f.text===`C${i}X${col}`)).page).toBe(i*2+1);
 }
});
it('retains real fragments when every cell has started before the page cut',async()=>{
 const p=await DocxPackage.open(source),l=layout(p),table=p.tables[8];
 expect(l.cells.filter(c=>c.tableId===table.id).map(c=>c.page)).toEqual([16,17,16,17]);
 for(const cell of table.rows[0].cells){
  const lines=l.lines.filter(l=>l.cellId===cell.id);
  expect(lines.map(l=>l.page)).toEqual([16,17]);
 }
});
it('reflows through an edit, preserves other parts, and restores exact input on undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),before=layout(d),parts=unzipSync(source);
 expect(unzipSync(await save(p,d))).toEqual(parts);
 d.selectCell(d.tables[0].rows[0].cells[0].id);d.setParagraphFormat({spaceAfter:0});
 // The other cell still cannot start; changing only one cell must not split it.
 expect(layout(d).cells.filter(c=>c.tableId===d.tables[0].id).map(c=>c.page)).toEqual([1,1]);
 d.selectCell(d.tables[0].rows[0].cells[1].id);d.setParagraphFormat({spaceAfter:0});
 expect(layout(d).cells.filter(c=>c.tableId===d.tables[0].id).map(c=>c.page)).toEqual([0,0]);
 const edited=await save(p,d),exported=unzipSync(edited);
 for(const key of Object.keys(parts))if(key!=='word/document.xml')expect(exported[key]).toEqual(parts[key]);
 expect(layout(await DocxPackage.open(edited)).pageCount).toBe(layout(d).pageCount);
 d.undo();d.undo();expect(layout(d)).toEqual(before);expect(unzipSync(await save(p,d))).toEqual(parts);
});
