import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import { applyWorkbookTheme, applyGalleryTheme, workbookTheme, readThemeInfo, writeThemeInfo } from '../src/core/workbook-theme.js';
import { EFFECT_SCHEMES, effectScheme, themeEffectCss, textBoxEffectCss, writeEffectScheme, readEffectSchemeName, effectStyleListXml } from '../src/core/theme-effects.js';
import { normalizeChart } from '../src/core/charts.js';

const theme1 = async wb => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, '/xl/theme/theme1.xml').content);
};

it('offers original effect schemes of three styles each, the default first', () => {
  expect(EFFECT_SCHEMES[0].name).toBe('Office');
  expect(EFFECT_SCHEMES.length).toBeGreaterThanOrEqual(5);
  for (const s of EFFECT_SCHEMES) expect(s.styles).toHaveLength(3);
  const xml = effectStyleListXml(effectScheme('Halo'));
  expect(xml.match(/<a:effectStyle>/g)).toHaveLength(3);
  expect(xml).toContain('<a:glow rad="38100"><a:schemeClr val="phClr"><a:alpha val="40000"/></a:schemeClr></a:glow>');
  expect(effectStyleListXml(effectScheme('Chiselled'))).toContain('<a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d>');
  expect(effectStyleListXml(effectScheme('Flat'))).toBe('<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>');
});

it('writes a scheme into a theme part and reads its name back; the default leaves the part alone', () => {
  const part = '<a:theme name="Office Theme"><a:themeElements><a:fmtScheme name="Office"><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst></a:fmtScheme></a:themeElements></a:theme>';
  expect(writeEffectScheme(part, 'Office')).toBe(part);
  const written = writeEffectScheme(part, 'Soft Shadow');
  expect(written).toContain('<a:fmtScheme name="Soft Shadow">');
  expect(written).toContain(effectStyleListXml(effectScheme('Soft Shadow')));
  expect(readEffectSchemeName(written)).toBe('Soft Shadow');
  expect(readEffectSchemeName(part.replace('name="Office">', 'name="Somebody Else">'))).toBeNull();
  expect(readThemeInfo(written)).toEqual({ name: 'Office', effects: 'Soft Shadow' });
  expect(writeThemeInfo(part, { effects: 'Halo' })).toContain('<a:fmtScheme name="Halo">');
});

it('applies an effect scheme as one undoable step, and a gallery theme brings its own effects', () => {
  const wb = new Workbook();
  expect(workbookTheme(wb).effectsName).toBe('Office');
  expect(applyWorkbookTheme(wb, { effects: 'Halo' }, 'Theme effects: Halo')).toBe(true);
  expect(wb.themeInfo).toEqual({ effects: 'Halo' });
  expect(workbookTheme(wb).effectsName).toBe('Halo');
  expect(applyWorkbookTheme(wb, { effects: 'Halo' })).toBe(false);
  wb.undo();
  expect(wb.themeInfo).toBeNull();
  wb.redo();
  expect(wb.themeInfo).toEqual({ effects: 'Halo' });
  applyGalleryTheme(wb, 'Harbor');
  expect(wb.themeInfo).toMatchObject({ name: 'Harbor', colors: 'Harbor' });
  expect(wb.themeInfo.effects).toBeUndefined();
  expect(applyWorkbookTheme(wb, { effects: 'Nonexistent' })).toBe(false);
});

it('keeps a default file theme part unchanged and saves and opens a chosen scheme', async () => {
  const plain = new Workbook();
  const before = await theme1(plain);
  expect(before).toContain('<a:fmtScheme name="Office">');
  const wb = new Workbook();
  applyWorkbookTheme(wb, { effects: 'Chiselled' });
  const xml = await theme1(wb);
  expect(xml).toContain('<a:fmtScheme name="Chiselled">');
  expect(xml).toContain(effectStyleListXml(effectScheme('Chiselled')));
  expect(xml.replace(/<a:fmtScheme\b[\s\S]*?<\/a:fmtScheme>/, '')).toBe(before.replace(/<a:fmtScheme\b[\s\S]*?<\/a:fmtScheme>/, ''));
  const back = await workbookFromFile(await workbookToXlsx(wb), 'fx.xlsx');
  expect(back.themeInfo).toEqual({ effects: 'Chiselled' });
  // Back to the default scheme: the default part again.
  applyWorkbookTheme(back, { effects: 'Office' });
  expect(back.themeInfo).toBeNull();
  const fmt = xml => xml.match(/<a:fmtScheme\b[\s\S]*?<\/a:fmtScheme>/)[0];
  expect(fmt(await theme1(back))).toBe(fmt(before));
});

it('draws a text box that uses a theme effect with the workbook scheme, and saves the reference', async () => {
  expect(normalizeChart({ type: 'text', text: 'x', anchor: { r: 0, c: 0 }, style: { effectRef: 2 } }).style.effectRef).toBe(2);
  expect(normalizeChart({ type: 'text', text: 'x', anchor: { r: 0, c: 0 }, style: { effectRef: 7 } }).style.effectRef).toBeUndefined();
  const wb = new Workbook(); const id = wb.activeSheetId;
  const boxId = wb.addChart(id, { type: 'text', text: 'Glow', anchor: { r: 1, c: 1 }, w: 160, h: 60, style: { bg: '#ffffff', effectRef: 3 } });
  const box = () => wb.chartById(id, boxId);
  // The default scheme's intense effect: a shadow and a bevel.
  expect(textBoxEffectCss(wb, box()).filter).toMatch(/^drop-shadow\(0\.00px 2\.41px/);
  expect(textBoxEffectCss(wb, box()).boxShadow).toContain('inset');
  applyWorkbookTheme(wb, { effects: 'Halo' });
  expect(textBoxEffectCss(wb, box())).toEqual({ filter: 'drop-shadow(0 0 10.67px rgba(79, 129, 189, 0.5))' });
  applyWorkbookTheme(wb, { effects: 'Flat' });
  expect(textBoxEffectCss(wb, box())).toEqual({});
  expect(themeEffectCss(effectScheme('Lifted'), 1, '#000000').filter).toBe('drop-shadow(1.89px 1.89px 0.67px rgba(0, 0, 0, 0.3))');
  expect(textBoxEffectCss(wb, { style: {} })).toEqual({});

  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const drawing = new TextDecoder().decode(X.CFB.find(zip, zip.FullPaths.find(p => /drawings\/drawing\d+\.xml$/.test(p))).content);
  expect(drawing).toMatch(/<\/xdr:spPr><xdr:style><a:lnRef idx="0"><a:schemeClr val="accent1"\/><\/a:lnRef><a:fillRef idx="0"><a:schemeClr val="accent1"\/><\/a:fillRef><a:effectRef idx="3"><a:schemeClr val="accent1"\/><\/a:effectRef><a:fontRef idx="minor"><a:schemeClr val="tx1"\/><\/a:fontRef><\/xdr:style><xdr:txBody>/);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'fx.xlsx');
  expect(back.activeSheet.charts[0].style.effectRef).toBe(3);
  expect(back.themeInfo).toEqual({ effects: 'Flat' });
});
