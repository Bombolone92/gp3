import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument, selectionRects, hitTest } from '../src/engine/layout.js';
import { paragraphText } from '../src/engine/model.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
for(const mode of ['inner-exact','outer-exact','both-exact','deep','center','bottom']) it(`retains nested exact-height clipping for text, selection, cells and borders: ${mode}`,async()=>{
 const pkg=await DocxPackage.open(readFileSync(`tests/fixtures/nested-tables/nested-clipping-${mode}.docx`));
 const layout=layoutDocument(pkg.paragraphs,(text,style)=>({width:[...text].length*style.fontSize*2/3,ascent:style.fontSize*1.25,descent:style.fontSize*5/12}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const labels=new Map(pkg.paragraphs.map(p=>[p.id,paragraphText(p)]));
 const line=label=>layout.lines.find(l=>labels.get(l.paragraphId)===label);
 const hidden=line('Inner line 3'),first=line('Inner line 1');
 // All four independently authored native reference PDFs retain line 3 in their text
 // stream but clip its glyphs. Editing must use the same visible boundary.
 expect(hidden.cellClip.bottom).toBeLessThanOrEqual(hidden.y);
 expect(selectionRects(layout,hidden.start,hidden.end)).toEqual([]);
 expect(first.cellClip.bottom-first.cellClip.top).toBeLessThan(mode==='outer-exact'?48:32);
 const outer=layout.cells.find(c=>c.depth===1);
 for(const cell of layout.cells.filter(c=>c.depth>1)) {
   expect(cell.cellClip).toBeDefined();
   expect(cell.cellClip.top).toBeGreaterThanOrEqual(outer.y);
   expect(cell.cellClip.bottom).toBeLessThanOrEqual(outer.y+outer.height);
   for(const border of layout.tableBorders.filter(b=>b.tableId===cell.tableId)) expect(border.cellClip).toEqual(cell.cellClip);
 }
 if(mode==='outer-exact'||mode==='both-exact') {
   const after=line('After outer table');
   const at=hitTest(layout,after.page,after.x,after.y+after.height/2);
   expect(at).toBeGreaterThanOrEqual(after.start);expect(at).toBeLessThanOrEqual(after.end);
 }
});
