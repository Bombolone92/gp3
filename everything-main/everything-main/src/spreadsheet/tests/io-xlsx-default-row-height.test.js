import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';

const fixture = (head, name = 'Calibri', size = 11) => otherProgramsXlsx({ sheetXml: { Data: {
  head: '<sheetViews><sheetView workbookViewId="0"/></sheetViews>' + head,
  rows: '<row r="1"><c r="A1"><v>17</v></c></row><row r="4" ht="37.5" customHeight="1"><c r="A4"><f>A1*2</f><v>34</v></c></row>',
} }, patch: { '/xl/styles.xml': s => s.replace('<name val="Calibri"/>', `<name val="${name}"/>`).replace('<sz val="12"/>', `<sz val="${size}"/>`)
  .replace('<scheme val="minor"/>', '') } });

async function output(wb, { native = true, edit = s => s } = {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const set = (p, s) => X.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(s));
  const xml = edit(get('/xl/worksheets/sheet1.xml')); set('/xl/worksheets/sheet1.xml', xml);
  if (native) set('/xl/workbook.xml', get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return { xml, wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })) };
}

it.each([['Calibri', 11], ['Calibri', 12], ['Arial', 16], ['Geneva', 10]])('retains the absent format element and its native initial height for %s %s', async (name, size) => {
  let wb = await workbookFromFile(fixture('', name, size));
  for (const native of [false, true, true]) {
    expect(wb.activeSheet.defaultRowHeight).toBe(16 * 4 / 3);
    expect(wb.rowHeight(wb.activeSheetId, 3)).toBe(50);
    expect(wb.getValue(wb.activeSheetId, 3, 0)).toBe(34);
    wb.setColWidth(wb.activeSheetId, 2, 137);
    const result = await output(new Workbook(wb.toJSON()), { native });
    expect(result.xml).not.toContain('<sheetFormatPr'); wb = result.wb;
    expect(wb.colWidth(wb.activeSheetId, 2)).toBe(137);
  }
});

it.each(['', ' customHeight="0"', ' customHeight="false"', ' customHeight="1"', ' customHeight="true"'])('retains sheet default sizing independently of row sizing: %s', async flag => {
  let wb = await workbookFromFile(fixture(`<sheetFormatPr defaultRowHeight="18.75"${flag}/>`));
  const fixed = /"(?:1|true)"/.test(flag);
  for (const native of [false, true, true]) {
    const result = await output(wb, { native }); wb = result.wb;
    const format = result.xml.match(/<sheetFormatPr\b[^>]*>/)[0];
    expect(format.includes('customHeight="1"')).toBe(fixed);
    expect(wb.activeSheet.defaultRowHeight).toBe(25);
    expect(wb.activeSheet.rowHeightModes.get(0)).toBe('auto');
    expect(wb.activeSheet.rowHeightModes.get(3)).toBe('fixed');
  }
});

it('keeps user changes to defaults explicit instead of replaying native implicit or automatic settings', async () => {
  for (const head of ['', '<sheetFormatPr defaultRowHeight="15"/>']) {
    const wb = await workbookFromFile(fixture(head));
    wb.activeSheet.defaultRowHeight = 49;
    const result = await output(wb);
    expect(result.xml.match(/<sheetFormatPr\b[^>]*>/)[0]).toContain('customHeight="1"');
    expect(result.wb.activeSheet.defaultRowHeight).toBe(49);
  }
  const wb = await workbookFromFile(fixture(''));
  wb.activeSheet.defaultColWidth = 143;
  const result = await output(wb);
  expect(result.xml).toContain('<sheetFormatPr');
  expect(result.wb.activeSheet.defaultColWidth).toBe(143);
});

it.each(['true', 'false'])('adopts externally changed heights and customHeight=%s over private metadata', async custom => {
  const wb = await workbookFromFile(fixture(`<sheetFormatPr defaultRowHeight="15" customHeight="${custom === 'true' ? 'false' : 'true'}"/>`));
  const result = await output(wb, { native: false, edit: s => s.replace(/<sheetFormatPr\b[^>]*\/>/, `<sheetFormatPr defaultRowHeight="33" customHeight="${custom}"/>`) });
  expect(result.wb.activeSheet.defaultRowHeight).toBe(44);
  const next = await output(result.wb);
  expect(next.xml.match(/<sheetFormatPr\b[^>]*>/)[0].includes('customHeight="1"')).toBe(custom === 'true');
  expect(next.wb.activeSheet.defaultRowHeight).toBe(44);
});

it('discards invalid provenance in drafts and preserves fixed behavior for malformed native flags', async () => {
  for (const value of [{ pixels: Infinity, mode: 'auto' }, { pixels: -1, mode: 'auto' }, { pixels: 20, mode: 'implicit' }, { pixels: 20, mode: 'unknown' }]) {
    expect(new Workbook({ sheets: [{ nativeDefaultHeight: value }] }).activeSheet.nativeDefaultHeight).toBeUndefined();
  }
  const wb = await workbookFromFile(fixture('<sheetFormatPr defaultRowHeight="15" customHeight="invalid"/>'));
  expect(wb.activeSheet.nativeDefaultHeight).toBeUndefined();
  expect((await output(wb)).xml.match(/<sheetFormatPr\b[^>]*>/)[0]).toContain('customHeight="1"');
});

it('preserves native default provenance through sheet duplication and undo without changing app defaults', async () => {
  const wb = await workbookFromFile(fixture('<sheetFormatPr defaultRowHeight="15"/>'));
  const copy = wb.duplicateSheet(wb.activeSheetId);
  expect(copy.nativeDefaultHeight).toEqual({ pixels: 20, mode: 'auto' });
  copy.nativeDefaultHeight.pixels = 30;
  expect(wb.sheets[0].nativeDefaultHeight.pixels).toBe(20);
  wb.undo(); expect(wb.sheets).toHaveLength(1);
  expect((await output(wb)).xml.match(/<sheetFormatPr\b[^>]*>/)[0]).not.toContain('customHeight="1"');
  const app = new Workbook(), before = app.activeSheet.defaultRowHeight;
  const result = await output(app);
  expect(result.wb.activeSheet.defaultRowHeight).toBe(before);
  expect(result.xml.match(/<sheetFormatPr\b[^>]*>/)[0]).toContain('customHeight="1"');
});
