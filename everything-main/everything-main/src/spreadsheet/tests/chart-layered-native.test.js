import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { funnelXlsx } from './helpers/xlsx-funnel-fixture.js';
import { regionalChartXlsx } from './helpers/xlsx-regional-chart-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';

const decode = part => new TextDecoder().decode(part.content);
async function nativeCycle(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const parts = zip.FullPaths.filter(p => /\/xl\/charts\/[^/]+\.xml$/.test(p));
  expect(parts).toHaveLength(1);
  expect(zip.FullPaths.filter(p => p.endsWith('.svg'))).toEqual([]);
  const xml = decode(X.CFB.find(zip, parts[0]));
  const doc = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(decode(part).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), doc };
}
const chart = wb => wb.sheets[0].charts[0];
const data = wb => chartData(wb, wb.sheets[0].id, chart(wb));
const vectors = wb => data(wb).series.map(s => ({ values: s.values, x: s.x, labels: s.labels }));
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];

it.each([['area', funnelXlsx], ['line', regionalChartXlsx]])('keeps %s/scatter layers editable through three native-only exports', async (type, fixture) => {
  let wb = await workbookFromFile(fixture());
  const expected = vectors(wb), types = chart(wb).appearance.seriesTypes;
  const labelStyles = chart(wb).appearance.dataLabels;
  for (let pass = 0; pass < 3; pass++) {
    const { wb: next, doc } = await nativeCycle(wb);
    expect(elements(doc, `${type}Chart`)).toHaveLength(1);
    expect(elements(doc, 'scatterChart')).toHaveLength(1);
    expect(chart(next).type).toBe('combo');
    expect(chart(next).appearance.seriesTypes).toEqual(types);
    expect(chart(next).appearance.seriesGroups).toBeUndefined();
    chart(next).appearance.dataLabels.forEach((label, index) => {
      expect(label.style.size).toBeCloseTo(labelStyles[index].style.size, 2);
      expect({ ...label, style: { ...label.style, size: 0 } }).toEqual({ ...labelStyles[index],
        ...(chart(wb).sourceRefs[index].labels ? { showRange: true } : {}), style: { ...labelStyles[index].style, size: 0 } });
    });
    expect(vectors(next)).toEqual(expected);
    for (const range of elements(doc, 'datalabelsRange')) {
      expect(range.parentNode.getAttribute('uri')).toBe('{02D57815-91ED-43cb-92C2-25804820EDAC}');
      expect(elements(range, 'v').map(n => n.textContent)).not.toContain('STALE');
    }
    expect(elements(doc, 'showDataLabelsRange').every(n => n.getAttribute('val') === '1')).toBe(true);
    wb = next;
  }
});

it('refreshes formatted cell-label caches after edits, copying a sheet and native reopening', async () => {
  let wb = await workbookFromFile(funnelXlsx());
  wb.setInput(wb.sheets[0].id, 7, 3, '175');
  wb = new Workbook(wb.sheetToWorkbook(wb.sheets[0].id, { sourceWorkbook: '/Source.xlsx' }).toJSON());
  const expected = vectors(wb);
  expect(expected[5].labels.slice(0, 2)).toEqual(['100%', '70%']);
  expect(expected[6].labels.slice(0, 2)).toEqual(['IDENTIFIED 250', 'WON 175']);
  const { wb: next, doc } = await nativeCycle(wb);
  expect(vectors(next)).toEqual(expected);
  const caches = elements(doc, 'datalabelsRange').map(n => elements(n, 'v').map(v => v.textContent));
  expect(caches[0].slice(0, 2)).toEqual(['100%', '70%']);
  expect(caches[1].slice(0, 2)).toEqual(['IDENTIFIED 250', 'WON 175']);
});

