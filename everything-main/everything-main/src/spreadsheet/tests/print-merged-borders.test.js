// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { buildPrintTable } from '../src/ui/print.js';
import { cellPrintBorders, copyMergedPrintBorders } from '../src/ui/print-borders.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import * as X from '../src/vendor/xlsx.mjs';

const merge={r1:1,c1:1,r2:3,c2:3};
const border=(side,bc,bs='thin')=>({[side]:true,[`${side}Border`]:{bc,bs}});
const rect={left:10,right:210,top:20,bottom:120};
const getEdges=td=>cellPrintBorders(td,rect).filter(e=>e.explicit);
const setup=(cells,extra={})=>new Workbook({sheets:[{cells,merges:[merge],colWidths:{1:40,2:100,3:60},rowHeights:{1:20,2:30,3:50},...extra}]});
const table=(wb,opts={})=>{const t=buildPrintTable(wb,wb.activeSheetId,{gridlines:false,range:merge,...opts});document.body.append(t);return t;};
afterEach(()=>document.body.replaceChildren());

it('prints a merged outline stored on covered perimeter cells even with an empty anchor',()=>{
 const wb=setup({'3,1':{s:border('bb','red')},'3,3':{s:border('bb','blue','double')},'2,3':{s:border('br','green','medium')}});
 const t=table(wb), edges=getEdges(t.querySelector('td'));
 expect(t.classList.contains('has-print-borders')).toBe(true);
 expect(edges).toEqual([
  {axis:'h',at:120,start:10,end:50,width:4/3,style:'solid',color:'red',explicit:true,order:0},
  {axis:'h',at:120,start:150,end:210,width:4,style:'double',color:'blue',explicit:true,order:0},
  {axis:'v',at:210,start:40,end:70,width:8/3,style:'solid',color:'green',explicit:true,order:0},
 ]);
});

it('does not stretch anchor rules over blank perimeter cells or paint internal sides',()=>{
 const t=table(setup({'1,1':{v:'Merged',s:{bt:true,bb:true,bl:true,br:true,bc:'red'}}}));
 expect(getEdges(t.querySelector('td')).map(e=>[e.axis,e.at,e.start,e.end])).toEqual([['h',20,10,50],['v',10,20,40]]);
});

it('retains all border segments when page fragmentation clones a merged cell',()=>{
 const t=table(setup({'3,1':{s:border('bb','red')},'3,3':{s:border('bb','blue')}}));
 const source=t.querySelector('td'), clone=source.cloneNode(true);
 copyMergedPrintBorders(source,clone); document.body.append(clone);
 expect(getEdges(clone)).toEqual(getEdges(source));
});

it('uses visible line lengths but omits the borders on hidden boundary lines',()=>{
 const wb=setup({'1,1':{v:'Hidden anchor',s:{bt:true,bl:true,bc:'red'}},'2,1':{s:border('bl','blue')},'3,1':{s:border('bl','green')},'3,3':{s:border('bb','black')}}, {hiddenRows:[1]});
 const td=table(wb).querySelector('td');
 expect(td.textContent).toBe('Hidden anchor');
 expect(getEdges(td).map(e=>[e.axis,e.at,e.start,e.end,e.color])).toEqual([
  ['h',120,150,210,'black'], ['v',10,20,57.5,'blue'], ['v',10,57.5,120,'green'],
 ]);
});

it('keeps a continuation\'s own bottom/right segments without inventing cut edges or repeating its value',()=>{
 const wb=setup({'1,1':{v:'Only once',s:{bt:true,bl:true}},'3,3':{s:{bb:true,br:true,bc:'red'}}});
 const t=table(wb,{range:{r1:2,c1:2,r2:3,c2:3}}),td=t.querySelector('td');
 expect(td.textContent).toBe('');
 expect(getEdges(td).map(e=>[e.axis,e.at,e.start,e.end])).toEqual([
  ['h',120,135,210], ['v',210,57.5,120],
 ]);
});

