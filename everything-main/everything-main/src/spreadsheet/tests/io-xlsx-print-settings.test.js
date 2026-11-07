import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { readXlsxPrint } from '../src/core/xlsx-print.js';
import { normalizePrintSettings } from '../src/core/print-settings.js';
import { writeXlsxPrint } from '../src/core/xlsx-export-print.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const name = "Invoice, Q's";
const area = "'Invoice, Q''s'!$A$1:$G$41,'Invoice, Q''s'!$J$2:$K$3";
const data = () => otherProgramsXlsx({ sheetNames: [name], sheetXml: { [name]: {
  head: '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>',
  rows: '<row r="1"><c r="A1" t="str"><v>Invoice</v></c></row>',
  tail: '<printOptions horizontalCentered="true" verticalCentered="1"/><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" scale="77" orientation="portrait"/>',
} }, patch: { '/xl/workbook.xml': xml => xml.replace('</workbook>', `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">${area}</definedName></definedNames></workbook>`) } });

it.each(['worksheet', 'chartsheet'])('preserves unspecified and explicit paper sizes on a %s', kind => {
  // Excel's omitted size depends on printer/locale (MS-OI29500 §2.1.638(h));
  // an explicit Letter value must not be substituted during a round trip.
  for (const paper of [null, 1, 5, 9, 118]) {
    const xml = `<${kind}><pageSetup orientation="landscape"${paper == null ? '' : ` paperSize="${paper}"`}/></${kind}>`;
    const settings = readXlsxPrint(xml, [], 'Report', 0);
    expect(settings.paperSize).toBe(paper);
    const saved = writeXlsxPrint(`<${kind}></${kind}>`, settings);
    expect(saved.includes('paperSize=')).toBe(paper != null);
    expect(readXlsxPrint(saved, [], 'Report', 0).paperSize).toBe(paper);
  }
});

it('retains printer-default paper through edits, drafts, copies and repeated native exports', async () => {
  let wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
    rows: '<row r="1"><c r="A1"><v>17</v></c></row>', tail: '<pageSetup scale="72"/>',
  } } }), 'report.xlsx');
  expect(wb.activeSheet.printSettings.paperSize).toBeNull();
  wb.setInput(wb.activeSheetId, 1, 0, '23');
  wb = new Workbook(wb.toJSON());
  expect(wb.duplicateSheet(wb.activeSheetId).printSettings.paperSize).toBeNull();
  wb.undo();
  for (let pass = 0; pass < 2; pass++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const worksheet = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
    expect(worksheet).not.toContain('paperSize=');
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    expect(wb.activeSheet.printSettings.paperSize).toBeNull();
    expect(wb.getValue(wb.activeSheetId, 1, 0)).toBe(23);
  }
});

it('honors a native removal of paper size over older private print settings', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', cells: { '0,0': { v: 42 } }, printSettings: { paperSize: 9 } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/ paperSize="[^"]*"/, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
  expect(back.activeSheet.printSettings.paperSize).toBeNull();
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe(42);
});

