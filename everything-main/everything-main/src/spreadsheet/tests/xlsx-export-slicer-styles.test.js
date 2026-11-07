import { expect, it } from 'vitest';
import { appendSlicerStyles, slicerPaintXml } from '../src/core/xlsx-export-slicer-styles.js';
import { readSlicerPaint, resolveSlicerPaint } from '../src/core/slicer-paint.js';
import { readSlicerStyles } from '../src/core/slicer-styles.js';
import { modelChildren, parseModelXml } from '../src/core/data-model-metadata.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const sheet = body => `<styleSheet xmlns="${MAIN}">${body}</styleSheet>`;
const children = (node, name, ns = MAIN) => modelChildren(node, name, ns);
const gradient = { type: 'linear', degree: -90, stops: [{ position: 0, color: '#123456' }, { position: .5, color: '#abcdef' }, { position: .5, color: '#654321' }] };

it('preserves a themed solid slicer fill while resolving its display paint', () => {
  const paint = { bg: { theme: 4, base: '#286844', rgb: '#286844' } };
  const xml = slicerPaintXml(paint, { theme: [null, null, null, null, '#286844'] });
  expect(xml).toContain('<bgColor theme="4"/>');
  expect(readSlicerPaint(xml, { themeElements: { clrScheme: [null, null, null, null, { rgb: '286844' }] } }).bg).toEqual(paint.bg);
});

it('round trips gradient geometry, duplicate stops and explicit font/border clears', () => {
  const paint = { bold: false, italic: true, strike: false, size: 0, underline: 'double', gradient,
    bl: false, br: true, brBorder: { bs: 'double', bc: '#654321' } };
  const result = readSlicerPaint(slicerPaintXml(paint));
  expect(result).toMatchObject(paint);
  expect(result.blBorder).toBeNull();
  expect(readSlicerPaint(slicerPaintXml({}))).toEqual({});
  expect(readSlicerPaint(slicerPaintXml({ bg: 'transparent', underline: 'none' }))).toEqual({ bg: 'transparent', underline: 'none' });
});
it('serializes path geometry and solid differential backgrounds', () => {
  const path = { ...gradient, type: 'path', left: .1, right: .6, top: .2, bottom: .8 }; delete path.degree;
  expect(readSlicerPaint(slicerPaintXml({ gradient: path })).gradient).toEqual(path);
  expect(readSlicerPaint(slicerPaintXml({ bg: '#123456' })).bg).toBe('#123456');
});
it('keeps compatible theme font identity and projects foreign palettes to RGB', () => {
  const color = { theme: 4, base: '#123456', rgb: '#123456' };
  const xml = slicerPaintXml({ color }, { theme: [null, null, null, null, '#123456'] });
  expect(xml).toContain('theme="4"');
  expect(slicerPaintXml({ color })).toContain('rgb="FF123456"');
  expect(slicerPaintXml({ color: 'windowtext' })).toContain('auto="1"');
});
it('escapes font names and serializes all six edges in schema order', () => {
  const xml = slicerPaintXml({ font: 'A & B', bl: true, br: true, bt: true, bb: true, bv: true, bh: false, bs: 'dotted', bc: '#abcdef' });
  expect(xml).toContain('A &amp; B');
  const root = parseModelXml(xml), border = children(root, 'border')[0];
  expect(Array.from(border.childNodes).map(n => n.localName)).toEqual(['left', 'right', 'top', 'bottom', 'vertical', 'horizontal']);
});
it('appends both DXF collections without changing existing indexes, style names or extensions', () => {
  const source = sheet(`<dxfs count="1"><dxf><font><b/></font></dxf></dxfs><tableStyles count="1" defaultTableStyle="TableStyleMedium2"><tableStyle name="puterslicerstyle1" table="1"/></tableStyles><colors/><extLst><ext uri="other"><other xmlns="urn:other"/></ext></extLst>`);
  const paint = { frame: { wholeTable: { bg: '#abcdef' }, headerRow: { bold: true } }, items: { selectedItemWithData: { gradient }, hoveredSelectedItemWithData: { bold: false } } };
  const result = appendSlicerStyles(source, [paint, paint, { frame: {}, items: { selectedItemWithData: { gradient } } }]);
  expect(result.names).toEqual(['PuterSlicerStyle2', 'PuterSlicerStyle2', 'PuterSlicerStyle3']);
  const root = parseModelXml(result.xml), parsed = readSlicerStyles(root, result.names);
  expect(resolveSlicerPaint(parsed.styles[0])).toMatchObject(paint);
  expect(result.xml).toContain('defaultTableStyle="TableStyleMedium2"');
  expect(result.xml).toContain('uri="other"');
  expect(children(children(root, 'dxfs')[0], 'dxf')[0].textContent).toBe('');
  expect(children(children(children(root, 'dxfs')[0], 'dxf')[0], 'font')).toHaveLength(1);
  const ext = children(children(root, 'extLst')[0], 'ext').flatMap(n => children(n, 'dxfs', X14))[0];
  expect(children(ext, 'dxf')).toHaveLength(2);
  expect(ext.getAttribute('count')).toBe('2');
  const definitions = children(children(root, 'extLst')[0], 'ext').flatMap(n => children(n, 'slicerStyles', X14))[0];
  for (const style of children(definitions, 'slicerStyle', X14)) {
    expect(children(style, 'slicerStyleElements', X14)[0].hasAttribute('count')).toBe(false);
  }
  expect(children(root, 'tableStyles')[0].getAttribute('count')).toBe('3');
});
it('handles prefixed style sheets, absent sections and repeated append operations', () => {
  const paint = { frame: { wholeTable: {} }, items: { unselectedItemWithNoData: { bg: 'transparent' } } };
  const first = appendSlicerStyles(`<m:styleSheet xmlns:m="${MAIN}"><m:fonts count="0"/><m:colors/></m:styleSheet>`, [paint]);
  const second = appendSlicerStyles(first.xml, [paint]);
  expect(second.names).toEqual(['PuterSlicerStyle2']);
  const root = parseModelXml(second.xml);
  expect(Array.from(root.childNodes).map(n => n.localName)).toEqual(['fonts', 'dxfs', 'tableStyles', 'colors', 'extLst']);
  const styles = readSlicerStyles(root, [...first.names, ...second.names]).styles;
  expect(styles.map(s => resolveSlicerPaint(s))).toEqual([paint, paint]);
});
it('does not change a workbook with no slicer styles and rejects invalid inputs', () => {
  expect(appendSlicerStyles('untouched', [])).toEqual({ xml: 'untouched', names: [] });
  const empty = appendSlicerStyles(sheet(''), [{}]);
  expect(empty.xml).not.toContain('slicerStyleElements');
  expect(readSlicerStyles(parseModelXml(empty.xml), empty.names).styles[0].items).toEqual({});
  expect(() => appendSlicerStyles(sheet(''), [null])).toThrow(/Missing slicer paint/);
  expect(() => appendSlicerStyles('<other/>', [{}])).toThrow(/Invalid slicer styles part/);
  expect(() => appendSlicerStyles(sheet('<dxfs/><dxfs/>'), [{}])).toThrow(/Ambiguous/);
  expect(() => slicerPaintXml({ gradient: { ...gradient, stops: [{ position: 2, color: '#123456' }] } })).toThrow(/Invalid stored/);
});
