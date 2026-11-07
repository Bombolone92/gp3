import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {fixedColumnWidths,rowGrid,spanWidth} from '../src/engine/tables.js';
const folder='tests/fixtures/fixed-table-reduction/';
const source=readFileSync(folder+'rows.docx');
const ref=JSON.parse(readFileSync(folder+'rows-native-reference.json','utf8').replace(/^\uFEFF/,''));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds the independent row controls to the native measurements',()=>{
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 expect(hash(source)).toBe(ref.sourceSha256);
 expect(hash(readFileSync(folder+'rows-native.pdf'))).toBe(ref.pdfSha256);
});
for(let index=0;index<3;index++)it(`matches native fixed-row reduction: ${ref.tables[index].name}`,async()=>{
 const p=await DocxPackage.open(source),table=p.tables[index],before=structuredClone(table);
 const widths=fixedColumnWidths(table,10800);
 const cells=table.rows.flatMap(row=>rowGrid(row).map(({column,span})=>spanWidth(widths,column,span)/20));
 expect(cells).toHaveLength(ref.tables[index].cells.length);
 cells.forEach((w,i)=>expect(Math.abs(w-ref.tables[index].cells[i].widthPt)).toBeLessThan(.2));
 expect(table).toEqual(before);
});
it('keeps merged-row order from changing the reduced grid',async()=>{
 const p=await DocxPackage.open(source);
 expect(fixedColumnWidths(p.tables[1],10800)).toEqual(fixedColumnWidths(p.tables[2],10800));
});
