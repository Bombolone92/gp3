import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { bubbleXlsx } from './helpers/xlsx-bubble-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';
const decode = part => new TextDecoder().decode(part.content);
async function native(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(decode(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const path = zip.FullPaths.find(p => /\/charts\/chart[^/]+\.xml$/.test(p));
  expect(path).toBeTruthy();
  const xml = decode(X.CFB.find(zip, path));
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  expect(doc.getElementsByTagName(wb.sheets[0].charts[0].type === 'bubble' ? 'c:bubbleChart' : 'c:barChart')).toHaveLength(wb.sheets[0].charts.length ? 1 : 0);
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), xml, zip, doc };
}
const data = wb => chartData(wb, wb.sheets[0].id, wb.sheets[0].charts[0]);
it.each([false, true])('retains full bubble artwork and editable data through two native-only cycles, references=%s', async referenced => {
  let wb = await workbookFromFile(bubbleXlsx({ referenced }));
  const expected = data(wb).series.map(s => [s.x, s.values, s.sizes]);
  const before = wb.sheets[0].charts[0].appearance;
  const literals = wb.sheets[0].charts[0].sourceRefs.map(s => s.literal);
  for (let i = 0; i < 2; i++) {
    const result = await native(wb); wb = result.wb;
    const chart = wb.sheets[0].charts[0], ap = chart.appearance;
    expect(chart.type).toBe('bubble');
    expect(data(wb).series.map(s => [s.x, s.values, s.sizes])).toEqual(expected);
    expect(ap.bubble).toEqual(before.bubble);
    if (!referenced) expect(chart.sourceRefs.map(s => s.literal)).toEqual(literals);
    expect(ap.annotations).toEqual(before.annotations);
    expect(result.doc.getElementsByTagName('c:errBars')).toHaveLength(6);
    expect(result.doc.getElementsByTagName('a:gradFill')).toHaveLength(3);
    const svg = new JSDOM(renderChartSvg(data(wb), chart, 600, 450)).window.document;
    expect(svg.querySelectorAll('.chart-bubble')).toHaveLength(7);
    expect(svg.querySelectorAll('.chart-error-bar')).toHaveLength(14);
    expect(svg.querySelectorAll('.chart-data-label')).toHaveLength(7);
    expect(svg.querySelector('.chart-annotation').textContent).toContain('Standard error');
  }
});
it('keeps references live after native reopening and omitted-sheet copy', async () => {
  const wb = (await native(await workbookFromFile(bubbleXlsx({ referenced: true })))).wb;
  wb.setInput(wb.sheets[1].id, 0, 3, 11);
  expect(data(wb).series[0].values[0]).toBe(11);
  const copy = wb.sheetToWorkbook(wb.sheets[0].id, { sourceWorkbook: '/Source.xlsx' });
  const restored = (await native(copy)).wb;
  expect(data(restored).series[0].values[0]).toBe(11);
  expect(restored.sheets[0].charts[0].appearance.annotations).toHaveLength(1);
});
it.each(['stdErr', 'stdDev', 'percentage', 'fixedVal'])('exports %s error bars, direction, caps and styles', async type => {
  const wb = await workbookFromFile(bubbleXlsx());
  const bar = { type, direction: 'minus', value: 2.5, caps: false, color: '#123456', width: 2 };
  wb.sheets[0].charts[0].errorBars = [{ x: bar }];
  const result = await native(wb);
  expect(result.wb.sheets[0].charts[0].errorBars[0]).toEqual({ x: { ...bar, value: type === 'stdErr' ? 1 : 2.5 } });
});
it('preserves scaling, negative bubbles, size mode, hidden labels and label fields', async () => {
  const wb = await workbookFromFile(bubbleXlsx());
  const bubble = wb.sheets[0].charts[0].appearance.bubble;
  Object.assign(bubble, { scale: 180, sizeRepresents: 'w', showNegative: true });
  Object.assign(bubble.series[0].labels, { value: false, size: true, category: true, series: true, position: 'r', points: [{ index: 1, hidden: true }] });
  const restored = (await native(wb)).wb.sheets[0].charts[0].appearance.bubble;
  expect(restored).toEqual(bubble);
});
it('writes chart annotation relationships, escaped multiline text and relative placement', async () => {
  const wb = await workbookFromFile(bubbleXlsx());
  wb.sheets[0].charts[0].appearance.annotations = [{ text: 'A & B < C\nSecond line', box: { x: .1, y: .2, w: .3, h: .4 },
    style: { font: 'arial', size: 18, bold: true, italic: true, color: '#123456' }, align: 'right', fill: '#aabbcc', stroke: '#334455' }];
  const result = await native(wb), note = result.wb.sheets[0].charts[0].appearance.annotations[0];
  expect(note.text).toBe('A & B < C\nSecond line');
  expect(note.style).toEqual(wb.sheets[0].charts[0].appearance.annotations[0].style);
  expect(note).toMatchObject({ align: 'right', fill: '#aabbcc', stroke: '#334455' });
  expect(note.box.w).toBeCloseTo(.3); expect(note.box.h).toBeCloseTo(.4);
  const rel = decode(X.CFB.find(result.zip, '/xl/charts/_rels/chart1_1.xml.rels'));
  expect(rel).toContain('/chartUserShapes');
  const contentTypes = decode(X.CFB.find(result.zip, '/[Content_Types].xml'));
  expect(contentTypes).toContain('drawingml.chartshapes+xml');
});

it('keeps ordinary annotated charts editable and uses the renderer defaults for omitted annotation dimensions', async () => {
  const wb = await workbookFromFile(bubbleXlsx());
  const raw = wb.sheets[0].charts[0];
  delete raw.appearance.bubble;
  wb.sheets[0].charts[0] = normalizeChart({ ...raw, type: 'column', appearance: { ...raw.appearance,
    annotations: [{ text: 'Default box', box: { x: .1, y: .2 } }] } });
  const result = await native(wb), chart = result.wb.sheets[0].charts[0];
  expect(chart.type).toBe('column');
  expect(chart.appearance.annotations[0].box.w).toBeCloseTo(.2);
  expect(chart.appearance.annotations[0].box.h).toBeCloseTo(.1);
});
it('keeps annotations isolated across duplicated charts and honours explicit series colors', async () => {
  const wb = await workbookFromFile(bubbleXlsx());
  const sheet = wb.sheets[0];
  wb.duplicateChart(sheet.id, sheet.charts[0].id);
  sheet.charts[1].appearance.annotations[0].text = 'Second chart';
  sheet.charts[0].colors = ['#123456'];
  const result = await native(wb);
  expect(result.wb.sheets[0].charts[0].colors[0]).toBe('#123456');
  expect(result.wb.sheets[0].charts[0].appearance.annotations[0].text).toContain('Standard error');
  expect(result.wb.sheets[0].charts[1].appearance.annotations[0].text).toBe('Second chart');
});
