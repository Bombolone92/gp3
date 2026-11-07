import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {fixedColumnWidths,rowGrid,spanWidth} from '../src/engine/tables.js';
const folder='tests/fixtures/fixed-table-reduction/';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for(const [stem,native] of [['source','native'],['margins','margins-native']]){
 const source=readFileSync(folder+stem+'.docx');
 const ref=JSON.parse(readFileSync(folder+native+'-reference.json','utf8').replace(/^\uFEFF/,''));
 it(`binds ${stem} margin controls to the native measurements`,()=>{
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  expect(hash(source)).toBe(ref.sourceSha256);expect(hash(readFileSync(folder+native+'.pdf'))).toBe(ref.pdfSha256);
 });
 for(let index=0;index<ref.tables.length;index++)it(`matches the native reference margin allocation: ${ref.tables[index].name}`,async()=>{
  const p=await DocxPackage.open(source),table=p.tables[index],before=structuredClone(table);
  const widths=fixedColumnWidths(table,10800);
  const cells=table.rows.flatMap(row=>rowGrid(row).map(({column,span})=>spanWidth(widths,column,span)/20));
  expect(cells).toHaveLength(ref.tables[index].cells.length);
  cells.forEach((w,i)=>expect(Math.abs(w-ref.tables[index].cells[i].widthPt)).toBeLessThan(.1));
  expect(table).toEqual(before);
 });
}
