import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {documentBlocks} from '../src/engine/tables.js';
import {tableRowBorderWidths} from '../src/engine/table-border-layout.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom,pkg;
beforeAll(async()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;pkg=await DocxPackage.open(readFileSync('tests/fixtures/merged-border-ownership/controls.docx'));});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('reserves hidden physical borders at their own row boundaries',()=>{
 const blocks=documentBlocks(pkg.paragraphs,pkg.tables).filter(b=>b.type==='table');
 const expected=[[0,0,0,0],[0,6,0,0],[0,0,6,0],[0,0,0,6],[0,6,0,8/3],[0,6,0,0],[0,8,0,0],[0,4,4,0],[0,0,0,4],[0,4,4,0]];
 for(const [i,b]of blocks.entries())expect(tableRowBorderWidths(b),String(i)).toEqual(expected[i]);
});
it('paints the final continuation border rather than the restart border',()=>{
 const measure=(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:0});
 const result=layoutDocument(pkg.paragraphs,measure,pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 for(const [i,t]of pkg.tables.entries()){
  const ink=result.tableBorders.filter(b=>b.tableId===t.id&&!b.guide);
  expect(ink.some(b=>b.border.color==='D02020'||b.border.color==='208040'),String(i)).toBe(false);
  if([3,4].includes(i))expect(ink.some(b=>b.border.color==='2060D0')).toBe(true);
 }
});
