import { afterEach, beforeEach, expect, it } from 'vitest';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { installMockPuter } from './helpers/mock-puter.js';
let mock, doc;
beforeEach(() => { mock = installMockPuter(); });
afterEach(() => { doc?.destroy();doc=null;delete globalThis.puter; });
it('keeps external sources stable after opening, editing, Save As, undo and another save', async () => {
  const wb = new Workbook({externalWorkbooks:{version:1,books:[{target:'../Data/Source%20A.xlsx',sheets:[{name:'Data',cells:{'0,0':7}}]}]},sheets:[{name:'Report',cells:{'0,0':{f:'[1]Data!A1'}}}]});
  const path = '/drive/Reports/Report.xlsx', blob = await workbookToXlsx(wb);
  mock.fs.set(path,{blob,size:blob.size,modified:Date.now()/1000});
  doc = await Doc.fromPath(path);
  expect(doc.wb.externalWorkbooks.books[0].target).toBe('/drive/Data/Source%20A.xlsx');
  const id = doc.wb.activeSheetId;
  doc.wb.setInput(id,1,0,'edit');
  expect(await doc.saveAs('Copy')).toBeNull();
  const copy = await workbookFromFile(mock.fs.get('Spreadsheets/Copy.xlsx').blob);
  expect(copy.externalWorkbooks.books[0].target).toBe('/drive/Data/Source%20A.xlsx');
  expect(copy.getValue(copy.activeSheetId,0,0)).toBe(7);
  doc.wb.undo();
  expect(doc.wb.externalWorkbooks.books[0].target).toBe('/drive/Data/Source%20A.xlsx');
  expect(await doc.save()).toBe(true);
  const again = await workbookFromFile(mock.fs.get('Spreadsheets/Copy.xlsx').blob);
  expect(again.externalWorkbooks.books[0].target).toBe('/drive/Data/Source%20A.xlsx');
  const original = await workbookFromFile(mock.fs.get(path).blob);
  expect(original.externalWorkbooks.books[0].target).toBe('../Data/Source%20A.xlsx');
});
it.each(['sparkline','external name'])('checks outside-content formulas in %s metadata before enabling providers',async kind=>{
  const expression='IF(IMPORTDATA("https://example.com/data.csv"),A1:A2,A1:A2)';
  const json={sheets:[{name:'Report',cells:{'0,0':{v:1},'1,0':{v:2}}}]};
  if(kind==='sparkline')json.sheets[0].sparklineGroups=[{type:'line',sparklines:[{ref:'C1',formula:expression}]}];
  else {
    json.externalWorkbooks={version:1,books:[{target:'https://example.com/source.xlsx',sheets:[{name:'Data',cells:{'0,0':1}}],names:[{name:'Network',ref:'IF(IMPORTDATA("https://example.com/data.csv"),Data!A1,Data!A1)'}]}]};
    json.sheets[0].cells['0,2']={f:'[1]Data!Network'};
  }
  const blob=await workbookToXlsx(new Workbook(json)),path=`Spreadsheets/${kind}.xlsx`;
  mock.fs.set(path,{blob,size:blob.size,modified:Date.now()/1000});
  doc=await Doc.fromPath(path);expect(doc.wb.externalAllowed).toBe(false);
  const calls=[];doc.wb.setAsyncProvider('IMPORTDATA',async url=>{calls.push(url);return [[1]];});
  if(kind==='sparkline') {
    const {nativeSparklineData}=await import('../src/core/native-sparkline-data.js');
    expect(nativeSparklineData(doc.wb,doc.wb.activeSheetId,0,2).unavailable).toBe(true);
  } else expect(doc.wb.getValue(doc.wb.activeSheetId,0,2)).toEqual({error:'#BLOCKED!'});
  expect(calls).toEqual([]);
});
