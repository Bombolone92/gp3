import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { readXlsxPrint } from '../src/core/xlsx-print.js';
import { writeXlsxPrint } from '../src/core/xlsx-export-print.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

it.each(['worksheet', 'chartsheet'])('preserves header alignment independently of text on %s', kind => {
  for (const [attr, expected] of [[null, true], ['0', false], ['false', false], ['1', true], ['true', true], [' false ', false], ['invalid', true]]) {
    for (const text of ['', '<x:oddHeader>&amp;LLeft&amp;RRight</x:oddHeader>']) {
      const xml = `<x:${kind}><x:headerFooter${attr == null ? '' : ` alignWithMargins="${attr}"`}>${text}</x:headerFooter></x:${kind}>`;
      const settings = readXlsxPrint(xml, [], 'Report', 0);
      expect(settings.alignWithMargins).toBe(expected);
      const saved = writeXlsxPrint(`<${kind}></${kind}>`, settings);
      if (!expected) expect(saved).toContain('alignWithMargins="0"');
      expect(readXlsxPrint(saved, [], 'Report', 0).alignWithMargins).toBe(expected);
    }
  }
});

it('keeps alignment through edits, drafts, sheet copies and metadata-free native exchange', async () => {
  let wb = await workbookFromFile(otherProgramsXlsx({ sheetXml: { Data: {
    rows: '<row r="1"><c r="A1"><v>12</v></c></row>',
    tail: '<headerFooter alignWithMargins="0"><oddFooter>&amp;LLeft&amp;RRight</oddFooter></headerFooter>',
  } } }), 'report.xlsx');
  wb.setInput(wb.activeSheetId, 0, 0, '24');
  wb = new Workbook(wb.toJSON());
  expect(wb.duplicateSheet(wb.activeSheetId).printSettings.alignWithMargins).toBe(false);
  wb.undo();
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(wb.activeSheet.printSettings).toMatchObject({ alignWithMargins: false, footer: '&LLeft&RRight' });
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(24);
});

it('uses native default alignment after an external editor removes an explicit override', async () => {
  const wb = new Workbook({ sheets: [{ name: 'Report', printSettings: { alignWithMargins: false, header: '&LTitle' } }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/ alignWithMargins="0"/, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native-edit.xlsx');
  expect(back.activeSheet.printSettings.alignWithMargins).toBe(true);
});
