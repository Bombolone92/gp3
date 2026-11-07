import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it.each([
  ['0','1'], ['2','1'], ['1','16385'], ['1','999999999'], ['1','Infinity'],
  ['1','2junk'], ['1','2.5'], ['-1','3'], [undefined,'3'], ['1',undefined],
])('refuses invalid column bounds %s:%s before expanding the worksheet', async (min,max) => {
  const attrs = Object.entries({min,max}).filter(([,v])=>v!=null).map(([k,v])=>`${k}="${v}"`).join(' ');
  const bytes=otherProgramsXlsx({sheetXml:{Data:{head:`<cols><col ${attrs} width="20"/></cols>`,rows:'<row r="1"><c r="A1"><v>42</v></c></row>'}}});
  expect(()=>X.read(bytes,{type:'array',cellStyles:true,WTF:true})).toThrow('Invalid XLSX column range');
  await expect(workbookFromFile(bytes,'invalid.xlsx')).rejects.toThrow('Sheet "Data" could not be read');
});
it.each(['0','-1','1048577','999999999','2junk','2.5','Infinity'].flatMap(r=>[false,true].map(empty=>({r,empty}))))('refuses invalid row $r, empty=$empty, before creating sparse arrays',async({r,empty})=>{
  const row = empty ? `<row r="${r}" ht="15"/>` : `<row r="${r}" ht="15"><c><v>7</v></c></row>`;
  const bytes=otherProgramsXlsx({sheetXml:{Data:{rows:row}}});
  expect(()=>X.read(bytes,{type:'array',cellStyles:true,WTF:true})).toThrow('Invalid XLSX row index');
  await expect(workbookFromFile(bytes,'invalid.xlsx')).rejects.toThrow('Sheet "Data" could not be read');
});
it('accepts the full legal column span and the last legal row, including unsigned lexical forms',()=>{
  const bytes=otherProgramsXlsx({sheetXml:{Data:{head:'<cols><col min="+0001" max="16384" width="10"/></cols>',rows:'<row r="1048576" ht="15"><c r="XFD1048576"><v>9</v></c></row>'}}});
  const book=X.read(bytes,{type:'array',cellStyles:true,WTF:true}),s=book.Sheets.Data;
  expect(s['!cols']).toHaveLength(16384);expect(s['!rows']).toHaveLength(1048576);
  expect(s.XFD1048576.v).toBe(9);
});
it('rejects implicit row overflow while retaining valid implicit row indexes',()=>{
  const bytes=rows=>otherProgramsXlsx({sheetXml:{Data:{rows}}});
  expect(()=>X.read(bytes('<row r="1048576"><c><v>1</v></c></row><row><c><v>2</v></c></row>'),{type:'array',cellStyles:true,WTF:true})).toThrow('Invalid XLSX row index');
  const s=X.read(bytes('<row><c><v>1</v></c></row><row><c><v>2</v></c></row>'),{type:'array',cellStyles:true,WTF:true}).Sheets.Data;
  expect(s.A1.v).toBe(1);expect(s.A2.v).toBe(2);
});

it('reads column declarations only from cols, never DrawingML anchors or extension elements', async () => {
  const anchor = '<extLst><ext uri="example"><xdr:from xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from></ext></extLst>';
  const bytes = otherProgramsXlsx({ sheetXml: { Data: {
    head: '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><cols><col min="2" max="3" width="18"/></cols>' + anchor,
    rows: '<row r="3"><c r="B3"><v>12</v></c></row>', tail: anchor,
  } } });
  const book = X.read(bytes, { type: 'array', cellStyles: true, WTF: true });
  expect(book.Sheets.Data['!cols']).toHaveLength(3);
  expect(book.Sheets.Data.B3.v).toBe(12);
  const wb = await workbookFromFile(bytes, 'anchors.xlsx');
  expect(wb.activeSheet.gridlines).toBe(false); expect(wb.getValue(wb.activeSheetId, 2, 1)).toBe(12);
});
