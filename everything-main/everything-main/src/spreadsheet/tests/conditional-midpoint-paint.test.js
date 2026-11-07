// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {Workbook} from '../src/core/workbook.js';
import {buildPrintTable} from '../src/ui/print.js';
import {cellsToHtml,parseHtmlClipboard,cellsFromHtmlRows} from '../src/core/clipboard.js';
it('prints and copies every color of an overflowing three-color range',()=>{
 const wb=new Workbook(),id=wb.activeSheetId,values=[-1e308,-5e307,0,5e307,1e308],expected=['#000000','#7f0000','#ff0000','#ff7f7f','#ffffff'];
 values.forEach((v,r)=>wb.setInput(id,r,0,String(v)));
 wb.addRule(id,{type:'scale',range:{r1:0,c1:0,r2:4,c2:0},from:'#000000',mid:'#ff0000',to:'#ffffff'});
 const print=buildPrintTable(wb,id),rows=print.querySelectorAll('tbody tr');
 values.forEach((value,r)=>{
  const style=wb.conditionalStyle(id,r,0,value),expectedCell=document.createElement('td');expectedCell.style.backgroundColor=expected[r];
  expect(rows[r].querySelector('td').style.backgroundColor).toBe(expectedCell.style.backgroundColor);
  const html=cellsToHtml([[String(value)]],wb.copyRange(id,{r1:r,c1:0,r2:r,c2:0}),[[style]],[[value]]);
  const foreign=parseHtmlClipboard(html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g,''));
  const cell=cellsFromHtmlRows(foreign.rows)[0].cell;
  expect(cell.v).toBe(value);expect(cell.s.bg || '#ffffff').toBe(expected[r]);
 });
});
