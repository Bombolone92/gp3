import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { paragraphEdges } from '../src/engine/paragraph-geometry.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('accepts twip-derived one-pixel cells and keeps caret geometry through edits and undo',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/narrow-cell-roundoff.docx'));
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const render=()=>layoutDocument(d.paragraphs,t=>({width:t.length*8,ascent:12,descent:4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
 const layout=render(),cell=d.tables[0].rows[0].cells[1],box=layout.cells.find(c=>c.id===cell.id),line=layout.lines.find(l=>l.cellId===cell.id);
 expect(layout.pageCount).toBe(1);expect(box.width-(cell.margins.left+cell.margins.right)/15).toBeCloseTo(1,10);
 expect(caretRect(layout,line.start).height).toBeGreaterThan(0);
 d.select(0);d.replace('Edited ');expect(render().pageCount).toBe(1);d.undo();expect(render()).toEqual(layout);
});
it.each([0,0.5,0.99,0.99999])('still rejects a genuinely undersized %s px region',width=>{
 expect(()=>paragraphEdges({indentLeft:0,indentRight:0,firstLine:0},{left:100,right:200-width,width:300,allowOverflowIndents:true},true)).toThrow(/no writing space/);
});
