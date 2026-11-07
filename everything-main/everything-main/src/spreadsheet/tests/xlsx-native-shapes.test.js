import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { normalizeNativeDrawing } from '../src/core/drawingml-native.js';
import { drawingGeometry } from '../src/core/drawingml-geometry.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content);
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx'), xml };
}
const svg = c => Buffer.from(c.src.split(',')[1], 'base64').toString();
const geometry = '<a:custGeom><a:avLst><a:gd name="inset" fmla="val 12000"/></a:avLst><a:gdLst><a:gd name="tip" fmla="*/ w inset 100000"/></a:gdLst><a:ahLst/><a:cxnLst><a:cxn ang="3cd4"><a:pos x="tip" y="t"/></a:cxn><a:cxn ang="cd4"><a:pos x="l" y="b"/></a:cxn></a:cxnLst><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path><a:moveTo><a:pt x="tip" y="0"/></a:moveTo><a:cubicBezTo><a:pt x="w" y="0"/><a:pt x="w" y="h"/><a:pt x="0" y="h"/></a:cubicBezTo><a:close/></a:path></a:pathLst></a:custGeom>';
const descendants = n => [n, ...n.children.flatMap(descendants)];

it.each([{ width: 73, height: 29, rotate: 31 }, { width: 184, height: 271, rotate: -47 }])('exports editable freeform paths, transforms and precise alpha: %j', async options => {
  let wb = await workbookFromFile(shapeXlsx({ ...options, geometry, text: '', opacity: 33333, stroke: true }), 'shape.xlsx');
  const original = wb.activeSheet.charts[0];
  expect(original.nativeDrawing).toBeTruthy();
  for (let pass = 0; pass < 3; pass++) {
    const result = await external(wb);
    expect(result.xml).toContain('<a:custGeom>');
    expect(result.xml).toContain('fmla="*/ w inset 100000"');
    expect(result.xml).toContain('<a:cxn ang="3cd4"><a:pos x="tip" y="t"/></a:cxn>');
    expect(result.xml).toContain('<a:cubicBezTo>');
    expect(result.xml).toContain('<a:alpha val="33333"/>');
    expect(result.xml).not.toContain('<xdr:pic>');
    // Re-export updates an existing group's transform, never wraps repeatedly.
    expect(result.xml.match(/<xdr:grpSp>/g)).toHaveLength(1);
    wb = result.wb;
    expect(wb.activeSheet.charts).toHaveLength(1);
    const back = wb.activeSheet.charts[0];
    const native = descendants(back.nativeDrawing.node).find(n => n.name === 'custGeom');
    expect(drawingGeometry(native, options.width, options.height).connections).toEqual([
      [options.width * .12, 0, 16200000], [0, options.height, 5400000],
    ]);
    for (const k of ['w', 'h', 'dx', 'dy', 'rotation']) expect(back[k]).toBeCloseTo(original[k], 3);
    expect(svg(back)).toContain('stroke="#000000"');
    expect(svg(back)).toContain('fill="#fff25455"');
  }
});

it('keeps preset geometry, theme-resolved rich text and Unicode editable through native reopen', async () => {
  const wb = await workbookFromFile(shapeXlsx({ text: 'Résumé & 日本語', preset: 'ellipse', width: 217, height: 134 }), 'text.xlsx');
  const { wb: back, xml } = await external(wb);
  expect(xml).toContain('<a:prstGeom prst="ellipse">');
  expect(xml).toContain('typeface="Georgia"');
  expect(xml).toContain('Résumé &amp; 日本語');
  expect(xml).not.toContain('+mj-lt');
  expect(svg(back.activeSheet.charts[0])).toContain('Résumé &amp; 日本語');
  expect(svg(back.activeSheet.charts[0])).toContain('font-family:Georgia');
  expect(svg(back.activeSheet.charts[0])).toContain('font-size:16px');
});

it('scales native shape viewports with resizing, duplication and undo, and discards stale geometry on image replacement', async () => {
  const wb = await workbookFromFile(shapeXlsx({ geometry, text: '', stroke: true }), 'resize.xlsx');
  const id = wb.activeSheetId, source = wb.activeSheet.charts[0];
  const copy = wb.duplicateChart(id, source.id);
  const twin = wb.activeSheet.charts.find(c => c.id === copy);
  expect(twin.nativeDrawing).toEqual(source.nativeDrawing);
  wb.updateChart(id, source.id, { w: 317.25, h: 91.5, rotation: 67, flipH: true });
  const edited = wb.activeSheet.charts[0];
  const { wb: back, xml } = await external(wb);
  const result = back.activeSheet.charts[0];
  expect(result.w).toBeCloseTo(edited.w, 3);
  expect(result.h).toBeCloseTo(edited.h, 3);
  expect(result.rotation).toBe(67);
  expect(result.flipH).toBe(true);
  expect(xml.match(/<a:custGeom>/g)).toHaveLength(2);
  const ids = [...xml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].map(m => m[1]);
  expect(new Set(ids).size).toBe(ids.length);
  wb.undo();
  expect(wb.activeSheet.charts[0]).toEqual(source);
  wb.updateChart(id, source.id, { src: 'data:image/png;base64,AA==' });
  expect(wb.activeSheet.charts[0].nativeDrawing).toBeUndefined();
  wb.undo();
  expect(wb.activeSheet.charts[0].nativeDrawing).toEqual(source.nativeDrawing);
});

it('bounds stored shape trees and rejects package-dependent or executable markup', async () => {
  const wb = await workbookFromFile(shapeXlsx(), 'safe.xlsx');
  const drawing = wb.activeSheet.charts[0].nativeDrawing;
  for (const bad of [
    { ...drawing, viewport: [0, 0, Infinity, 1] },
    { ...drawing, node: { name: 'script', attrs: {}, children: [] } },
    { ...drawing, node: { ...drawing.node, attrs: { 'r:embed': 'localRelationship' } } },
    { ...drawing, node: { ...drawing.node, children: Array(10001).fill({ name: 'pt', attrs: {}, children: [] }) } },
  ]) expect(normalizeNativeDrawing(bad)).toBeNull();
  expect(normalizeNativeDrawing(drawing)).toEqual(drawing);
});

it.each([{ width: 83, height: 21, props: 'anchor="t" wrap="none" horzOverflow="clip"' }, { width: 241, height: 47, props: 'anchor="b" vertOverflow="clip"' }])('retains native text overflow, wrapping and alignment independently of its rendered viewport: %j', async ({ width, height, props }) => {
  const zip = X.CFB.read(new Uint8Array(shapeXlsx({ width, height, text: 'Longer text outside a small frame' })), { type: 'array' });
  const drawing = X.CFB.find(zip, '/xl/drawings/shapes.xml');
  drawing.content = new TextEncoder().encode(new TextDecoder().decode(drawing.content).replace('anchor="ctr"', props));
  drawing.size = drawing.content.length;
  const wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
  const { wb: back, xml } = await external(wb);
  for (const attribute of props.split(' ')) expect(xml).toContain(attribute);
  expect(xml).not.toContain('<xdr:pic>');
  expect(back.activeSheet.charts[0]).toMatchObject({ w: width, h: height });
  expect(svg(back.activeSheet.charts[0])).toContain('Longer text outside a small frame');
});
