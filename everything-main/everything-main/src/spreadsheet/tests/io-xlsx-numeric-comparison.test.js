import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'numeric-comparisons.xlsx');
}

it('retains stored precision, live equality and exact lookups through native-only XLSX and internal copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  const input = [1, 1 + 20 * 2 ** -52, 1 + 23 * 2 ** -52];
  wb.setCells(id,input.map((v,r)=>({r,c:0,cell:{v}})));
  const formulas = ['A1=A2','A2=A3','MATCH(A2,A1:A3,0)','XMATCH(A3,A1:A3,0)', 'COUNTIF(A1:A3,A1)', 'RANK.EQ(A2,A1:A3,1)'];
  wb.setCells(id,formulas.map((f,r)=>({r,c:2,cell:{f}})));
  wb.addRule(id,{type:'formula',range:{r1:0,c1:0,r2:2,c2:0},value:'A1=$A$1',style:{bg:'#b6e6ad'}});
  const check=(offset=0)=>{
    expect(input.map((_,r)=>wb.getValue(id,r+offset,0))).toEqual(input);
    expect(formulas.map((_,r)=>wb.getValue(id,r+offset,2))).toEqual([true,false,2,3,2,2]);
    if (offset === 0) expect(input.map((_,r)=>!!wb.conditionalStyle(id,r,0)?.bg)).toEqual([true,true,false]);
  };
  check();
  for(let pass=0;pass<2;pass++){wb=await external(wb);id=wb.activeSheetId;check();}
  wb.setInput(id,1,0,'2');expect(wb.getValue(id,0,2)).toBe(false);wb.undo();check();
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:5,c2:2}),10,0,{r:0,c:0});
  expect(wb.getCell(id,12,2).f).toBe('MATCH(A12,A11:A13,0)');
  check(10);
  wb=await external(wb);id=wb.activeSheetId;check();check(10);
});
