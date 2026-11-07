import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { Workbook } from '../src/core/workbook.js';
import {
  buildStroke, buildShape, recognizeShape, isInk, inkLines, touchesLines, insideLasso, nextName, penLabel, normalizePen, simplify, convexHull,
} from '../src/core/ink.js';

const svgUrl = svg => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const pen = { kind: 'pen', color: '#e71224', width: 1 };
const wave = Array.from({ length: 40 }, (_, i) => ({ x: 20 + i * 4, y: 50 + Math.sin(i / 4) * 20 }));
function addInk(wb, built, title = 'Ink 1', at = { r: 1, c: 1 }) {
  return wb.addChart(wb.activeSheetId, { type: 'image', src: svgUrl(built.svg), title, anchor: at, dx: 3, dy: 4, w: built.box.w, h: built.box.h,
    border: false, drawingShape: true, nativeDrawing: built.nativeDrawing });
}
async function external(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/drawings/drawing1.xml').content);
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx'), xml };
}

it('builds a stroke as a freeform with the pen colour and width, inside a box padded by the line', () => {
  const s = buildStroke(wave, pen);
  expect(s.box.x).toBeLessThan(20);
  expect(s.box.w).toBeGreaterThan(156);
  expect(s.svg).toContain('stroke="#e71224"');
  expect(s.svg).toContain('stroke-linecap="round"');
  const sp = s.nativeDrawing.node;
  expect(sp.name).toBe('sp');
  const spPr = sp.children[0];
  expect(spPr.children.map(c => c.name)).toEqual(['xfrm', 'custGeom', 'noFill', 'ln']);
  const ln = spPr.children[3];
  expect(ln.attrs).toMatchObject({ w: 36000, cap: 'rnd' });
  expect(ln.children[0].children[0].attrs.val).toBe('E71224');
  expect(s.nativeDrawing.viewport).toEqual([0, 0, Math.round(s.box.w * 9525), Math.round(s.box.h * 9525)]);
});

it('draws the highlighter half transparent with square ends, and a pressure stroke as a filled outline', () => {
  const h = buildStroke(wave, { kind: 'highlighter', color: '#ffff00', width: 6 });
  const ln = h.nativeDrawing.node.children[0].children[3];
  expect(ln.attrs.cap).toBe('sq');
  expect(ln.children[0].children[0].children[0]).toMatchObject({ name: 'alpha', attrs: { val: 50000 } });
  expect(h.svg).toContain('stroke-opacity="0.5"');
  const pressed = buildStroke(wave.map((p, i) => ({ ...p, pressure: 0.2 + i / 60 })), pen, { pressure: true });
  const spPr = pressed.nativeDrawing.node.children[0];
  expect(spPr.children.map(c => c.name)).toEqual(['xfrm', 'custGeom', 'solidFill', 'ln']);
  expect(spPr.children[3].children[0].name).toBe('noFill');
  expect(pressed.svg).toContain('fill="#e71224"');
  expect(buildStroke([{ x: 5, y: 5 }], pen).box.w).toBeGreaterThan(3);
});

it('names pens by colour and width and reads stored pens safely', () => {
  expect(penLabel({ kind: 'pen', color: '#000000', width: 0.5 })).toBe('Pen: Black, 0.5 mm');
  expect(penLabel({ kind: 'highlighter', color: '#ffff00', width: 6 })).toBe('Highlighter: Yellow, 6 mm');
  expect(normalizePen({ kind: 'marker', color: '#000000' })).toBeNull();
  expect(normalizePen({ kind: 'highlighter', color: '#FFFF00', width: 99 })).toMatchObject({ color: '#ffff00', width: 6 });
  expect(nextName([{ title: 'Ink 1' }, { title: 'Ink 7' }, { title: 'Rectangle 2' }], 'Ink')).toBe('Ink 8');
  expect(simplify([{ x: 0, y: 0 }, { x: 1, y: 0.01 }, { x: 2, y: 0 }])).toHaveLength(2);
  expect(convexHull([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 2 }])).toHaveLength(4);
});

const jitter = (pts, n = 1.5) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * n, y: p.y + Math.cos(i * 2.3) * n }));
const along = (corners, per = 15) => corners.flatMap((a, i) => {
  const b = corners[(i + 1) % corners.length];
  return Array.from({ length: per }, (_, k) => ({ x: a.x + (b.x - a.x) * k / per, y: a.y + (b.y - a.y) * k / per }));
}).concat([{ ...corners[0] }]);

it('recognises roughly drawn lines, rectangles, ellipses and triangles, and leaves writing as ink', () => {
  expect(recognizeShape(jitter(Array.from({ length: 30 }, (_, i) => ({ x: 10 + i * 5, y: 40 + i * 2 })), 1))).toMatchObject({ kind: 'line' });
  const rect = recognizeShape(jitter(along([{ x: 10, y: 10 }, { x: 150, y: 10 }, { x: 150, y: 90 }, { x: 10, y: 90 }])));
  expect(rect.kind).toBe('rect');
  expect(rect.box.w).toBeGreaterThan(135);
  const ellipse = recognizeShape(jitter(Array.from({ length: 60 }, (_, i) => ({ x: 100 + 70 * Math.cos(i / 59 * 2 * Math.PI), y: 60 + 40 * Math.sin(i / 59 * 2 * Math.PI) }))));
  expect(ellipse.kind).toBe('ellipse');
  const tri = recognizeShape(jitter(along([{ x: 80, y: 10 }, { x: 150, y: 120 }, { x: 10, y: 120 }])));
  expect(tri.kind).toBe('triangle');
  expect(recognizeShape(wave)).toBeNull();
  expect(recognizeShape([{ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 5, y: 1 }, { x: 6, y: 6 }])).toBeNull();
  const shape = buildShape(rect, pen);
  expect(shape.nativeDrawing.node.children[0].children[1]).toMatchObject({ name: 'prstGeom', attrs: { prst: 'rect' } });
  expect(shape.svg).toContain('<rect');
});

