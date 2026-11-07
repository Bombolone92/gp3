import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { xlsxScalarFormula } from '../src/core/xlsx-scalar-formula.js';
function fixture(){
 const sheet={'!ref':'A1:H12',A2:{t:'n',v:5},B2:{t:'n',v:-8},C2:{t:'n',v:13},A5:{t:'n',v:21},A6:{t:'n',v:34}};
 for(const[a,f,flags]of[
 ['B4','IF(A2:C2<0,A2:C2,NA())',{}],
 ['B5','A5:A6+SUM(A2:C2)',{}],
 ['C4','ABS(A2:C2)',{}],
 ['D4','A2:C2+1',{}],
 ['B8','SUMPRODUCT(A2:C2*2)',{}],
 ['E8','IF(A2:C2<0,A2:C2,0)',{F:'E8:G8'}],
 ['E10','A2:C2+1',{F:'E10:G10',D:true}],
 ])sheet[a]={t:'n',v:0,f,...flags};
 const b=X.utils.book_new();X.utils.book_append_sheet(b,sheet,'Data');return X.write(b,{type:'array',bookType:'xlsx'});
}
it('intersects scalar operands by caller row/column while retaining explicit arrays',async()=>{
 const w=await workbookFromFile(fixture(),'legacy.xlsx'),id=w.activeSheetId;
 expect(w.getValue(id,3,1)).toBe(-8);
 expect(w.getValue(id,4,1)).toBe(31);
 expect(w.getValue(id,3,2)).toBe(13);
 expect(w.getValue(id,3,3)).toEqual({error:'#VALUE!'});
 expect(w.getValue(id,7,1)).toBe(20);
 expect([4,5,6].map(c=>w.getValue(id,7,c))).toEqual([0,-8,0]);
 expect([4,5,6].map(c=>w.getValue(id,9,c))).toEqual([6,-7,14]);
 const base=w.toJSON();w.pasteCells(id,w.copyRange(id,{r1:3,c1:1,r2:3,c2:1}),4,1,{r:3,c:1});
 w.undo();expect(w.toJSON()).toEqual(base);
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(w)).arrayBuffer()),{type:'array'}),p=X.CFB.find(zip,'/xl/workbook.xml');
 p.content=new TextEncoder().encode(new TextDecoder().decode(p.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));p.size=p.content.length;
 const r=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'external.xlsx');
 expect(r.getValue(r.activeSheetId,3,1)).toBe(-8);
 r.setInput(r.activeSheetId,1,1,-19);expect(r.getValue(r.activeSheetId,3,1)).toBe(-19);
});
it('preserves array consumers, explicit intersections and scalar-only text',()=>{
 for(const f of ['SUMPRODUCT(A1:A4*B1:B4)','SUM(A1:A4)','@A1:A4','A1+3','IF(A1,2,3)','SUM(A:A)+A1#','TaxRate*B2','SUM(Sales[Q1])+Sales[@Q1]+A2'])expect(xlsxScalarFormula(f)).toBe(f);
 expect(xlsxScalarFormula('IF(B1,A1:A4,C1:C4)')).toBe('IF(B1,@A1:A4,@C1:C4)');
});
