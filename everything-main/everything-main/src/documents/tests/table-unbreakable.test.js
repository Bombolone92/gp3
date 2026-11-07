import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {autoColumnWidths} from '../src/engine/tables.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const table={layout:'autofit',grid:[5760],width:{type:'dxa',value:5760},rows:[{cells:[{column:0,span:1,width:{type:'dxa',value:5760}}]}]};
it('keeps the width limit when an indivisible object or glyph overflows',()=>{
 expect(autoColumnWidths(table,5990,[{min:10310,max:10310,floor:10310,paddingFloor:250}])).toEqual([5990]);
});
it('still rejects margins that leave no writing area',()=>{
 expect(()=>autoColumnWidths(table,5990,[{min:10310,max:10310,floor:10310,paddingFloor:6000}])).toThrow(/cannot fit/);
});
it('enforces merged-cell margin floors when content overflows',()=>{
 const merged={...table,grid:[2880,2880],rows:[{cells:[{column:0,span:2,width:{type:'dxa',value:5760}}]}]};
 const widths=autoColumnWidths(merged,6000,[{min:0,max:0,floor:0,paddingFloor:0},{min:0,max:0,floor:0,paddingFloor:0}],6000,[{column:0,span:2,min:10000,max:10000,floor:10000,paddingFloor:300}]);
 expect(widths.reduce((a,b)=>a+b)).toBeCloseTo(6000);expect(widths.every(w=>w>0)).toBe(true);
});
it.each([false,true])('uses compatibility mode to retain or clip an indivisible chart (modern=%s)',async modern=>{
 const pkg=await DocxPackage.open(readFileSync(`public/fixtures/table-unbreakable-${modern?'modern-':''}chart.docx`));
 const layout=layoutDocument(pkg.paragraphs,(text,s)=>({width:text.length*s.fontSize*.6,ascent:s.fontSize,descent:s.fontSize*.25}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
 const cell=layout.cells[0],line=layout.lines.find(l=>l.fragments.some(f=>f.image));
 expect(cell.width*.75).toBeCloseTo(modern?515.5:299.5,4);
 expect(line.fragments.find(f=>f.image).width*.75).toBeCloseTo(504,4);
 if(modern)expect(line.cellClip).toBeUndefined();else expect(line.cellClip.right).toBeCloseTo(cell.x+cell.width,4);
});
