import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
import { DEFAULT_COLOR_PALETTE } from '../src/core/font-color.js';
import {
  applyGalleryTheme, applyWorkbookTheme, colorScheme, COLOR_SCHEMES, FONT_SCHEMES, THEMES, themeColor, themeColorGrid,
  themeTints, workbookTheme, themedColors, themedTableLook, readThemeInfo, writeThemeInfo, themedCellStylePatch, themedPreset,
} from '../src/core/workbook-theme.js';
import { tableStyle } from '../src/core/tables.js';
import { cellStyle } from '../src/core/cellstyles.js';

const themeXml = async wb => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  return new TextDecoder().decode(X.CFB.find(zip, '/xl/theme/theme1.xml').content);
};

describe('theme catalogue', () => {
  it('has a default theme equal to the app palette and original schemes of twelve colours', () => {
    expect(colorScheme('Office').colors).toEqual(DEFAULT_COLOR_PALETTE.theme);
    for (const s of COLOR_SCHEMES) expect(s.colors).toHaveLength(12);
    for (const t of THEMES) {
      expect(COLOR_SCHEMES.some(s => s.name === t.colors)).toBe(true);
      expect(FONT_SCHEMES.some(s => s.name === t.fonts)).toBe(true);
    }
    expect(new Set(THEMES.map(t => t.name)).size).toBe(THEMES.length);
  });

  it('offers tint rows by lightness', () => {
    expect(themeTints('#ffffff')).toEqual([-0.05, -0.15, -0.25, -0.35, -0.5]);
    expect(themeTints('#000000')).toEqual([0.5, 0.35, 0.25, 0.15, 0.05]);
    expect(themeTints('#4f81bd')).toEqual([0.8, 0.6, 0.4, -0.25, -0.5]);
    expect(themeTints('#eeece1')).toEqual([-0.1, -0.25, -0.5, -0.75, -0.9]);
    const grid = themeColorGrid(DEFAULT_COLOR_PALETTE.theme);
    expect(grid).toHaveLength(6);
    expect(grid[0].map(c => c.label).slice(0, 5)).toEqual(['Light 1', 'Dark 1', 'Light 2', 'Dark 2', 'Accent 1']);
    expect(grid[1][4]).toMatchObject({ index: 4, tint: 0.8, label: 'Accent 1, 80% lighter' });
    expect(grid[1][4].color.rgb).toBe('#dce6f2');
  });
});

