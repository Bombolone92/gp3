import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

// A chart in the app's own style keeps each series' marker size and shape in .xlsx files, as Format Data Series' do.
function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['x', 'Low', 'High'], [1, 2, 5], [2, 4, 6], [4, 3, 9]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  return { wb, id, range: { r1: 0, c1: 0, r2: 3, c2: 2 } };
}

it('writes an app-style chart\'s marker sizes and shapes to .xlsx files', async () => {
  const { wb, id, range } = book();
  wb.addChart(id, { type: 'scatter', range, anchor: { r: 0, c: 5 }, seriesLines: [{ markerSize: 11, markerSymbol: 'triangle' }, { marker: false }] });
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  const markers = [...xml.matchAll(/<c:marker>(.*?)<\/c:marker>/g)].map(m => m[1]);
  expect(markers[0]).toMatch(/<c:symbol val="triangle"\/><c:size val="11"\/>/);
  expect(markers[1]).toMatch(/<c:symbol val="none"\/>/);
});
