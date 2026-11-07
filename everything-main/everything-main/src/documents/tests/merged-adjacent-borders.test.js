import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {documentBlocks} from '../src/engine/tables.js';
import {tableRowBorderWidths} from '../src/engine/table-border-layout.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('keeps adjacent-column borders out of a padded merged cell contribution',async()=>{
 const p=await DocxPackage.open(readFileSync('tests/fixtures/merged-adjacent-borders/control.docx'));
 const blocks=documentBlocks(p.paragraphs,p.tables).filter(b=>b.type==='table'),b=blocks[10],bottoms=new Map();
 expect(tableRowBorderWidths(b,new Map(),undefined,bottoms)).toEqual([0,2,0,0]);
 expect(bottoms.get(b.rows[0].cells[0].id).width).toBe(0);
 expect(bottoms.get(b.rows[0].cells[1].id).width).toBe(0);
 expect(bottoms.get(b.rows[0].cells[2].id).width).toBe(2);
});
it('includes a stronger opposing top border in the preceding cell bottom extent',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/row-border-opposition.docx'));
 const blocks=documentBlocks(p.paragraphs,p.tables).filter(b=>b.type==='table');
 for(const b of blocks){const bottom=new Map(),widths=tableRowBorderWidths(b,new Map(),undefined,bottom);expect(bottom.get(b.rows[0].cells[0].id).width).toBe(widths[1]);}
});
