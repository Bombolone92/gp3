import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { readFontTheme, fontThemeXml } from '../src/core/font-theme.js';
import { themeFontXlsx } from './helpers/xlsx-theme-font-fixture.js';

async function output(wb, { native = true, theme = null } = {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = p => new TextDecoder().decode(X.CFB.find(zip, p).content);
  const set = (p, s) => X.CFB.utils.cfb_add(zip, p, new TextEncoder().encode(s));
  if (native) set('/xl/workbook.xml', get('/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  if (theme) { const xml = get('/xl/theme/theme1.xml'); const fonts = readFontTheme(xml); fonts.minor.latin.typeface = theme.minor; fonts.major.latin.typeface = theme.major;
    set('/xl/theme/theme1.xml', xml.replace(/<a:fontScheme\b[^>]*>[\s\S]*?<\/a:fontScheme>/, fontThemeXml(fonts))); }
  return { styles: get('/xl/styles.xml'), wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })) };
}

it('uses theme families for Normal, cells, inherited line fonts, rich runs and differential fonts', async () => {
  const wb = await workbookFromFile(themeFontXlsx()), id = wb.activeSheetId;
  expect(wb.normalFont).toMatchObject({ name: 'Courier New', sz: 16, scheme: 'minor' });
  expect(wb.activeSheet.defaultColWidth).toBe(156); // 12 characters × 13px maximum digit width.
  expect(wb.styleAt(id, 0, 0)).toMatchObject({ font: 'courier', scheme: 'minor' });
  expect(wb.styleAt(id, 10, 1)).toMatchObject({ font: 'georgia', scheme: 'major' });
  expect(wb.styleAt(id, 0, 2)).toMatchObject({ font: 'georgia', scheme: 'major' });
  expect(wb.styleAt(id, 2, 1)).toMatchObject({ font: 'courier', scheme: 'none' });
  expect(wb.getCell(id, 1, 0).richText[0].s).toMatchObject({ font: 'georgia', scheme: 'major' });
  expect(wb.activeSheet.rules[0].style).toMatchObject({ font: 'georgia', scheme: 'major' });
});

it('retains bindings through repeated native cycles and adopts externally changed theme families over metadata', async () => {
  let wb = await workbookFromFile(themeFontXlsx());
  for (const native of [false, true, true]) {
    const result = await output(new Workbook(wb.toJSON()), { native }); wb = result.wb;
    expect(result.styles).toContain('<scheme val="minor"/>');
    expect(result.styles).toContain('<scheme val="major"/>');
    expect(wb.normalFont.name).toBe('Courier New');
    expect(wb.getValue(wb.activeSheetId, 3, 1)).toBe(34);
  }
  const changed = (await output(wb, { native: false, theme: { minor: 'Arial', major: 'Times New Roman' } })).wb;
  const id = changed.activeSheetId;
  expect(changed.normalFont.name).toBe('Arial');
  expect(changed.styleAt(id, 0, 0).font).toBe('arial');
  expect(changed.styleAt(id, 0, 2).font).toBe('times');
  expect(changed.styleAt(id, 0, 3).font).toBe('courier');
  expect(changed.getCell(id, 1, 0).richText[0].s.font).toBe('times');
});

it('makes a manual family choice literal and restores its binding with undo', async () => {
  const wb = await workbookFromFile(themeFontXlsx()), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { font: 'courier' });
  expect(wb.styleAt(id, 0, 0).scheme).toBe('none');
  let changed = (await output(wb, { theme: { minor: 'Arial', major: 'Georgia' } })).wb;
  expect(changed.styleAt(changed.activeSheetId, 0, 0).font).toBe('courier');
  wb.undo();
  changed = (await output(wb, { theme: { minor: 'Arial', major: 'Georgia' } })).wb;
  expect(changed.styleAt(changed.activeSheetId, 0, 0).font).toBe('arial');
});

it('keeps copied fonts when the destination workbook has a different theme', async () => {
  const source = await workbookFromFile(themeFontXlsx());
  const target = new Workbook(); target.pasteCells(target.activeSheetId, source.copyRange(source.activeSheetId, { r1: 0, c1: 0, r2: 1, c2: 0 }), 0, 0);
  const back = (await output(target)).wb;
  expect(back.styleAt(back.activeSheetId, 0, 0).font).toBe('courier');
  expect(back.getCell(back.activeSheetId, 1, 0).richText[0].s.font).toBe('georgia');
});

it.each(['none', 'invalid'])('keeps the literal name when scheme is %s', async scheme => {
  const wb = await workbookFromFile(themeFontXlsx({ scheme }));
  expect(wb.normalFont.name).toBe('Arial');
});

