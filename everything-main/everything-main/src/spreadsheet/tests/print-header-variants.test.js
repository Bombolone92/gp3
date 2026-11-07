import { expect, it } from 'vitest';
import { readXlsxPrint } from '../src/core/xlsx-print.js';
import { writeXlsxPrint } from '../src/core/xlsx-export-print.js';
import { normalizePrintSettings } from '../src/core/print-settings.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { printPageText, sheetPrintPrefs, printSettingsFromPrefs } from '../src/ui/print.js';

const variants = { differentFirst:true, differentOddEven:true,
  scaleWithDoc:false, header:'&L&"Arial,Bold Italic"&14&K04+025Odd &A', footer:'&C&UP &P', evenHeader:'&REven &F',
  evenFooter:'&LEven &N', firstHeader:'&CFirst && title', firstFooter:'' };

it('gives first-page text priority and does not inherit absent variants', () => {
  expect(printPageText(variants,0)).toEqual({header:variants.firstHeader,footer:''});
  expect(printPageText(variants,1)).toEqual({header:variants.evenHeader,footer:variants.evenFooter});
  expect(printPageText(variants,2)).toEqual({header:variants.header,footer:variants.footer});
  expect(printPageText({header:'Default',footer:'Default',differentFirst:true},0)).toEqual({header:'',footer:''});
  expect(printPageText({...variants,differentFirst:false,differentOddEven:false},1)).toEqual({header:variants.header,footer:variants.footer});
  const sheet={printSettings:normalizePrintSettings(variants)};
  expect(printSettingsFromPrefs(sheet,sheetPrintPrefs(sheet))).toMatchObject(variants);
  expect(sheetPrintPrefs({})).toMatchObject({differentFirst:false,differentOddEven:false});
});

it.each(['worksheet','chartsheet'])('reads standalone header/footer variants on a %s', kind => {
  const xml = `<s:${kind} xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><s:headerFooter differentFirst="true" differentOddEven="1"><s:oddFooter>Page &amp;P</s:oddFooter><s:firstFooter/></s:headerFooter></s:${kind}>`;
  expect(readXlsxPrint(xml,[],'Report',0)).toMatchObject({differentFirst:true,differentOddEven:true,footer:'Page &P',firstFooter:''});
});

it('preserves inactive variant text and false flags without treating it as active', () => {
  const p=readXlsxPrint('<worksheet><headerFooter differentFirst="0" differentOddEven="false"><firstHeader>Hidden</firstHeader><evenFooter>Also hidden</evenFooter></headerFooter></worksheet>',[],'Report',0);
  expect(p).toMatchObject({differentFirst:false,differentOddEven:false,firstHeader:'Hidden',evenFooter:'Also hidden'});
  expect(normalizePrintSettings({...p,differentFirst:'true',differentOddEven:1})).toMatchObject({differentFirst:false,differentOddEven:false});
});

it.each(['worksheet','chartsheet'])('writes one native header/footer block on a %s', kind => {
  const xml=`<${kind}><headerFooter><oddFooter>Old</oddFooter></headerFooter></${kind}>`;
  const result=writeXlsxPrint(xml,variants);
  expect(result.match(/<headerFooter\b/g)).toHaveLength(1);
  expect(readXlsxPrint(result,[],'Report',0)).toMatchObject(variants);
  expect(readXlsxPrint(writeXlsxPrint(result,variants),[],'Report',0)).toMatchObject(variants);
});

it('retains all variants through edits, Undo, sheet copies and metadata-free XLSX', async () => {
  let wb=new Workbook({sheets:[{name:'Report',cells:{'0,0':{v:'Values'}},printSettings:variants}]});
  const id=wb.activeSheetId;
  wb.setPrintSettings(id,{...variants,firstFooter:'Changed'});
  wb.undo();
  expect(wb.activeSheet.printSettings).toMatchObject(variants);
  expect(wb.duplicateSheet(id).printSettings).toMatchObject(variants); wb.undo();
  const bytes=new Uint8Array(await(await workbookToXlsx(wb)).arrayBuffer());
  const zip=X.CFB.read(bytes,{type:'array'}), part=X.CFB.find(zip,'/xl/workbook.xml');
  part.content=new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g,''));part.size=part.content.length;
  wb=await workbookFromFile(X.CFB.write(zip,{type:'array',fileType:'zip'}),'Headers.xlsx');
  expect(wb.activeSheet.printSettings).toMatchObject(variants);
  expect(wb.getValue(wb.activeSheetId,0,0)).toBe('Values');
});
