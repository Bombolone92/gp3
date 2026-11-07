import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';

it.each([['',true],['0',false],['false',false],['1',true],['true',true]])('imports worksheet heading visibility %s independently of gridlines and print headings',async(value,expected)=>{
 const bytes=otherProgramsXlsx({sheetXml:{Data:{head:`<sheetViews><sheetView workbookViewId="0" showGridLines="0" ${value?`showRowColHeaders="${value}"`:''}/></sheetViews>`,tail:'<printOptions headings="1"/>'}}});
 const wb=await workbookFromFile(bytes,'headings.xlsx');
 expect(wb.activeSheet.headers).toBe(expected);expect(wb.activeSheet.gridlines).toBe(false);expect(wb.activeSheet.printSettings.headings).toBe(true);
 const data=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),zip=X.CFB.read(data,{type:'array'});
 const xml=new TextDecoder().decode(X.CFB.find(zip,'/xl/worksheets/sheet1.xml').content);expect(xml).toContain(`showRowColHeaders="${expected?1:0}"`);
 const part=X.CFB.find(zip,'/xl/workbook.xml');part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
 const native=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'native.xlsx');expect(native.activeSheet.headers).toBe(expected);
});
it('uses the first native view, including when it overrides stale app metadata',async()=>{
 const wb=new Workbook();wb.setHeaders(wb.activeSheetId,false);
 const zip=X.CFB.read(new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer()),{type:'array'}),part=X.CFB.find(zip,'/xl/worksheets/sheet1.xml');
 part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace('showRowColHeaders="0"','showRowColHeaders="1"').replace('</sheetViews>','<sheetView workbookViewId="1" showRowColHeaders="0"/></sheetViews>'));part.size=part.content.length;
 expect((await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'edited.xlsx')).activeSheet.headers).toBe(true);
});
it('saves, duplicates and undoes headings per sheet without changing print settings',()=>{
 const wb=new Workbook(),id=wb.activeSheetId;wb.setHeaders(id,false);expect(wb.undoLabel()).toBe('Row and column headers');
 wb.undo();expect(wb.activeSheet.headers).toBe(true);wb.redo();expect(wb.activeSheet.headers).toBe(false);
 expect(new Workbook(wb.toJSON()).activeSheet.headers).toBe(false);
 wb.insertRows(id,0,1);wb.undo();expect(wb.activeSheet.headers).toBe(false);
 wb.duplicateSheet(id);expect(wb.sheets.every(s=>s.headers===false)).toBe(true);
 wb.setHeaders(wb.sheets[1].id,true);expect(wb.sheet(id).headers).toBe(false);
});
