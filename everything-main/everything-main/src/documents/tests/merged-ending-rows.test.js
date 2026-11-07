import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {expectBodyEditParts} from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
for(const mode of [14,15])it(`preserves exact-ending merged rows and hidden source in compatibility ${mode}`,async()=>{
 const source=readFileSync(`tests/fixtures/merged-ending-rows/controls-${mode}.docx`),pkg=await DocxPackage.open(source);
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const placed=layoutDocument(doc.paragraphs,(t,s)=>({width:t.length*s.fontSize*2/3,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(doc.pageSettings),doc.numbering,doc.tables);
 expect(placed.pageCount).toBe(16);
 for(const table of doc.tables.filter(t=>!t.parentCellId)){
  const owner=table.rows[0].cells[1],exact=table.rows.at(-1).heightRule==='exact';
  const box=placed.cells.find(c=>c.id===owner.id),lines=placed.lines.filter(l=>l.cellId===owner.id);
  if(exact){
   for(const row of table.rows)expect(placed.cells.find(c=>c.id===row.cells[0].id).height).toBeCloseTo(40*4/3);
   expect(box.height).toBeCloseTo(table.rows.length*40*4/3);
   expect(lines.every(l=>l.cellClip)).toBe(true);
   const hidden=placed.lines.find(l=>l.page===box.page&&l.baseline>box.y+box.height&&l.cellId!==table.rows.at(-1).cells[0].id&&l.cellClip);
   expect(hidden).toBeDefined();const caret=caretRect(placed,hidden.start);expect(caret.y+caret.height).toBeLessThanOrEqual(hidden.cellClip.bottom+1e-6);
  }else expect(box.height).toBeGreaterThan(170*4/3-1);
 }
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 const parts=unzipSync(source);expect(unzipSync(await save())).toEqual(parts);doc.select(0);doc.replace('Edited ');const edited=await save();
 expectBodyEditParts(unzipSync(edited),parts);
 expect((await DocxPackage.open(edited)).tables.length).toBe(pkg.tables.length);doc.undo();expect(unzipSync(await save())).toEqual(parts);
},60000);
