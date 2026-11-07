import { expect, it } from 'vitest';
import { parseModelXml } from '../src/core/data-model-metadata.js';
import { readSlicerDrawing, slicerDrawingBounds } from '../src/core/slicer-drawing.js';
const D = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const S = 'http://schemas.microsoft.com/office/drawing/2010/slicer';
const M = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const V = 'http://schemas.microsoft.com/office/drawing/2012/slicer';
const frame = (name = 'Regions') => `<d:graphicFrame><d:nvGraphicFramePr><d:cNvPr id="19" name="Frame" descr="Filter by region"/></d:nvGraphicFramePr><a:graphic><a:graphicData uri="${S}"><s:slicer name="${name}"/></a:graphicData></a:graphic></d:graphicFrame>`;
const marker = (tag, r, c, dx = 0, dy = 0) => `<d:${tag}><d:col>${c}</d:col><d:colOff>${dx * 9525}</d:colOff><d:row>${r}</d:row><d:rowOff>${dy * 9525}</d:rowOff></d:${tag}>`;
const wrap = content => `<d:wsDr xmlns:d="${D}" xmlns:a="${A}" xmlns:s="${S}" xmlns:mc="${M}" xmlns:feature="${V}">${content}</d:wsDr>`;
const two = (content = frame(), editAs = 'twoCell') => `<d:twoCellAnchor editAs="${editAs}">${marker('from', 1, 2, 1.6, 2)}${marker('to', 4, 5, 3.6, 7)}${content}<d:clientData fPrintsWithSheet="0"/></d:twoCellAnchor>`;
const read = xml => readSlicerDrawing(parseModelXml(xml));
it('selects the supported Choice by namespace and excludes its stale fallback', () => {
  const xml = wrap(two(`<mc:AlternateContent><mc:Choice Requires="unknown" xmlns:unknown="urn:unsupported">${frame('Wrong')}</mc:Choice><mc:Choice Requires="feature">${frame()}</mc:Choice><mc:Fallback>${frame('Old')}</mc:Fallback></mc:AlternateContent>`));
  const [drawing] = read(xml); expect(read(xml)).toHaveLength(1);
  expect(drawing).toMatchObject({ name: 'Regions', shapeId: 19, description: 'Filter by region', print: false, hidden: false, grouped: false, editAs: 'twoCell',
    from: { r: 1, c: 2, dx: 1.6, dy: 2 }, to: { r: 4, c: 5, dx: 3.6, dy: 7 } });
  expect(drawing.xml).toContain(V);
  expect(slicerDrawingBounds(drawing, { defaultRowHeight: 20, defaultColWidth: 80, rowHeights: { 2: 40 }, colWidths: new Map([[3, 120]]), hiddenRows: [3], hiddenCols: [4] }))
    .toEqual({ anchor: { r: 1, c: 2 }, dx: 1.6, dy: 2, w: 202, h: 65 });
});
it('uses Fallback only when every Choice requires unsupported namespaces', () => {
  const [drawing] = read(wrap(two(`<mc:AlternateContent><mc:Choice Requires="feature other" xmlns:other="urn:no">${frame('Wrong')}</mc:Choice><mc:Fallback>${frame('Fallback')}</mc:Fallback></mc:AlternateContent>`)));
  expect(drawing.name).toBe('Fallback');
});
it('retains one-cell and absolute anchors without inventing extents from frame transforms', () => {
  const one = `<d:oneCellAnchor>${marker('from', 5, 6, -1, 2)}<d:ext cx="2857500" cy="1428750"/>${frame()}</d:oneCellAnchor>`;
  expect(slicerDrawingBounds(read(wrap(one))[0], {})).toEqual({ anchor: { r: 5, c: 6 }, dx: -1, dy: 2, w: 300, h: 150 });
  const absolute = `<d:absoluteAnchor><d:pos x="-9525" y="19050"/><d:ext cx="952500" cy="476250"/>${frame()}</d:absoluteAnchor>`;
  expect(slicerDrawingBounds(read(wrap(absolute))[0], {})).toEqual({ anchor: { r: 0, c: 0 }, anchorMode: 'absolute', dx: -1, dy: 2, w: 100, h: 50 });
  const fixed = read(wrap(two(frame(), 'absolute')))[0];
  expect(slicerDrawingBounds(fixed, { defaultRowHeight: 20, defaultColWidth: 80 })).toEqual({ anchor: { r: 0, c: 0 }, anchorMode: 'absolute', dx: 161.6, dy: 22, w: 242, h: 65 });
});
it('keeps grouped frames explicit instead of assigning the whole group rectangle', () => {
  const [drawing] = read(wrap(two(`<d:grpSp>${frame()}</d:grpSp>`)));
  expect(drawing.grouped).toBe(true); expect(drawing.xml).toContain('grpSp');
  expect(() => slicerDrawingBounds(drawing, {})).toThrow(/group transforms/);
});
it.each([
  ['<d:row>1</d:row>', '<d:row>1048576</d:row>'], ['<d:col>2</d:col>', '<d:col>-1</d:col>'],
  ['editAs="twoCell"', 'editAs="unknown"'], ['fPrintsWithSheet="0"', 'fPrintsWithSheet="yes"'],
  ['<d:row>4</d:row>', '<d:row>0</d:row>'], ['id="19"', 'id="1.5"'],
])('rejects invalid anchor metadata %s', (before, after) => { expect(() => read(wrap(two()).replace(before, after))).toThrow(/Invalid slicer drawing/); });
it('does not recognize a foreign slicer or a different graphic-data type', () => {
  expect(read(wrap(two()).replace(`xmlns:s="${S}"`, 'xmlns:s="urn:no"'))).toEqual([]);
  expect(read(wrap(two()).replace(`uri="${S}"`, 'uri="urn:no"'))).toEqual([]);
});
it('selects Office 2010 native pivot slicer frames without rendering their older-client fallback', () => {
  const xml = wrap(two(`<mc:AlternateContent xmlns:office="http://schemas.microsoft.com/office/drawing/2010/main"><mc:Choice Requires="office">${frame()}</mc:Choice><mc:Fallback>${frame('Fallback')}</mc:Fallback></mc:AlternateContent>`));
  expect(read(xml).map(drawing => drawing.name)).toEqual(['Regions']);
});
