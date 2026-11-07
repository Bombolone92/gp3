import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const text = part => new TextDecoder().decode(part.content);
const replace = (part, value) => { part.content = new TextEncoder().encode(value); part.size = part.content.length; };
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
it.each([false, true])('keeps absent series names automatic across edits, duplication and native export (one named: %s)', async named => {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/charts/run.xml');
  replace(part, text(part).replace(/<c:tx><c:v>Daily average<\/c:v><\/c:tx>/, '')
    .replace(/<c:tx><c:v>Sample mean<\/c:v><\/c:tx>/, named ? '<c:tx><c:v>Series 2</c:v></c:tx>' : ''));
  let wb = await workbookFromFile(bytes(zip), 'automatic-names.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    expect(chart.sourceRefs.map(s => s.name)).toEqual(['', named ? 'Series 2' : '']);
    expect(chartData(wb, sheet.id, chart).series.map(s => s.name)).toEqual(['Series1', named ? 'Series 2' : 'Series2']);
    wb.setInput(sheet.id, 0, 1, '123');
    const copy = wb.chartById(sheet.id, wb.duplicateChart(sheet.id, chart.id));
    expect(copy.sourceRefs.map(s => s.name)).toEqual(chart.sourceRefs.map(s => s.name));
    if (!pass) {
      const saved = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
      const xml = text(X.CFB.find(saved, '/xl/charts/chart1_1.xml'));
      const series = [...xml.matchAll(/<c:ser>(.*?)<\/c:ser>/gs)].map(m => m[1]);
      expect(series[0]).not.toContain('<c:tx>');
      if (named) expect(series[1]).toContain('<c:v>Series 2</c:v>');
      else expect(series[1]).not.toContain('<c:tx>');
      const book = X.CFB.find(saved, '/xl/workbook.xml');
      replace(book, text(book).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
      wb = await workbookFromFile(bytes(saved), 'native.xlsx');
    }
  }
});
