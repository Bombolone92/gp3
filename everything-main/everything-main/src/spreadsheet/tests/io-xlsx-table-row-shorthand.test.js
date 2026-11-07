import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { parseRange } from '../src/core/cell.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

async function fixture() {
 const wb = new Workbook(), id = wb.activeSheetId;
 [['Quantity','Price','Total'], ['3','4.5','=[@Quantity]*[@Price]'], ['6','1.25','=[@Quantity]*[@Price]']]
  .forEach((row,r) => row.forEach((v,c) => wb.setInput(id,r,c,v)));
 wb.addTable(id, parseRange('A1:C3'), { name: 'Sales' });
 const zip = XLSX.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type:'buffer' });
 const sheet = XLSX.CFB.find(zip, '/xl/worksheets/sheet1.xml');
 const xml = new TextDecoder().decode(sheet.content);
 const write = (node,text) => { node.content = new TextEncoder().encode(text); node.size = node.content.length; };
 const reopen = () => workbookFromFile(new Uint8Array(XLSX.CFB.write(zip, { type:'buffer', fileType:'zip' })), 'table.xlsx');
 return { wb, zip, sheet, xml, write, reopen };
}
it('writes native #This Row references and restores the app spelling on its own round trip', async () => {
 const { xml, reopen } = await fixture();
 expect(xml).toContain('<f>[[#This Row],[Quantity]]*[[#This Row],[Price]]</f>');
 expect(xml).not.toContain('<f>[@');
 const back = await reopen();
 expect(back.getCell(back.activeSheetId,1,2).f).toBe('[@Quantity]*[@Price]');
 expect(back.getValue(back.activeSheetId,1,2)).toBe(13.5);
});
it('calculates native formulas without private metadata', async () => {
 const { zip, write, reopen } = await fixture();
 const book = XLSX.CFB.find(zip, '/xl/workbook.xml');
 write(book,new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));
 const back = await reopen();
 // Without the app's metadata the file's #This Row spelling still reads back in its written form.
 expect(back.getCell(back.activeSheetId,1,2).f).toBe('[@Quantity]*[@Price]');
 expect([1,2].map(r => back.getValue(back.activeSheetId,r,2))).toEqual([13.5,7.5]);
});
it('keeps a changed native formula authoritative over the app spelling in stale metadata', async () => {
 const { sheet,xml,write,reopen } = await fixture();
 write(sheet,xml.replace('<f>[[#This Row],[Quantity]]*[[#This Row],[Price]]</f>','<f>Sales[[#This Row],[Quantity]]*2</f>'));
 const back = await reopen();
 expect(back.getCell(back.activeSheetId,1,2).f).toBe('Sales[@Quantity]*2');
 expect(back.getValue(back.activeSheetId,1,2)).toBe(6);
});
