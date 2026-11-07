import { expect, it } from 'vitest';
import { readFontTheme, normalizeFontTheme, fontThemeXml } from '../src/core/font-theme.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { sameBook } from '../src/lib/drafts.js';

const theme = {
  name: 'Custom & multilingual',
  major: { latin: { typeface: 'Georgia', panose: '02040502050405020304', pitchFamily: 18, charset: -128 }, ea: { typeface: 'Yu Gothic' }, cs: { typeface: '' }, fonts: [{ script: 'Arab', typeface: 'Traditional Arabic' }] },
  minor: { latin: { typeface: 'Trebuchet MS' }, ea: { typeface: '' }, cs: { typeface: 'Arial' }, fonts: [{ script: 'Jpan', typeface: 'ＭＳ Ｐゴシック' }] },
};

it('round-trips DrawingML faces, fallback scripts and typeface attributes', () => {
  const xml = fontThemeXml(theme);
  expect(readFontTheme(xml)).toEqual(theme);
  expect(readFontTheme(xml.replace(/<(a:(?:latin|ea|cs|font))([^>]*?)\/>/g, '<$1$2></$1>'))).toEqual(theme);
  expect(readFontTheme(xml.replace('Custom &amp; multilingual', 'A > B'))?.name).toBe('A > B');
  expect(readFontTheme(xml.replaceAll('a:', 'd:').replaceAll('"', "'"))).toEqual(theme);
  expect(readFontTheme(`<!--${fontThemeXml({ ...theme, name: 'Ignored' })}--><?note ${xml}?>${xml}`)).toEqual(theme);
  expect(readFontTheme(fontThemeXml({ ...theme, name: 'A "quoted" name' }))).toEqual({ ...theme, name: 'A "quoted" name' });
});

it('validates and clones font schemes without retaining unrelated input', () => {
  const input = { ...theme, injected: '<bad/>', minor: { ...theme.minor, fonts: [{ script: '../bad', typeface: 'Other' }, ...theme.minor.fonts] } };
  const copy = normalizeFontTheme(input);
  expect(copy).toEqual(theme);
  copy.minor.fonts[0].typeface = 'Different';
  expect(theme.minor.fonts[0].typeface).toBe('ＭＳ Ｐゴシック');
  expect(normalizeFontTheme({ major: theme.major })).toBeNull();
  expect(readFontTheme('<a:fontScheme name="Incomplete"/>')).toBeNull();
});

it('preserves theme fonts through JSON, single-sheet export and metadata-free XLSX', async () => {
  const wb = new Workbook({ fontTheme: theme, normalFont: { name: 'Trebuchet MS', sz: 11 }, sheets: [{ name: 'Data', cells: {
    '0,0': { v: 'Theme fonts', s: { font: 'trebuchet' } },
  } }] });
  const restored = new Workbook(wb.toJSON()).sheetToWorkbook(wb.activeSheetId);
  expect(restored.fontTheme).toEqual(theme);
  expect(restored.normalFont.name).toBe('Trebuchet MS');
  const data = new Uint8Array(await (await workbookToXlsx(restored)).arrayBuffer());
  const zip = X.CFB.read(data, { type: 'array' });
  const native = new TextDecoder().decode(X.CFB.find(zip, '/xl/theme/theme1.xml').content);
  expect(readFontTheme(native)).toEqual(theme);
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.fontTheme).toEqual(theme);
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe('Theme fonts');
});

it('uses externally edited native theme fonts instead of stale metadata', async () => {
  const wb = new Workbook({ fontTheme: theme });
  const data = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(data, { type: 'array' });
  const part = X.CFB.find(zip, '/xl/theme/theme1.xml');
  const edited = { ...theme, name: 'Edited in another application', minor: { ...theme.minor, latin: { typeface: 'Arial' } } };
  const xml = new TextDecoder().decode(part.content).replace(/<a:fontScheme\b[^>]*>[\s\S]*?<\/a:fontScheme>/, fontThemeXml(edited));
  X.CFB.utils.cfb_add(zip, '/xl/theme/theme1.xml', new TextEncoder().encode(xml));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'edited.xlsx');
  expect(back.fontTheme).toEqual(edited);
});

it('recognizes saved default themes while retaining edits to custom faces and fallback scripts', async () => {
  const wb = new Workbook(); wb.setInput(wb.activeSheetId, 0, 0, 'Theme');
  const back = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  expect(sameBook(wb.toJSON(), back.toJSON())).toBe(true);
  expect(sameBook(back.toJSON(), wb.toJSON())).toBe(true);
  back.fontTheme.minor.fonts[0].typeface = 'Different script face';
  expect(sameBook(wb.toJSON(), back.toJSON())).toBe(false);
  back.fontTheme = theme;
  const saved = await workbookFromFile(await workbookToXlsx(back), 'custom.xlsx');
  expect(sameBook(back.toJSON(), saved.toJSON())).toBe(true);
  saved.fontTheme.major.latin.typeface = 'Different major face';
  expect(sameBook(back.toJSON(), saved.toJSON())).toBe(false);
});
