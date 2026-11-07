import { expect, it } from 'vitest';
import { readNativePivotStyle, nativePivotStyleLayers } from '../src/core/native-pivot-style.js';
import { readNativePivotPaint, nativePivotPaintLayers, nativePivotPaintAt } from '../src/core/native-pivot-paint.js';
import { fixture, nativeRoundTrip } from './helpers/linked-model-workbook.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const pivot = name => ({ xml: `<pivotTableDefinition xmlns="${MAIN}"><pivotTableStyleInfo name="${name}" showColHeaders="1"/></pivotTableDefinition>` });
const themes = { themeElements: { clrScheme: ['FFFFFF', '000000', 'EEECE1', '1F497D', '4F81BD', 'C0504D', '9BBB59', '8064A2', '4BACC6', 'F79646'].map(rgb => ({ rgb })) } };
const names = ['Light', 'Medium', 'Dark'].flatMap(family => Array.from({ length: 28 }, (_, n) => `PivotStyle${family}${n + 1}`));

it('resolves all 84 built-in definitions with paintable, namespaced differential formats', () => {
  for (const name of names) {
    const style = readNativePivotStyle(pivot(name), {});
    expect(style.name).toBe(name);
    expect(style.elements.length).toBeGreaterThan(0);
    expect(new Set(style.elements.map(e => e.type)).size).toBe(style.elements.length);
    for (const part of style.elements) if (part.dxf) expect(() => readNativePivotPaint(part.dxf, themes)).not.toThrow();
  }
});

it('uses built-in definitions for name-only declarations without borrowing workbook DXF indices', () => {
  const name = 'PivotStyleMedium9', p = pivot(name);
  const native = { styles: [{ name, xml: `<tableStyle xmlns="${MAIN}" name="${name}" count="0"/>` }], dxfs: ['bad workbook dxf'] };
  expect(readNativePivotStyle(p, native)).toEqual(readNativePivotStyle(p, {}));
});

it('keeps explicit definitions and their workbook-local differential formats authoritative', () => {
  const name = 'PivotStyleLight20', dxf = `<dxf xmlns="${MAIN}"><font><i/></font></dxf>`;
  const style = readNativePivotStyle(pivot(name), { styles: [{ name, xml: `<tableStyle xmlns="${MAIN}" name="${name}"><tableStyleElement type="wholeTable" dxfId="0"/></tableStyle>` }], dxfs: [dxf] });
  expect(style.elements).toEqual([{ type: 'wholeTable', size: 1, dxf }]);
});

it('does not let preset fallback hide duplicate or malformed workbook declarations', () => {
  const name = 'PivotStyleDark4', p = pivot(name);
  const style = { name, xml: `<tableStyle xmlns="${MAIN}" name="${name}"/>` };
  expect(() => readNativePivotStyle(p, { styles: [style, style] })).toThrow(/ambiguous/);
  expect(() => readNativePivotStyle(p, { styles: [{ ...style, xml: '' }] })).toThrow();
  expect(() => readNativePivotStyle(p, { styles: [{ ...style, xml: style.xml.replace('/>', ' count="2"/>') }] })).toThrow(/count/);
  expect(() => readNativePivotStyle(p, { styles: [{ ...style, xml: style.xml.replace('/>', ' pivot="0"/>') }] })).toThrow(/definition/);
});

it.each(['PivotStyleLight0', 'PivotStyleDark29', 'pivotstylelight1', 'TableStyleMedium9', '__proto__', 'constructor'])('rejects unknown preset %s', name => {
  expect(() => readNativePivotStyle(pivot(name), {})).toThrow(/Missing pivot style/);
});

it('retains normative theme identities, tints and border placement without hardcoded rendered colors', () => {
  const style = readNativePivotStyle(pivot('PivotStyleLight20'), {});
  const header = style.elements.find(e => e.type === 'headerRow');
  expect(header.dxf).toContain('theme="8" tint="0.79998168889431442"');
  const range = { r1: 3, c1: 5, r2: 3, c2: 9 };
  const native = nativePivotStyleLayers(style, [{ type: 'headerRow', range }]);
  const first = nativePivotPaintAt(nativePivotPaintLayers(native, themes), 3, 7);
  const changed = structuredClone(themes); changed.themeElements.clrScheme[8].rgb = 'FF0000';
  const second = nativePivotPaintAt(nativePivotPaintLayers(native, changed), 3, 7);
  expect(first).toMatchObject({ bold: true, bb: true, bbBorder: { bs: 'thin' } });
  expect(second.bg).not.toEqual(first.bg);
  expect(second.bbBorder.bc).not.toEqual(first.bbBorder.bc);
  expect(second.color).toEqual(first.color);
});

it('does not share mutable style descriptors between workbooks', () => {
  const p = pivot('PivotStyleLight1'), before = readNativePivotStyle(p, {});
  const changed = readNativePivotStyle(p, {}); changed.elements[0].dxf = 'changed'; changed.options.showColHeaders = false;
  expect(readNativePivotStyle(p, {})).toEqual(before);
});

it('resolves the same built-in style after native XLSX cycles and report-sheet extraction', async () => {
  let wb = fixture();
  wb.nativePivots.tables[0].xml = wb.nativePivots.tables[0].xml.replace('</pivotTableDefinition>', '<pivotTableStyleInfo name="PivotStyleDark12" showColHeaders="1"/></pivotTableDefinition>');
  const expected = readNativePivotStyle(wb.nativePivots.tables[0], wb.nativePivots);
  for (let i = 0; i < 2; i++) {
    wb = await nativeRoundTrip(wb);
    expect(readNativePivotStyle(wb.nativePivots.tables[0], wb.nativePivots)).toEqual(expected);
  }
  const copy = await nativeRoundTrip(wb.sheetToWorkbook(wb.sheetByName('Report').id, { sourceWorkbook: '/Styles.xlsx' }));
  expect(readNativePivotStyle(copy.nativePivots.tables[0], copy.nativePivots)).toEqual(expected);
});
