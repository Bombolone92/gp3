import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'trimrange.xlsx');
}

it('preserves empty-text boundaries through native-only saves, formula edits, undo and copies', async () => {
  let wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id,1,1,'=""');wb.setInput(id,2,2,'1');wb.setInput(id,3,3,'=""');
  const formulas=['ROWS(TRIMRANGE(A1:E5))','COLUMNS(TRIMRANGE(A1:E5))','COUNTA(TRIMRANGE(A1:E5))','SUMPRODUCT(--ISTEXT(TRIMRANGE(A1:E5)))'];
  wb.setCells(id,formulas.map((f,r)=>({r,c:6,cell:{f}})));
  const read=(offset=0)=>formulas.map((_,r)=>wb.getValue(id,r+offset,6));
  expect(read()).toEqual([3,3,3,2]);
  for(let pass=0;pass<2;pass++){wb=await external(wb);id=wb.activeSheetId;expect(read()).toEqual([3,3,3,2]);}
  wb.setInput(id,1,1,'');expect(read()).toEqual([2,2,2,1]);wb.undo();expect(read()).toEqual([3,3,3,2]);
  wb.pasteCells(id,wb.copyRange(id,{r1:0,c1:0,r2:4,c2:6}),10,0,{r:0,c:0});
  expect(wb.getCell(id,10,6).f).toBe('ROWS(TRIMRANGE(A11:E15))');
  wb=await external(wb);id=wb.activeSheetId;
  expect(read()).toEqual([3,3,3,2]);expect(read(10)).toEqual([3,3,3,2]);
});
