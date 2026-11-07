import { expect, it } from 'vitest';
import { scaleColor, scaleMidpoint } from '../src/core/condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readXlsxConditionalFormats } from '../src/core/xlsx-condformat.js';
import * as X from '../src/vendor/xlsx.mjs';
const colors={from:'#000000',mid:'#ff0000',to:'#ffffff'};
const values=[-1e308,-5e307,0,5e307,1e308],expected=['#000000','#7f0000','#ff0000','#ff7f7f','#ffffff'];
const look=(wb,r,c=0)=>wb.conditionalStyle(wb.activeSheetId,r,c,wb.getValue(wb.activeSheetId,r,c))?.bg;
function setup(extra={}){
 const wb=new Workbook(),id=wb.activeSheetId;
 values.forEach((v,r)=>wb.setInput(id,r,0,String(v)));
 wb.addRule(id,{type:'scale',range:{r1:0,c1:0,r2:4,c2:0},...colors,...extra});return wb;
}
it.each([
 [-1e308,1e308,0],[-1.5e308,1e308,-2.5e307],[-1e308,1.5e308,2.5e307],
 [-Number.MAX_VALUE,Number.MAX_VALUE,0],[1e308,1.5e308,1.25e308],[-1.5e308,-1e308,-1.25e308],
 [Number.MIN_VALUE,Number.MIN_VALUE,Number.MIN_VALUE],[-Number.MIN_VALUE,Number.MIN_VALUE,0],
 [2,8,5],[8,2,5],[-8,-2,-5],
])('keeps the midpoint finite for %s and %s', (lo,hi,mid)=>{
 expect(scaleMidpoint(lo,hi)).toBe(mid);
 expect(scaleColor(colors,mid,lo,hi)).toBe(lo===hi?'#ffffff':'#ff0000');
});
it('retains ordinary interpolation rounding and explicit midpoint semantics',()=>{
 for(const [lo,hi] of [[0,1],[.1,.7],[-10,25],[1e307,1.7e308],[-1.7e308,-1e307]])expect(scaleMidpoint(lo,hi)).toBe(lo+(hi-lo)/2);
 expect(values.map(v=>scaleColor(colors,v,values[0],values[4]))).toEqual(expected);
 expect(values.map(v=>scaleColor(colors,v,values[0],values[4],[-1e308,0,1e308]))).toEqual(expected);
 expect(scaleColor(colors,0,-1,1,[{error:'#NUM!'},0,1])).toBeNull();
 // A two-color range also collapses at this overflowing span;
 // this midpoint fix does not change that separately investigated behavior.
 expect(scaleColor({from:'#000000',to:'#ffffff'},0,-1e308,1e308)).toBe('#000000');
});
it.each([{}, {scaleMin:'$A$1',scaleMax:'$A$5'}])('evaluates automatic midpoints through edits, copy and undo (%j)', extra=>{
 const wb=setup(extra),id=wb.activeSheetId;
 expect(values.map((_,r)=>look(wb,r))).toEqual(expected);
 const rows=[0,1,2,3,4];wb.pasteCells(id,wb.copyCells(id,rows,[0]),0,2,{r:0,c:0},null,{conditionalFormats:wb.copyConditionalFormats(id,rows,[0])});
 expect(values.map((_,r)=>look(wb,r,2))).toEqual(expected);
 wb.setInput(id,4,2,'5e307');expect(look(wb,4,2)).toBe(extra.scaleMax?'#ff7f7f':'#ffffff');
 wb.undo();expect(values.map((_,r)=>look(wb,r,2))).toEqual(expected);wb.undo();expect(wb.activeSheet.rules).toHaveLength(1);
});
it.each([false,true])('exports a stable live midpoint and reopens without changing colors (private=%s)',async privateData=>{
 const original=setup();let wb=original;
 for(let pass=0;pass<2;pass++){
  const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'}),part=X.CFB.find(zip,'/xl/worksheets/sheet1.xml');
  const xml=new TextDecoder().decode(part.content);
  expect(xml).toContain('IFERROR(');expect(xml).not.toMatch(/NaN|Infinity/);
  if(!privateData){const book=X.CFB.find(zip,'/xl/workbook.xml');book.content=new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));book.size=book.content.length;}
  wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'midpoints.xlsx');
  expect(values.map((_,r)=>look(wb,r))).toEqual(expected);
 }
 wb.setInput(wb.activeSheetId,4,0,'5e307');expect(look(wb,4)).toBe('#ffffff');
 expect(values.map((_,r)=>look(original,r))).toEqual(expected);
});
it('keeps explicitly imported percentage thresholds distinct from automatic midpoints',async()=>{
 const wb=setup();wb.activeSheet.rules=[];
 for(const rule of readXlsxConditionalFormats('<conditionalFormatting sqref="A1:A5"><cfRule type="colorScale" priority="1"><colorScale><cfvo type="min"/><cfvo type="percent" val="50"/><cfvo type="max"/><color rgb="FF000000"/><color rgb="FFFF0000"/><color rgb="FFFFFFFF"/></colorScale></cfRule></conditionalFormatting>',{dxfs:[]}))wb.addRule(wb.activeSheetId,rule);
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 expect(new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content)).toContain('<cfvo type="percent" val="50"/>');
});
it.each([[[0,25,50,75,100]],[[-1e307,0,1e307]],[[]]])('keeps native automatic copy semantics when the current span is finite (%j)',async values=>{
 const wb=new Workbook(),id=wb.activeSheetId;
 values.forEach((v,r)=>wb.setInput(id,r,0,String(v)));
 wb.addRule(id,{type:'scale',range:{r1:0,c1:0,r2:Math.max(0,values.length-1),c2:0},...colors});
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'});
 const xml=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);
 expect(xml).toContain('<cfvo type="percent" val="50"/>');expect(xml).not.toContain('IFERROR(');
});
