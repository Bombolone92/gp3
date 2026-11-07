// A scatter chart's horizontal axis bounds, set in the app's own style, are written to the file for Excel and read back (issue #142).
import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartXBounds } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function book() {
  const wb = new Workbook(), id = wb.activeSheetId;
  [['x', 'y'], ['1', '2'], ['2', '5'], ['3', '7'], ['4', '11'], ['5', '13']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  wb.addChart(id, { type: 'scatter', range: { r1: 0, c1: 0, r2: 5, c2: 1 }, title: 'Mine', anchor: { r: 0, c: 3 }, w: 400, h: 260, xMin: 2, xMax: 4, yMin: 1 });
  return wb;
}

it('writes the bounds on the horizontal value axis', async () => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(book())).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  const axes = xml.match(/<c:valAx>.*?<\/c:valAx>/gs);
  const horizontal = axes.find(a => a.includes('<c:axPos val="b"/>')), vertical = axes.find(a => a.includes('<c:axPos val="l"/>'));
  expect(horizontal).toContain('<c:max val="4"/>');
  expect(horizontal).toContain('<c:min val="2"/>');
  expect(vertical).toContain('<c:min val="1"/>');
  expect(vertical).not.toContain('<c:max ');
});

it('reads them back, from the app\'s own file and from the chart Excel sees', async () => {
  const wb = book();
  const back = await workbookFromFile(await (await workbookToXlsx(wb)).arrayBuffer(), 'scatter.xlsx');
  expect(chartXBounds(back.activeSheet.charts[0])).toEqual({ min: 2, max: 4 });
  // Without the app's own copy of the chart, as after Excel saves the file.
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const entry = X.CFB.find(zip, '/xl/workbook.xml');
  entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  entry.size = entry.content.length;
  const native = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(chartXBounds(native.activeSheet.charts[0])).toEqual({ min: 2, max: 4 });
  expect(native.activeSheet.charts[0].yMin).toBe(1);
});