it('splits repeated headings without turning their cut into a merged border',()=>{
 const wb=setup({'1,1':{v:'Title',s:border('bt','red')},'3,3':{s:border('bb','blue')}});
 const t=table(wb,{repeatRows:2}),head=t.querySelector('thead td'),body=t.querySelector('tbody td');
 expect(head.textContent).toBe('Title');expect(body.textContent).toBe('');
 expect(getEdges(head).map(e=>[e.axis,e.at,e.color])).toEqual([['h',20,'red']]);
 expect(getEdges(body).map(e=>[e.axis,e.at,e.color])).toEqual([['h',120,'blue']]);
});

it('resolves line styles and conditional overrides at each covered perimeter cell',()=>{
 const wb=setup({}),id=wb.activeSheetId;
 wb.applyStyle(id,{r1:0,c1:1,r2:wb.sheets[0].rows-1,c2:1},{bl:true});
 wb.addRule(id,{range:{r1:3,c1:2,r2:3,c2:3},type:'empty',style:border('bb','#abcdef','dotted')});
 wb.addRule(id,{range:{r1:2,c1:1,r2:2,c2:1},type:'empty',style:{bl:false}});
 expect(getEdges(table(wb).querySelector('td')).map(e=>[e.axis,e.at,e.start,e.end,e.color])).toEqual([
  ['h',120,50,210,'#abcdef'],['v',10,20,40,'#000'],['v',10,70,120,'#000'],
 ]);
});

it('preserves perimeter cells through metadata-free XLSX, an edit, and another export',async()=>{
 let wb=setup({'1,1':{v:'Merged',s:border('bt','#ff0000')},'3,1':{s:border('bb','#0000ff','double')},'2,3':{s:border('br','#008000','medium')}});
 const expected=getEdges(table(wb).querySelector('td'));
 for(let i=0;i<2;i++){
  const blob=await workbookToXlsx(wb);
  const data=new Uint8Array(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);}));
  const zip=X.CFB.read(data,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'Merged.xlsx');
  wb.setInput(wb.activeSheetId,1,1,'Edited merged value');
  const before=JSON.stringify(wb.toJSON());
  expect(getEdges(table(wb).querySelector('td'))).toEqual(expected);
  expect(JSON.stringify(wb.toJSON())).toBe(before);
 }
});

it('keeps covered perimeter styles in the internal HTML clipboard payload',()=>{
 const wb=setup({'1,1':{v:'Merged'},'3,1':{s:border('bb','#ff0000')},'3,3':{s:border('bb','#0000ff','double')}});
 const id=wb.activeSheetId,rows=[1,2,3],cols=[1,2,3],cells=wb.copyRange(id,merge);
 const texts=rows.map(r=>cols.map(c=>wb.getDisplay(id,r,c)));
 const pasted=parseHtmlClipboard(cellsToHtml(texts,cells,null,null,null,{rows,cols,merges:[merge]}));
 expect(pasted.cells).toEqual(cells);
 expect(pasted.merges).toEqual([{r1:0,c1:0,r2:2,c2:2}]);
 expect(pasted.cells[2][0].s).toMatchObject(border('bb','#ff0000'));
 expect(pasted.cells[2][2].s).toMatchObject(border('bb','#0000ff','double'));
});

it('prints the full outline after a foreign HTML merged-cell paste',()=>{
 const pasted=parseHtmlClipboard('<table><tr><td rowspan="2" colspan="3" style="border:3px double #123456">Foreign merged cell</td></tr><tr></tr></table>');
 const cells=Object.fromEntries(pasted.rows.flatMap((row,r)=>row.map((cell,c)=>[`${r},${c}`,{v:cell.text,s:cell.style}])));
 const wb=new Workbook({sheets:[{cells,merges:pasted.merges}]});
 const t=table(wb,{range:pasted.merges[0]});
 expect(getEdges(t.querySelector('td')).map(e=>[e.axis,e.at,e.start,e.end,e.style])).toEqual([
  ['h',20,10,210,'double'],['h',120,10,210,'double'],['v',10,20,120,'double'],['v',210,20,120,'double'],
 ]);
});