it('retains deleted labels and relative offsets without giving layered charts trimming groups', async () => {
  const original = await workbookFromFile(funnelXlsx()), json = original.toJSON();
  json.sheets[0].charts[0].appearance.dataLabels[5].points = [
    { index: 0, hidden: true, dx: .08, dy: -.13, position: 't' },
    { index: 1, hidden: false, dx: -.07, dy: .04, position: 'l' },
  ];
  const wb = new Workbook(json), { wb: next, doc } = await nativeCycle(wb);
  expect(chart(next).appearance.dataLabels[5]).toEqual({ ...chart(wb).appearance.dataLabels[5], showRange: true });
  expect(elements(doc, 'xMode').filter(n => n.getAttribute('val') === 'factor')).toHaveLength(3);
  expect(vectors(next)).toEqual(vectors(wb));
});

it('exports unlabeled layers natively and preserves blank coordinate windows', async () => {
  const original = await workbookFromFile(regionalChartXlsx()), json = original.toJSON();
  json.sheets[0].charts[0].sourceRefs.forEach(s => { delete s.labels; });
  let wb = new Workbook(json);
  const expected = vectors(wb);
  for (let pass = 0; pass < 3; pass++) {
    const { wb: next, doc } = await nativeCycle(wb);
    expect(elements(doc, 'datalabelsRange')).toEqual([]);
    expect(vectors(next)).toEqual(expected);
    wb = next;
  }
});

it('preserves mixed numeric label formats and escaped text through copied native caches', async () => {
  const source = await workbookFromFile(funnelXlsx());
  const helper = source.sheets[1];
  source.applyStyle(helper.id, { r1: 1, c1: 6, r2: 1, c2: 6 }, { fmt: 'custom', code: '$0.00' });
  source.setInput(helper.id, 1, 6, '12');
  source.setInput(helper.id, 0, 7, 'A < B & C');
  let wb = source.sheetToWorkbook(source.sheets[0].id, { sourceWorkbook: '../Source.xlsx' });
  const expected = vectors(source);
  expect(expected[5].labels.slice(0, 2)).toEqual(['100%', '$12.00']);
  expect(expected[6].labels[0]).toBe('A < B & C');
  expect(vectors(wb)).toEqual(expected);
  for (let pass = 0; pass < 2; pass++) wb = (await nativeCycle(wb)).wb;
  expect(vectors(wb)).toEqual(expected);
  wb = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: 'https://example.com/reports/Report.xlsx' });
  expect(vectors(wb)).toEqual(expected);
  expect(vectors((await nativeCycle(wb)).wb)).toEqual(expected);
});

it.each(['value', 'source', 'text'])('does not reuse native cell-label display caches after a %s change', async kind => {
  const source = await workbookFromFile(funnelXlsx());
  const copy = source.sheetToWorkbook(source.sheets[0].id, { sourceWorkbook: '/Source.xlsx' });
  const json = (await nativeCycle(copy)).wb.toJSON();
  const cached = json.externalWorkbooks.books[0].sheets.find(s => s.name === 'Helper');
  if (kind === 'source') json.sheets[0].charts[0].sourceRefs[5].labelDisplayCache[0].source = 'unrelated';
  else cached.cells['0,6'] = kind === 'text' ? '1' : .25;
  const wb = new Workbook(json);
  expect(data(wb).series[5].labels[0]).toBe(kind === 'value' ? '0.25' : '1');
  const recopied = wb.sheetToWorkbook(wb.activeSheetId, { sourceWorkbook: '/Report.xlsx' });
  expect(data(recopied).series[5].labels[0]).toBe(data(wb).series[5].labels[0]);
});

it('keeps local label formatting live and does not use caches for broken label references', async () => {
  const source = await workbookFromFile(funnelXlsx());
  source.applyStyle(source.sheets[1].id, { r1: 0, c1: 6, r2: 1, c2: 6 }, { fmt: 'custom', code: '0.00' });
  const expected = data(source).series[5].labels;
  expect(expected.slice(0, 2)).toEqual(['1.00', '0.40']);
  expect(data((await nativeCycle(source)).wb).series[5].labels).toEqual(expected);
  chart(source).sourceRefs[5].labels = '#REF!';
  expect(data(source).series[5].labels.every(label => label === '')).toBe(true);
});
