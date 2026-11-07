import { expect, it } from 'vitest';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import { readSlicerStyles } from '../src/core/slicer-styles.js';
const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', X = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const xml = `<styleSheet xmlns="${M}" xmlns:q="${X}"><dxfs count="1"><dxf><font><color rgb="FF112233"/></font></dxf></dxfs><tableStyles><tableStyle name="Custom" table="0" pivot="false"><tableStyleElement type="wholeTable" dxfId="0"/><tableStyleElement type="headerRow"/></tableStyle></tableStyles><extLst><ext><q:dxfs count="1"><dxf><fill><gradientFill degree="90"><stop position="0"><color theme="4"/></stop><stop position="1"><color rgb="FFFFFFFF"/></stop></gradientFill></fill></dxf></q:dxfs></ext><ext><q:slicerStyles defaultSlicerStyle="Custom"><q:slicerStyle name="Custom"><q:slicerStyleElements><q:slicerStyleElement type="selectedItemWithData" dxfId="0"/><q:slicerStyleElement type="unselectedItemWithData"/></q:slicerStyleElements></q:slicerStyle></q:slicerStyles></ext></extLst></styleSheet>`;
const read = (text = xml, names = ['Custom']) => readSlicerStyles(parseModelXml(text), names);
it('resolves frame and item style IDs in their distinct namespaces and preserves gradient/theme data', () => {
  const result = read(), style = result.styles[0]; expect(result.defaultStyle).toBe('Custom'); expect(style.builtIn).toBe(false);
  expect(style.frame.wholeTable).toContain('FF112233'); expect(style.frame.headerRow).toBeNull();
  expect(style.items.selectedItemWithData).toContain('gradientFill'); expect(style.items.selectedItemWithData).toContain('theme="4"');
  expect(style.items.selectedItemWithData).not.toContain('FF112233'); expect(style.items.unselectedItemWithData).toBeNull();
  expect(style.tableXml).toContain('wholeTable'); expect(style.slicerXml).toContain('selectedItemWithData');
});
it('resolves the default, preserves explicit built-in selection, and does not invent definitions', () => {
  expect(read(xml, [null]).styles[0].name).toBe('Custom');
  expect(readSlicerStyles(null, ['SlicerStyleDark6', 'SlicerStyleOther2', null])).toEqual({ defaultStyle: null, styles: [{ name: 'SlicerStyleDark6', builtIn: true }, { name: 'SlicerStyleOther2', builtIn: true }] });
  expect(() => read(xml, ['SlicerStyleDark7'])).toThrow(/missing definition/);
  expect(() => read(xml, ['Not installed'])).toThrow(/missing definition/);
});
it.each([
  ['type="wholeTable" dxfId="0"', 'type="wholeTable" dxfId="1"'],
  ['type="selectedItemWithData" dxfId="0"', 'type="selectedItemWithData" dxfId="1"'],
  ['type="unselectedItemWithData"', 'type="selectedItemWithData"'],
  ['type="unselectedItemWithData"', 'type="imaginary"'],
  ['type="headerRow"', 'type="wholeTable"'],
  ['pivot="false"', 'pivot="true"'], ['table="0"', 'table="1"'],
  ['defaultSlicerStyle="Custom"', 'defaultSlicerStyle=""'],
  ['<tableStyle name="Custom"', '<tableStyle name="Other"'],
  ['dxfId="0"', 'dxfId="NaN"'],
])('rejects inconsistent custom style metadata %s', (before, after) => { expect(() => read(xml.replace(before, after))).toThrow(/Invalid slicer style/); });
it('rejects duplicate collections instead of merging unrelated style indexes', () => {
  expect(() => read(xml.replace('<dxfs count="1">', '<dxfs/><dxfs count="1">'))).toThrow(/ambiguous dxfs/);
  expect(() => read(xml.replace('<q:dxfs count="1">', '<q:dxfs/><q:dxfs count="1">'))).toThrow(/ambiguous extended dxfs/);
});