it.each(['', null])('uses the cached family when the native theme is empty or absent (%s)', async minor => {
  let bytes = themeFontXlsx({ minor: minor ?? 'Courier New' });
  if (minor === null) {
    const zip = X.CFB.read(bytes, { type: 'array' });
    X.CFB.utils.cfb_del(zip, '/xl/theme/theme1.xml');
    bytes = X.CFB.write(zip, { type: 'array', fileType: 'zip' });
  }
  const wb = await workbookFromFile(bytes);
  expect(wb.normalFont.name).toBe('Arial');
  expect(wb.styleAt(wb.activeSheetId, 0, 0).font).toBe('arial');
  expect((await output(wb)).wb.normalFont.name).toBe('Arial');
});

it('clears a rich-run binding on a cell-wide family edit and restores it with undo', async () => {
  const wb = await workbookFromFile(themeFontXlsx()), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { font: 'arial' });
  expect(wb.getCell(id, 1, 0).richText[0].s.scheme).toBeUndefined();
  const back = (await output(wb)).wb;
  expect(back.getCell(back.activeSheetId, 1, 0).richText[0].s).toMatchObject({ font: 'arial', scheme: 'none' });
  wb.undo();
  expect(wb.getCell(id, 1, 0).richText[0].s).toMatchObject({ font: 'georgia', scheme: 'major' });
});

it('retains a literal family selection on inherited whole-column formats', async () => {
  const wb = await workbookFromFile(themeFontXlsx()), id = wb.activeSheetId;
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 1048575, c2: 1 }, { font: 'georgia' });
  const back = (await output(wb, { theme: { minor: 'Arial', major: 'Times New Roman' } })).wb;
  expect(back.styleAt(back.activeSheetId, 20, 1)).toMatchObject({ font: 'georgia', scheme: 'none' });
  wb.undo();
  expect(wb.styleAt(id, 20, 1)).toMatchObject({ font: 'georgia', scheme: 'major' });
});

it('does not bind literal pasted fonts to a matching destination theme face', async () => {
  const target = await workbookFromFile(themeFontXlsx());
  const source = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Literal', s: { font: 'courier' } } } }] });
  target.pasteCells(target.activeSheetId, source.copyRange(source.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 0 }), 0, 0);
  const back = (await output(target, { theme: { minor: 'Arial', major: 'Georgia' } })).wb;
  expect(back.styleAt(back.activeSheetId, 0, 0).font).toBe('courier');
});

it('keeps legacy app defaults while accepting a new native Normal binding', async () => {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([['Legacy']]), 'Data');
  X.utils.book_append_sheet(book, X.utils.aoa_to_sheet([[JSON.stringify({ v: 1, sheets: { Data: { styles: { '0,0': { bold: true } } } } })]]), '_puter_meta');
  const legacy = await workbookFromFile(X.write(book, { type: 'array', bookType: 'xlsx' }));
  expect(legacy.normalFont).toBeNull();
  expect(legacy.getCell(legacy.activeSheetId, 0, 0).s).toEqual({ bold: true });
  const modern = new Workbook(); modern.setInput(modern.activeSheetId, 0, 0, 'Modern');
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(modern)).arrayBuffer()), { type: 'array' });
  const styles = X.CFB.find(zip, '/xl/styles.xml');
  X.CFB.utils.cfb_add(zip, '/xl/styles.xml', new TextEncoder().encode(new TextDecoder().decode(styles.content).replace('</font>', '<scheme val="minor"/></font>')));
  const changed = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(changed.normalFont).toMatchObject({ name: 'Calibri', scheme: 'minor' });
});

it.each(['invalid', null])('keeps rich-run families literal with a missing or invalid scheme (%s)', async scheme => {
  const zip = X.CFB.read(themeFontXlsx(), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/worksheets/sheet1.xml');
  const xml = new TextDecoder().decode(part.content).replace('<rFont val="Arial"/>', '<rFont val="Courier New"/>')
    .replace('<scheme val="major"/>', scheme === null ? '' : `<scheme val="${scheme}"/>`);
  X.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', new TextEncoder().encode(xml));
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  expect(wb.getCell(wb.activeSheetId, 1, 0).richText[0].s).toMatchObject({ font: 'courier', scheme: 'none' });
  const back = (await output(wb, { theme: { minor: 'Arial', major: 'Georgia' } })).wb;
  expect(back.getCell(back.activeSheetId, 1, 0).richText[0].s).toMatchObject({ font: 'courier', scheme: 'none' });
});
