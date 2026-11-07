import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {fixedColumnWidths} from '../src/engine/tables.js';
const source=readFileSync('public/fixtures/fixed-table-preference.docx');
const reference=JSON.parse(readFileSync('tests/fixtures/fixed-table-preference/reference.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const measure=text=>({width:text.length*6,ascent:12,descent:4});
function render(p){return layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);}
it('matches the native reference fixed preference expansion, reduction, spans and omitted columns without changing declarations',async()=>{
 const p=await DocxPackage.open(source),before=structuredClone(p.tables),layout=render(p);
 expect(layout.pageCount).toBe(1);expect(layout.cells).toHaveLength(reference.cells.length);
 layout.cells.forEach((cell,i)=>{const ref=reference.cells[i];expect(Math.abs(cell.x*.75-ref.left),`cell ${i} left`).toBeLessThan(.2);expect(Math.abs(cell.width*.75-ref.width),`cell ${i} width`).toBeLessThan(.2);});
 expect(p.tables).toEqual(before);expect(fixedColumnWidths(p.tables[0],8640)).toEqual([1440,2880]);
 expect(fixedColumnWidths(p.tables[2],8640)).toEqual([1000,2000]);
 expect(fixedColumnWidths(p.tables[5],8640)).toEqual([1800*4320/3800,2000*4320/3800]);
 expect(fixedColumnWidths(p.tables[7],8640)).toEqual([600,1440,2880]);
 const reducedWithGap=fixedColumnWidths(p.tables[13],8640);
 expect(reducedWithGap[0]).toBe(600);
 expect(reducedWithGap[1]+reducedWithGap[2]).toBeCloseTo(2400,8);
});
it('preserves mismatched width preferences through edits, export, reopen and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(p.parts);d.select(0);d.replace('Edit ');
 const bytes=await save(),parts=unzipSync(bytes),reopened=await DocxPackage.open(bytes);
 for(const name of Object.keys(p.parts))if(name!=='word/document.xml')expect(parts[name],name).toEqual(p.parts[name]);
 expect(reopened.tables.map(t=>fixedColumnWidths(t,8640))).toEqual(p.tables.map(t=>fixedColumnWidths(t,8640)));
 d.undo();expect(unzipSync(await save())).toEqual(p.parts);
});
it('retains automatic merged boundaries and resolves enclosing fixed spans after inner spans',async()=>{
 const source=readFileSync('tests/fixtures/mixed-cell-width-preferences/control.docx'),p=await DocxPackage.open(source),before=structuredClone(p.tables);
 const ref=JSON.parse(readFileSync('tests/fixtures/mixed-cell-width-preferences/reference.json'));
 for(const [i,t]of p.tables.entries())if(t.layout==='fixed'){
  const widths=fixedColumnWidths(t,9360);
  for(const [j,width]of widths.entries())expect(Math.abs(width/20-ref.pages[i][j].width),`case ${i+1} column ${j+1}`).toBeLessThan(.2);
 }
 expect(p.tables).toEqual(before);
 const automatic=structuredClone(p.tables[10]);
 for(const row of automatic.rows)for(const cell of row.cells)if(cell.width?.type==='auto')delete cell.width;
 expect(fixedColumnWidths(automatic,9360)).toEqual([2400,2400,1200]);
});
