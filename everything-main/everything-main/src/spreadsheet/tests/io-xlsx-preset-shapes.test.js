import { expect, it } from 'vitest';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { shapeXlsx } from './helpers/xlsx-shape-fixture.js';

const svg = shape => Buffer.from(shape.src.split(',')[1], 'base64').toString('utf8');

it('imports a document logo with its curved outline, theme font and centered text, including after save/reopen', async () => {
  let wb = await workbookFromFile(shapeXlsx(), 'invoice.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0];
    expect(sheet.charts).toHaveLength(1);
    expect(sheet.charts[0]).toMatchObject({ type: 'image', drawingShape: true, anchor: { r: 0, c: 2 }, dx: 1, dy: 2, w: 100, h: 150, title: 'Invoice logo', border: false });
    const art = svg(sheet.charts[0]);
    expect(art).toContain(' C');
    expect(art).toContain('fill="#fff254"');
    expect(art).toContain('>LOGO</span>');
    expect(art).toContain('font-family:Georgia');
    expect(art).toContain('font-size:16px');
    expect(art).toContain('font-weight:700');
    expect(art).toContain('text-align:center');
    expect(art).toContain('justify-content:center');
    expect(art).not.toMatch(/NaN|Infinity|xdr:|a:prstGeom/);
    expect(wb.getValue(sheet.id, 1, 1)).toBe(10);
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.sheets[0];
  wb.setInput(sheet.id, 0, 1, '6');
  expect(wb.getValue(sheet.id, 1, 1)).toBe(12);
  wb.undo();
  expect(wb.getValue(sheet.id, 1, 1)).toBe(10);
  expect(svg(sheet.charts[0])).toContain('>LOGO</span>');
});

it('keeps Unicode and XML-like text literal, with separate run formatting and line breaks', async () => {
  const wb = await workbookFromFile(shapeXlsx({ run: '<a:r><a:rPr sz="1000" i="1"/><a:t>日本語 &amp; &lt;script&gt;</a:t></a:r><a:br/><a:r><a:rPr sz="1800" b="1" u="sng"/><a:t>Second line</a:t></a:r>' }), 'text.xlsx');
  const art = svg(wb.sheets[0].charts[0]);
  expect(art).toContain('日本語 &amp; &lt;script&gt;');
  expect(art).not.toContain('<script>');
  expect(art).toContain('font-style:italic');
  expect(art).toContain('font-size:24px');
  expect(art).toContain('text-decoration:underline');
  expect(art).toContain('</span><br/><span');
});

it('uses the workbook font size for captions without an explicit run size', async () => {
  const wb = await workbookFromFile(shapeXlsx({ run: '<a:r><a:rPr lang="en-US"/><a:t>Caption</a:t></a:r>' }));
  const art = svg(wb.sheets[0].charts[0]);
  // This fixture's workbook default is 12pt (16px), not PowerPoint's 18pt.
  expect(art.match(/font-size:16px/g)).toHaveLength(2);
  expect(art).not.toContain('font-size:24px');
});

it('sizes a caption line from its actual run rather than a larger empty paragraph end', async () => {
  const wb = await workbookFromFile(shapeXlsx({ run: '<a:r><a:rPr sz="1100"/><a:t>Small caption</a:t></a:r><a:endParaRPr sz="1800"/>' }));
  const art = svg(wb.sheets[0].charts[0]);
  expect(art.match(/font-size:14\.666666666666666px/g)).toHaveLength(2);
  expect(art).not.toContain('font-size:24px');
});

it('preserves small shape dimensions and rotation without applying image insertion minimums', async () => {
  const wb = await workbookFromFile(shapeXlsx({ preset: 'ellipse', width: 12, height: 8, rotate: 30, text: '' }), 'small.xlsx');
  expect(wb.sheets[0].charts[0]).toMatchObject({ rotation: 30, drawingShape: true });
  expect(wb.sheets[0].charts[0].w).toBeCloseTo(12);
  expect(wb.sheets[0].charts[0].h).toBeCloseTo(8);
  expect(svg(wb.sheets[0].charts[0])).toMatch(/A[\d.]+ [\d.]+ 0 0 1/);
});

it('rejects invalid guide expressions and unknown presets without dropping the sheet data', async () => {
  for (const options of [{ preset: 'notAShape' }, { geometry: '<a:custGeom><a:gdLst><a:gd name="x" fmla="eval globalThis.bad()"/></a:gdLst><a:pathLst><a:path><a:moveTo><a:pt x="x" y="0"/></a:moveTo></a:path></a:pathLst></a:custGeom>' }]) {
    const wb = await workbookFromFile(shapeXlsx(options), 'invalid.xlsx');
    expect(wb.sheets[0].charts).toHaveLength(0);
    expect(wb.getValue(wb.activeSheetId, 1, 1)).toBe(10);
  }
});

it('retains fill transparency instead of replacing it with an opaque theme fill', async () => {
  for (const [opacity, fill] of [[50000, 'fill="#fff25480"'], [0, null]]) {
    const wb = await workbookFromFile(shapeXlsx({ opacity }), 'transparent.xlsx');
    const art = svg(wb.sheets[0].charts[0]);
    if (fill) expect(art).toContain(fill);
    else expect(art).not.toContain('<path');
    expect(art).toContain('>LOGO</span>');
  }
});

it('draws open marker outlines above their filled hit-test rectangle', async () => {
  const wb = await workbookFromFile(shapeXlsx({ preset: 'chartPlus', text: '', stroke: true }), 'marker.xlsx');
  const art = svg(wb.sheets[0].charts[0]);
  expect(art).toContain('M476250 0 L476250 1428750 M0 714375 L952500 714375');
  expect(art.lastIndexOf('stroke="#000000"')).toBeGreaterThan(art.indexOf('fill="#fff254"'));
});
