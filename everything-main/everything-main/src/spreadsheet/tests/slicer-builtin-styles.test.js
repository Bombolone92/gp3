import { expect, it, vi } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { slicerTableReference } from '../src/core/slicer.js';
import { resolveSlicerPaint } from '../src/core/slicer-paint.js';
import { builtInSlicerStyle } from '../src/core/slicer-builtin-styles.js';
import { importNativePivotSlicerCaches } from '../src/core/native-pivot-slicer-storage.js';

// The default theme: lt1, dk1, lt2, dk2, then Accent 1–6.
const scheme = 'FFFFFF 000000 E7E6E6 44546A 4472C4 ED7D31 A5A5A5 FFC000 5B9BD5 70AD47'.split(' ');
const themes = { themeElements: { clrScheme: scheme.map(rgb => ({ rgb })) } };
const builtIn = name => resolveSlicerPaint({ name, builtIn: true }, themes);
const NAMES = [1, 2, 3, 4, 5, 6].flatMap(n => [`SlicerStyleLight${n}`, `SlicerStyleDark${n}`]).concat('SlicerStyleOther1', 'SlicerStyleOther2');

// A workbook naming a built-in style (the usual default, SlicerStyleLight1, most of all) would not open:
// "Built-in slicer paint definitions are not implemented yet".
it.each(NAMES)('draws the built-in style %s with every frame part and item state', name => {
  const paint = builtIn(name);
  expect(Object.keys(paint.frame).sort()).toEqual(['headerRow', 'wholeTable']);
  expect(Object.keys(paint.items)).toHaveLength(8);
  for (const state of Object.values(paint.items)) expect(state.bg ?? state.gradient).toBeTruthy();
});

it('marks a Light selection with a pale accent and a Dark one with the full accent, from the workbook theme', () => {
  const light = builtIn('SlicerStyleLight1').items, dark = builtIn('SlicerStyleDark5').items;
  expect(light.selectedItemWithData.bg).toMatchObject({ theme: 4, tint: 0.6, base: '#4472c4' });
  expect(light.unselectedItemWithData.bg).toBe('#ffffff');
  expect(light.unselectedItemWithNoData.color).toBe('#828282');
  expect(dark.selectedItemWithData).toMatchObject({ bg: { theme: 8, base: '#5b9bd5', rgb: '#5b9bd5' }, color: { theme: 0 }, bold: true });
  expect(builtIn('SlicerStyleLight6').items.selectedItemWithData.bg).toMatchObject({ theme: 9 });
  expect(light.hoveredSelectedItemWithData.gradient.stops.map(s => s.color)).toEqual(['#f8e162', '#fcf7e0']);
  expect(builtInSlicerStyle('SlicerStyleLight7')).toBeNull();
});

function make() {
  const wb = new Workbook(), sheet = wb.activeSheet;
  [['Region', 'Value'], ['East', 1], ['West', 2]].forEach((row, r) => row.forEach((v, c) => wb.setInput(sheet.id, r, c, String(v))));
  wb.addTable(sheet.id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  wb.addChart(sheet.id, { type: 'slicer', tableRef: slicerTableReference('Sales', 'Region'), anchor: { r: 4, c: 3 }, w: 160, h: 120,
    paint: { frame: {}, items: { selectedItemWithData: { bg: '#654321' } } } });
  return wb;
}
async function edited(wb, edit) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const get = path => new TextDecoder().decode(X.CFB.find(zip, path).content);
  const set = (path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
  edit({ get, set });
  return workbookFromFile(new Uint8Array(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), 'edited.xlsx');
}
const slicer = wb => wb.sheets.flatMap(s => s.charts).find(c => c.type === 'slicer');
const slicerPart = get => ['/xl/slicers/slicer1.xml', '/xl/slicers/slicer2.xml'].find(p => { try { return get(p); } catch { return false; } });

it('opens a workbook whose slicer names a built-in style, or none, and draws it in that style', async () => {
  const named = await edited(make(), ({ get, set }) => { const p = slicerPart(get); set(p, get(p).replace(/style="[^"]*"/, 'style="SlicerStyleDark2"')); });
  expect(slicer(named).paint.items.selectedItemWithData).toMatchObject({ bg: { theme: 5 }, bold: true });
  const unnamed = await edited(make(), ({ get, set }) => { const p = slicerPart(get); set(p, get(p).replace(/ style="[^"]*"/, '')); });
  expect(slicer(unnamed).paint.items.selectedItemWithData.bg).toMatchObject({ theme: 4, tint: 0.6 });
});

it('opens a workbook whose slicer style cannot be drawn yet, drawing it in the default style', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const wb = await edited(make(), ({ get, set }) => {
    const xml = get('/xl/styles.xml'), edited = xml.replace('<patternFill><bgColor rgb="FF654321"/>', '<patternFill patternType="darkGrid"><bgColor rgb="FF654321"/>');
    expect(edited).not.toBe(xml);
    set('/xl/styles.xml', edited);
  });
  expect(slicer(wb).paint.items.selectedItemWithData.bg).toMatchObject({ theme: 4, tint: 0.6 });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

// A slicer over the Data Model has no worksheet PivotCache to bind to: the workbook opened
// nothing ("OLAP cache storage is not implemented"); its PivotTables keep their saved values.
it('leaves Data Model slicer caches out of the PivotTable model instead of refusing the workbook', () => {
  const pivots = { caches: [], tables: [] };
  expect(importNativePivotSlicerCaches({ caches: [{ kind: 'pivot', pivot: null, xml: '<olap/>' }] }, pivots, [])).toBe(pivots);
});
