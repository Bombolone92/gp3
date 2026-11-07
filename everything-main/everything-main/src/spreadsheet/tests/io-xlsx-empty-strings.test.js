import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it('retains explicitly stored empty strings separately from absent and styled blank cells', async () => {
  const rows = '<row r="1"><c r="A1" t="inlineStr"><is><t></t></is></c><c r="B1" t="str"><v></v></c><c r="D1" s="0"/>'
    + '<c r="E1"><f>ISBLANK(A1)</f><v>0</v></c><c r="F1"><f>ISTEXT(A1)</f><v>1</v></c>'
    + '<c r="G1"><f>COUNTA(A1:D1)</f><v>2</v></c><c r="H1"><f>TEXT(A1,"""prefix""@")</f><v>0</v></c></row>';
  let wb = await workbookFromFile(otherProgramsXlsx({sheetXml:{Data:{rows}}}), 'empty-strings.xlsx');
  wb.setNote(wb.activeSheetId, 0, 8, 'Note on a blank cell');
  wb.setInput(wb.activeSheetId, 0, 9, '=ISBLANK(I1)');
  for(let round=0;round<2;round++) {
    const id=wb.activeSheetId;
    expect(wb.getValue(id,0,0)).toBe('');expect(wb.getValue(id,0,1)).toBe('');
    expect(wb.getValue(id,0,2)).toBe(null);expect(wb.getValue(id,0,3)).toBe(null);
    expect(wb.getValue(id,0,4)).toBe(false);expect(wb.getValue(id,0,5)).toBe(true);
    expect(wb.getValue(id,0,6)).toBe(2);
    expect(wb.getValue(id,0,7)).toBe("prefix");
    expect(wb.getValue(id,0,8)).toBe(null);
    expect(wb.getValue(id,0,9)).toBe(true);
    expect(wb.getNote(id,0,8)).toBe("Note on a blank cell");
    const bytes=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer());
    const zip=X.CFB.read(bytes,{type:'array'}),part=X.CFB.find(zip,'/xl/workbook.xml');
    part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
    wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'external-empty.xlsx');
  }
});


it('retains a valid empty shared string', async () => {
  const source = X.utils.book_new();
  X.utils.book_append_sheet(source, X.utils.aoa_to_sheet([['', 42]]), 'Data');
  const wb = await workbookFromFile(X.write(source, { type: 'array', bookType: 'xlsx', bookSST: true }), 'shared.xlsx');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('');
  expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(42);
});
