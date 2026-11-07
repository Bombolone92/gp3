import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const refs=JSON.parse(readFileSync('tests/fixtures/nested-tables/nested-autofit-border-reference.json','utf8'));
for(const [mode,reference] of Object.entries(refs))it(`includes nested table exterior borders in parent AutoFit: ${mode}`,async()=>{
 const source=readFileSync(`tests/fixtures/nested-tables/nested-clipping-${mode}.docx`);expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
 const doc=await DocxPackage.open(source),before=JSON.stringify(doc.tables);
 const layout=layoutDocument(doc.paragraphs,(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize,descent:style.fontSize/3}),pageGeometry(doc.pageSettings),doc.numbering,doc.tables);
 let parent;
 for(const [color,expected] of Object.entries(reference.colors)){
  const ids=parent&&new Set(parent.rows.flatMap(r=>r.cells.map(c=>c.id)));
  const table=doc.tables.find(t=>parent?ids.has(t.parentCellId):!t.parentCellId);expect(table).toBeDefined();parent=table;
  const strokes=layout.tableBorders.filter(b=>b.tableId===table.id&&!b.guide);
  const actual={left:Math.min(...strokes.map(b=>b.x))*.75,right:Math.max(...strokes.map(b=>b.x+b.width))*.75};
  for(const edge of ['left','right'])expect(Math.abs(actual[edge]-expected[edge]),`${color} ${edge}: ${actual[edge]} vs ${expected[edge]}`).toBeLessThan(.65);
 }
 expect(JSON.stringify(doc.tables)).toBe(before);
});