describe('applying a theme', () => {
  it('recolours theme references in cells and rich text, rebinds theme fonts, and undoes', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: themeColor(4), color: themeColor(1) });
    wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bg: themeColor(5, 0.4) });
    wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { bg: '#123456' });
    wb.setInput(id, 3, 0, 'x');
    wb.sheet(id).cells.set('3,0', { ...wb.sheet(id).cells.get('3,0'), s: { font: 'calibri', scheme: 'minor' } });
    expect(applyGalleryTheme(wb, 'Harbor')).toBe(true);
    const harbor = colorScheme('Harbor').colors;
    expect(wb.styleAt(id, 0, 0).bg).toMatchObject({ theme: 4, base: harbor[4], rgb: harbor[4] });
    expect(wb.styleAt(id, 1, 0).bg.tint).toBe(0.4);
    expect(wb.styleAt(id, 1, 0).bg.base).toBe(harbor[5]);
    expect(wb.styleAt(id, 2, 0).bg).toBe('#123456');
    expect(wb.styleAt(id, 3, 0).font).toBe('verdana');
    expect(wb.normalFont).toMatchObject({ name: 'Verdana', scheme: 'minor' });
    expect(workbookTheme(wb)).toMatchObject({ name: 'Harbor', colorsName: 'Harbor', fontsName: 'Ledger', major: 'Georgia', minor: 'Verdana' });
    expect(themedColors(wb)).toEqual(harbor);
    wb.undo();
    expect(wb.styleAt(id, 0, 0).bg.rgb).toBe(DEFAULT_COLOR_PALETTE.theme[4]);
    expect(wb.styleAt(id, 3, 0).font).toBe('calibri');
    expect(wb.normalFont).toBeNull();
    expect(wb.colorPalette).toBeNull();
    expect(wb.themeInfo).toBeNull();
    wb.redo();
    expect(wb.styleAt(id, 0, 0).bg.rgb).toBe(harbor[4]);
    // Back to the default theme gives the app's own look back.
    applyGalleryTheme(wb, 'Office');
    expect(wb.colorPalette).toBeNull();
    expect(wb.fontTheme).toBeNull();
    expect(wb.normalFont).toBeNull();
    expect(themedColors(wb)).toBeNull();
  });

  it('changes colours alone or fonts alone, keeping the other half', () => {
    const wb = new Workbook();
    applyWorkbookTheme(wb, { colors: { name: 'Ember', colors: colorScheme('Ember').colors } });
    expect(workbookTheme(wb)).toMatchObject({ colorsName: 'Ember', fontsName: 'Office', minor: 'Calibri' });
    applyWorkbookTheme(wb, { fonts: { name: 'Plain', major: 'Arial', minor: 'Arial' } });
    expect(workbookTheme(wb)).toMatchObject({ colorsName: 'Ember', fontsName: 'Plain', major: 'Arial' });
    expect(workbookTheme(wb).colors[4]).toBe(colorScheme('Ember').colors[4]);
  });

  it('keeps the app look for tables and presets under the default theme and follows accents otherwise', () => {
    const wb = new Workbook();
    expect(themedTableLook('blue', tableStyle('blue'), wb)).toEqual(tableStyle('blue'));
    expect(themedPreset(cellStyle('heading'), wb)).toBe(cellStyle('heading'));
    applyGalleryTheme(wb, 'Meadow');
    expect(themedTableLook('blue', tableStyle('blue'), wb).header).toBe(colorScheme('Meadow').colors[4]);
    expect(themedPreset(cellStyle('heading'), wb).patch.color).toMatchObject({ theme: 3 });
    expect(themedCellStylePatch('accent2-20', wb).patch.bg).toMatchObject({ theme: 5, tint: 0.8 });
  });
});

describe('XLSX', () => {
  it('writes the chosen theme into theme1.xml and reads it back', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'Accent');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: themeColor(4) });
    applyGalleryTheme(wb, 'Lagoon');
    const xml = await themeXml(wb);
    expect(xml).toMatch(/<a:theme [^>]*name="Lagoon"/);
    expect(xml).toMatch(/<a:clrScheme name="Lagoon">/);
    expect(xml).toContain('<a:accent1><a:srgbClr val="1497A6"/></a:accent1>');
    expect(xml).toMatch(/<a:fontScheme name="Studio">/);
    expect(xml).toContain('<a:latin typeface="Century Gothic"/>');
    const back = await workbookFromFile(await workbookToXlsx(wb), 'theme.xlsx');
    expect(workbookTheme(back)).toMatchObject({ name: 'Lagoon', colorsName: 'Lagoon', fontsName: 'Studio', minor: 'Century Gothic' });
    expect(back.styleAt(back.activeSheetId, 0, 0).bg).toMatchObject({ theme: 4, rgb: '#1497a6' });
    expect(back.themeInfo.ownNormal).toBe(true);
    // Choosing the default theme after the round trip still restores the app's default Normal font.
    applyGalleryTheme(back, 'Office');
    expect(back.normalFont).toBeNull();
  });

  it('reads and writes theme names', () => {
    const xml = '<a:theme xmlns:a="x" name="Office Theme"><a:themeElements><a:clrScheme name="Office"/><a:fontScheme name="Office"/></a:themeElements></a:theme>';
    expect(readThemeInfo(xml)).toEqual({ name: 'Office', colors: 'Office' });
    expect(readThemeInfo(writeThemeInfo(xml, { name: 'A & B', colors: 'Mine' }))).toEqual({ name: 'A & B', colors: 'Mine' });
  });
});