it('imports native print areas and default fit counts; exports them without relying on app metadata', async () => {
  const wb = await workbookFromFile(data(), 'invoice.xlsx');
  const original = wb.activeSheet.printSettings;
  expect(original).toMatchObject({ areas: [{ r1: 0, c1: 0, r2: 40, c2: 6 }, { r1: 1, c1: 9, r2: 2, c2: 10 }],
    margins: { left: .7, right: .7, top: .75, bottom: .75, header: .3, footer: .3 },
    fitToPage: true, fitWidth: 1, fitHeight: 1, paperSize: 9, scale: 77, gridlines: false, headings: false,
    horizontalCentered: true, verticalCentered: true });
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' }), decoder = new TextDecoder();
  const worksheet = decoder.decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  const doc = new (new JSDOM('').window.DOMParser)().parseFromString(worksheet, 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.querySelector('pageSetUpPr').getAttribute('fitToPage')).toBe('1');
  expect(doc.querySelector('pageSetup').getAttribute('fitToHeight')).toBe('1');
  expect(worksheet.indexOf('<printOptions')).toBeLessThan(worksheet.indexOf('<pageMargins'));
  expect(worksheet.indexOf('<pageMargins')).toBeLessThan(worksheet.indexOf('<pageSetup'));
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(decoder.decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(back.activeSheet.printSettings).toEqual(original);
  expect(back.getDisplay(back.activeSheetId, 0, 0)).toBe('Invoice');
});

it('follows insertions, deletion, sheet rename, duplication, drafts and undo', async () => {
  const wb = await workbookFromFile(data(), 'invoice.xlsx'), id = wb.activeSheetId;
  const original = structuredClone(wb.sheet(id).printSettings);
  wb.insertRows(id, 3, 2);
  expect(wb.sheet(id).printSettings.areas[0].r2).toBe(42);
  wb.undo();
  expect(wb.sheet(id).printSettings).toEqual(original);
  wb.deleteRows(id, 0, 1);
  expect(wb.sheet(id).printSettings.areas[0]).toEqual({ r1: 0, c1: 0, r2: 39, c2: 6 });
  wb.undo();
  wb.renameSheet(id, 'Renamed invoice');
  const copy = new Workbook(wb.toJSON());
  expect(copy.activeSheet.printSettings).toEqual(original);
  copy.setPrintSettings(id, { ...original, scale: 88, fitToPage: false });
  expect(wb.sheet(id).printSettings.scale).toBe(77);
  copy.undo();
  expect(copy.activeSheet.printSettings).toEqual(original);
  const duplicated = copy.duplicateSheet(id);
  expect(duplicated.printSettings).toEqual(original);
  duplicated.printSettings.areas[0].r2 = 10;
  expect(copy.sheet(id).printSettings.areas[0].r2).toBe(40);
  copy.undo();
  const saved = await workbookFromFile(await workbookToXlsx(copy), 'renamed.xlsx');
  expect(saved.activeSheet.name).toBe('Renamed invoice');
  expect(saved.activeSheet.printSettings).toEqual(original);
});

it('validates untrusted settings and keeps custom-view settings separate', () => {
  expect(normalizePrintSettings(null)).toBeNull();
  expect(normalizePrintSettings({ scale: Infinity, fitWidth: -1, fitHeight: 0, margins: { left: NaN, top: -.5 }, areas: [{ r1: -1, c1: 0, r2: 1, c2: 1 }] }))
    .toMatchObject({ scale: 100, fitWidth: 1, fitHeight: 0, margins: { left: .7, top: .75 }, areas: [] });
  const xml = '<worksheet><!-- <pageSetup scale="20"/> --><sheetData/><customSheetViews><customSheetView><pageSetup scale="50"/></customSheetView></customSheetViews><pageSetup scale="88" fitToHeight="0"/></worksheet>';
  expect(readXlsxPrint(xml, [], 'Data', 0)).toMatchObject({ scale: 88, fitToPage: false, fitHeight: 0 });
  expect(readXlsxPrint('<worksheet><sheetData/></worksheet>', [], 'Data', 0)).toBeNull();
  expect(readXlsxPrint(xml, [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: 'SUM(Data!A1:B2)' }], 'Data', 0).areas).toEqual([]);
  expect(readXlsxPrint(xml, [{ Name: '_xlnm.Print_Area', Sheet: 0, Ref: 'Other!A1:B2' }], 'Data', 0).areas).toEqual([]);
});

it('preserves literal XML and replacement characters in page text without damaging the package', async () => {
  const footer = '&LPage &P &R$& $1 <total> "quoted"';
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 12 } }, printSettings: { footer } }] });
  const back = await workbookFromFile(await workbookToXlsx(wb), 'footer.xlsx');
  expect(back.activeSheet.printSettings.footer).toBe(footer);
  expect(back.activeSheet.printSettings.header).toBeUndefined();
});

it('writes the standard header/footer token spellings and preserves escaped ampersands', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 12 } },
    printSettings: { footer: '&CPage &[Page] of &[Pages]&R&[Date] &&[Page]' } }] });
  const blob = await workbookToXlsx(wb), zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  const doc = new (new JSDOM('').window.DOMParser)().parseFromString(xml, 'application/xml');
  expect(doc.querySelector('oddFooter').textContent).toBe('&CPage &P of &N&R&D &&[Page]');
});

it.each(['downThenOver', 'overThenDown'])('preserves native %s page order through editing and metadata-free exports', async pageOrder => {
  let wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
    rows: '<row r="1"><c r="A1"><v>17</v></c></row>', tail: `<pageSetup scale="150" pageOrder="${pageOrder}"/>`,
  } } }), 'pages.xlsx');
  wb.setInput(wb.activeSheetId, 1, 0, '42');
  wb = new Workbook(wb.toJSON());
  expect(wb.duplicateSheet(wb.activeSheetId).printSettings.pageOrder).toBe(pageOrder); wb.undo();
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const native = new TextDecoder().decode(X.CFB.find(zip, '/xl/worksheets/sheet1.xml').content);
  expect(native).toContain(`pageOrder="${pageOrder}"`);
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.activeSheet.printSettings.pageOrder).toBe(pageOrder);
  expect(back.getValue(back.activeSheetId, 1, 0)).toBe(42);
});

it('uses the standard default page order and excludes the worksheet-only attribute from chart sheets', () => {
  for (const pageOrder of [undefined, '', 'overThenDown ', 'untrusted']) expect(normalizePrintSettings({ pageOrder }).pageOrder).toBe('downThenOver');
  expect(readXlsxPrint('<worksheet><pageSetup/></worksheet>', [], 'Data', 0).pageOrder).toBe('downThenOver');
  expect(writeXlsxPrint('<chartsheet></chartsheet>', { pageOrder: 'overThenDown' })).not.toContain('pageOrder=');
});
