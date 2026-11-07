import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

it('preserves hidden global and local names through native and app round trips, edits, undo and copies', async () => {
 const source={ SheetNames:['Data'],Sheets:{Data:{A1:{t:'n',v:7},B1:{t:'n',f:'Private+Local',v:14},'!ref':'A1:B1'}},Workbook:{Names:[
  {Name:'Private',Ref:'Data!$A$1',Hidden:true},{Name:'Local',Ref:'7',Sheet:0,Hidden:true},{Name:'Visible',Ref:'Data!$A$1'},
 ]}};
 let wb=await workbookFromFile(X.write(source,{type:'array',bookType:'xlsx'}),'hidden.xlsx');
 for(let pass=0;pass<2;pass++){
  const id=wb.activeSheetId;
  expect(wb.getValue(id,0,1)).toBe(14);
  expect(wb.names.filter(n=>n.hidden).map(n=>n.name)).toEqual(['Private','Local']);
  expect(wb.nameForRange(id,{r1:0,c1:0,r2:0,c2:0})).toBe('Visible');
  wb.defineName('Private','Data!$A$1+1');expect(wb.namedEntry('Private').hidden).toBe(true);expect(wb.getValue(id,0,1)).toBe(15);
  wb.undo();expect(wb.getValue(id,0,1)).toBe(14);
  wb=new Workbook(wb.toJSON());
  const blob=await workbookToXlsx(wb),raw=X.read(await blob.arrayBuffer(),{type:'array'});
  expect(raw.Workbook.Names.filter(n=>n.Hidden).map(n=>n.Name)).toEqual(['Private','Local']);
  wb=await workbookFromFile(blob,'again.xlsx');
 }
 const target=new Workbook(),[sheet]=target.importSheets(wb);
 expect(target.names.filter(n=>n.hidden)).toHaveLength(2);
 expect(target.getValue(sheet.id,0,1)).toBe(14);
});