it('reads an ink object back as lines for the eraser and the lasso, at its current size', () => {
  const wb = new Workbook();
  const built = buildStroke(wave, pen);
  const id = addInk(wb, built);
  const obj = wb.chartById(wb.activeSheetId, id);
  expect(isInk(obj)).toBe(true);
  expect(isInk({ ...obj, title: 'Rectangle 1' })).toBe(false);
  const lines = inkLines(obj);
  expect(lines).toHaveLength(1);
  const first = lines[0].points[0];
  expect(first.x).toBeCloseTo(20 - built.box.x, 1);
  expect(first.y).toBeCloseTo(50 - built.box.y, 1);
  expect(touchesLines(lines, { x: first.x + 2, y: first.y }, 2)).toBe(true);
  expect(touchesLines(lines, { x: first.x, y: first.y + 40 }, 2)).toBe(false);
  // Resized to twice the width, the lines follow.
  const wide = inkLines({ ...obj, w: obj.w * 2 });
  expect(wide[0].points.at(-1).x).toBeCloseTo(lines[0].points.at(-1).x * 2, 1);
  expect(insideLasso(lines, [{ x: -5, y: -5 }, { x: obj.w + 5, y: -5 }, { x: obj.w + 5, y: obj.h + 5 }, { x: -5, y: obj.h + 5 }])).toBe(true);
  expect(insideLasso(lines, [{ x: -5, y: -5 }, { x: 20, y: -5 }, { x: 20, y: obj.h + 5 }, { x: -5, y: obj.h + 5 }])).toBe(false);
});

it('saves ink as a freeform shape Excel opens, and reads it back as ink that undoes and erases', async () => {
  const wb = new Workbook();
  const id = addInk(wb, buildStroke(wave, pen));
  addInk(wb, buildStroke(wave, { kind: 'highlighter', color: '#ffff00', width: 6 }), 'Ink 2', { r: 6, c: 2 });
  addInk(wb, buildShape(recognizeShape(jitter(along([{ x: 10, y: 10 }, { x: 150, y: 10 }, { x: 150, y: 90 }, { x: 10, y: 90 }]))), pen), 'Rectangle 3', { r: 10, c: 0 });
  wb.updateChart(wb.activeSheetId, id, { w: wb.chartById(wb.activeSheetId, id).w * 1.5 }, 'Resize');
  const { wb: back, xml } = await external(wb);
  expect(xml.match(/<xdr:sp>/g)).toHaveLength(3);
  expect(xml).not.toContain('<xdr:grpSp>');
  expect(xml).not.toContain('<xdr:pic>');
  expect(xml).toContain('<xdr:cNvPr id="1" name="Ink 1"');
  expect(xml).toContain('<a:ln w="36000" cap="rnd"><a:solidFill><a:srgbClr val="E71224"/></a:solidFill><a:round/></a:ln>');
  expect(xml).toContain('<a:alpha val="50000"/>');
  expect(xml).toContain('<a:prstGeom prst="rect">');
  expect(xml).toMatch(/<a:path w="\d+" h="\d+" fill="none"><a:moveTo><a:pt x="\d+" y="\d+"\/><\/a:moveTo><a:cubicBezTo>/);
  const charts = back.activeSheet.charts;
  expect(charts.map(c => c.title)).toEqual(['Ink 1', 'Ink 2', 'Rectangle 3']);
  expect(charts.filter(isInk)).toHaveLength(2);
  const original = wb.chartById(wb.activeSheetId, id);
  for (const k of ['w', 'h']) expect(charts[0][k]).toBeCloseTo(original[k], 0);
  expect(charts[0].anchor).toEqual(original.anchor);
  expect(inkLines(charts[0])[0].points.length).toBeGreaterThan(3);
  // A second round trip keeps the freeform a shape.
  const again = await external(back);
  expect(again.xml).toContain('name="Ink 1"');
  // Ink stays a freeform; the rectangle, whose outline overhangs its frame when read back, keeps that overhang in a group.
  expect(again.xml.match(/<xdr:grpSp>/g)).toHaveLength(1);
  expect(again.xml).toMatch(/name="Ink 1"[^]*?<\/xdr:nvSpPr>/);
  expect(again.wb.activeSheet.charts.filter(isInk)).toHaveLength(2);
  wb.undo();
  expect(wb.chartById(wb.activeSheetId, id).w).toBeCloseTo(original.w / 1.5, 3);
});

it('keeps ink through the app\'s own save and reopen, and through its JSON draft', async () => {
  const wb = new Workbook();
  addInk(wb, buildStroke(wave, pen));
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'own.xlsx');
  const [ink] = back.activeSheet.charts;
  expect(isInk(ink)).toBe(true);
  expect(inkLines(ink)[0].points.length).toBeGreaterThan(3);
  const draft = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
  expect(draft.activeSheet.charts.filter(isInk)).toHaveLength(1);
});
