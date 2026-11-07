import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart, chartData } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg, standaloneSvg } from '../src/ui/chartsvg.js';

const xml = text => new (new JSDOM('').window.DOMParser)().parseFromString(text, 'application/xml');
const make = (type = 'column', bars) => ({ type, legend: false, colors: ['#2468ac', '#aa6633'],
  anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 },
  sourceRefs: [{ name: 'Values', literal: { categories: ['Positive', 'Negative', 'Zero', 'Blank'], values: [7, -3, 0, null] } }],
  appearance: { bars, plotFill: '#e0ecd2' } });
const content = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, text) => { const p = X.CFB.find(zip, path); p.content = new TextEncoder().encode(text); p.size = p.content.length; };
const native = zip => {
  set(zip, '/xl/workbook.xml', content(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
};
const zipOf = async wb => X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
const barsOf = (wb, ch = wb.activeSheet.charts[0]) => {
  const doc = xml(standaloneSvg(renderChartSvg(chartData(wb, wb.activeSheet.id, ch), ch, 560, 320), () => ''));
  expect(doc.querySelector('parsererror')).toBeNull();
  return [...doc.querySelectorAll('.chart-column,.chart-bar')];
};

it.each(['column', 'bar'])('preserves native %s inversion booleans, omitted defaults, duplication and native-only export', async type => {
  for (const [element, expected] of [['', undefined], ['<c:invertIfNegative/>', true], ...['0', 'false', '1', 'true', ' false ', 'bogus'].map(v => [`<c:invertIfNegative val="${v}"/>`, ['0', 'false', ' false '].includes(v) ? false : v === 'bogus' ? undefined : true])]) {
    const zip = await zipOf(new Workbook({ sheets: [{ name: 'Data', charts: [make(type)] }] }));
    const path = '/xl/charts/chart1_1.xml';
    set(zip, path, content(zip, path).replace(/<c:invertIfNegative[^>]*\/>/g, '').replace('</c:spPr>', `</c:spPr>${element}`));
    const back = await workbookFromFile(native(zip), 'native.xlsx'), ch = back.activeSheet.charts[0];
    expect(ch.appearance.bars[0].invertIfNegative).toBe(expected);
    expect(barsOf(back)[1].getAttribute('fill')).toBe(expected === false ? '#2468ac' : '#ffffff');
    const copy = back.chartById(back.activeSheet.id, back.duplicateChart(back.activeSheet.id, ch.id));
    copy.sourceRefs[0].literal.values[0] = -11;
    const saved = await zipOf(back), doc = xml(content(saved, '/xl/charts/chart1_2.xml'));
    const inversion = doc.querySelector('ser > invertIfNegative');
    if (expected == null) expect(inversion).toBeNull();
    else expect(inversion.getAttribute('val')).toBe(expected ? '1' : '0');
    const reopened = await workbookFromFile(native(saved), 'external.xlsx');
    expect(reopened.activeSheet.charts[1].appearance.bars).toEqual(copy.appearance.bars);
    expect(barsOf(reopened, reopened.activeSheet.charts[1])[0].getAttribute('fill')).toBe(expected === false ? '#2468ac' : '#ffffff');
  }
});

it.each(['column', 'bar'])('round trips %s point overrides, custom negative colors and independent borders', async type => {
  const ch = make(type, [{ invertIfNegative: true, negativeColor: '#ff00aa', stroke: '#cc2244', strokeWidth: 2.5, strokeDash: 'dash',
    points: [{ index: 0, invertIfNegative: false, stroke: 'none' }, { index: 1, invertIfNegative: true, stroke: '#6600cc', strokeWidth: 4.25, strokeDash: 'solid' }] }]);
  ch.sourceRefs[0].literal.values = [-7, -3, 0, null];
  ch.appearance.pointColors = [[{ index: 0, color: '#00aa44' }, { index: 1, color: '#ff9900' }]];
  const wb = new Workbook({ sheets: [{ name: 'Data', charts: [ch] }] }), saved = await zipOf(wb);
  const doc = xml(content(saved, '/xl/charts/chart1_1.xml'));
  expect(doc.getElementsByTagNameNS('http://schemas.microsoft.com/office/drawing/2007/8/2/chart', 'invertSolidFillFmt')).toHaveLength(1);
  expect([...doc.querySelector('ser').children].map(n => n.localName)).toEqual(['idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'dPt', 'dPt', 'cat', 'val', 'extLst']);
  expect([...doc.querySelector('dPt').children].map(n => n.localName)).toEqual(['idx', 'invertIfNegative', 'spPr']);
  const back = await workbookFromFile(native(saved), 'native.xlsx');
  const restored = back.activeSheet.charts[0].appearance.bars[0];
  expect(restored).toMatchObject({ invertIfNegative: true, negativeColor: '#ff00aa', stroke: '#cc2244' });
  expect(restored.strokeDash).toBe('dash');
  expect(restored.points[1].strokeDash).toBe('solid');
  expect(restored.strokeWidth).toBeCloseTo(2.5, 3);
  expect(restored.points[1].strokeWidth).toBeCloseTo(4.25, 3);
  const bars = barsOf(back);
  expect(bars.map(n => n.getAttribute('fill'))).toEqual(['#00aa44', '#ffffff', '#2468ac']);
  expect(bars.map(n => n.getAttribute('stroke'))).toEqual(['none', '#6600cc', '#cc2244']);
  expect(bars[1].getAttribute('stroke-dasharray')).toBeNull();
  expect(bars[2].getAttribute('stroke-dasharray').split(' ').map(Number)[0]).toBeCloseTo(10, 3);
  bars.forEach((n, i) => expect(+n.getAttribute('stroke-width')).toBeCloseTo([1, 4.25, 2.5][i], 3));
  back.activeSheet.charts[0].sourceRefs[0].literal.values[1] = 5;
  expect(barsOf(back)[1].getAttribute('fill')).toBe('#ff9900');
});

it.each([false, true])('inverts each signed stacked segment independently (percent=%s)', percent => {
  const ch = make('column', [{ invertIfNegative: true }, { invertIfNegative: false }]);
  ch.stacked = true; ch.stack100 = percent;
  ch.sourceRefs.push({ name: 'Second', literal: { categories: ['Positive', 'Negative', 'Zero', 'Blank'], values: [-2, -5, 0, null] } });
  const wb = new Workbook({ sheets: [{ charts: [ch] }] });
  expect(barsOf(wb).map(n => n.getAttribute('fill'))).toEqual(['#2468ac', '#ffffff', '#2468ac', '#aa6633', '#aa6633', '#aa6633']);
});

it('keeps authored negative bars filled after external XLSX reopening', async () => {
  for (const appearance of [undefined, {}]) {
    const wb = new Workbook({ sheets: [{ charts: [{ ...make(), appearance }] }] });
    const saved = await zipOf(wb);
    expect(xml(content(saved, '/xl/charts/chart1_1.xml')).querySelector('ser > invertIfNegative').getAttribute('val')).toBe('0');
    const back = await workbookFromFile(native(saved), 'external.xlsx');
    expect(barsOf(back)[1].getAttribute('fill')).toBe('#2468ac');
  }
});

it('normalizes booleans and safe paint values without coercing invalid input', () => {
  const chart = normalizeChart(make('column', [{ invertIfNegative: 'false', negativeColor: 'url(evil)', stroke: '#AABBCC', strokeWidth: -1,
    points: [{ index: -1, invertIfNegative: true }, { index: 3, invertIfNegative: false }, { index: 4, invertIfNegative: 1 }] }, null]));
  expect(chart.appearance.bars[0]).toEqual({ negativeColor: null, stroke: '#aabbcc', strokeWidth: 0, strokeDash: null, points: [
    { index: 3, invertIfNegative: false, stroke: null, strokeWidth: null, strokeDash: null }, { index: 4, stroke: null, strokeWidth: null, strokeDash: null }] });
  expect(chart.appearance.bars[1]).toBeNull();
});

it('keeps column styles aligned in mixed charts without inverting line values', async () => {
  const ch = make('combo', [{ invertIfNegative: false }, { invertIfNegative: true }, null]);
  ch.appearance.seriesTypes = ['column', 'column', 'line'];
  ch.appearance.seriesGroups = [{ id: 0, grouping: 'clustered' }, { id: 0, grouping: 'clustered' }, { id: 1, grouping: 'standard' }];
  ch.sourceRefs.push({ name: 'Line', literal: { categories: ['A', 'B', 'C', 'D'], values: [3, -8, 1, null] } }, { name: 'Other bars', literal: { categories: ['A', 'B', 'C', 'D'], values: [4, -2, 0, null] } });
  const wb = new Workbook({ sheets: [{ charts: [ch] }] }), saved = await zipOf(wb);
  const doc = xml(content(saved, '/xl/charts/chart1_1.xml'));
  expect(doc.querySelector('lineChart invertIfNegative')).toBeNull();
  expect([...doc.querySelectorAll('barChart invertIfNegative')].map(n => n.getAttribute('val'))).toEqual(['0', '1']);
  const back = await workbookFromFile(native(saved), 'external.xlsx');
  expect(back.activeSheet.charts[0].appearance.bars[2]).toBeNull();
  const bars = barsOf(back);
  expect(bars[1].getAttribute('fill')).toBe('#2468ac');
  expect(bars[4].getAttribute('fill')).toBe('#ffffff');
});

it('point-only inversion survives without a point fill and hairline borders retain their native zero width', async () => {
  const ch = make('column', [{ invertIfNegative: false, stroke: '#ff0000', strokeWidth: 0, strokeDash: null, points: [{ index: 1, invertIfNegative: true }] }]);
  const wb = new Workbook({ sheets: [{ charts: [ch] }] });
  const back = await workbookFromFile(native(await zipOf(wb)), 'external.xlsx');
  expect(back.activeSheet.charts[0].appearance.pointColors[0]).toEqual([]);
  const negative = barsOf(back)[1];
  expect(negative.getAttribute('fill')).toBe('#ffffff');
  expect(back.activeSheet.charts[0].appearance.bars[0].strokeWidth).toBe(0);
  expect(negative.getAttribute('stroke-width')).toBe('1');
  expect(negative.getAttribute('vector-effect')).toBe('non-scaling-stroke');
});

it('retains point defaults and distinguishes an empty point shape from an inherited series shape', async () => {
  const cases = [
    { points: [{ index: 1 }], inversion: false, fill: '#ffffff', stroke: '#cc2244', width: 2 },
    { points: [{ index: 1, shape: true }], inversion: false, fill: '#ffffff', stroke: '#000000', width: 1 },
    { points: [{ index: 1, stroke: '#6600cc' }], inversion: false, fill: '#ffffff', stroke: '#6600cc', width: 1 },
    { points: [{ index: 1, invertIfNegative: true }], negativeColor: '#ff00aa', fill: '#ff00aa', stroke: '#cc2244', width: 2 },
    { points: [{ index: 1, invertIfNegative: false }], fill: '#2468ac', stroke: '#cc2244', width: 2 },
  ];
  for (const c of cases) {
    const ch = make('column', [{ invertIfNegative: c.inversion ?? true, negativeColor: c.negativeColor, stroke: '#cc2244', strokeWidth: 2, points: c.points }]);
    const wb = new Workbook({ sheets: [{ charts: [ch] }] }), saved = await zipOf(wb);
    expect(xml(content(saved, '/xl/charts/chart1_1.xml')).querySelectorAll('dPt')).toHaveLength(1);
    const back = await workbookFromFile(native(saved), 'external.xlsx');
    for (const book of [wb, back]) {
      const p = barsOf(book)[1];
      expect(p.getAttribute('fill')).toBe(c.fill);
      expect(p.getAttribute('stroke')).toBe(c.stroke);
      expect(+p.getAttribute('stroke-width')).toBe(c.width);
    }
  }
});

it('uses automatic outlines for default inversion and preserves explicit no-fill points', async () => {
  for (const negativeColor of [undefined, '#ff00aa']) {
    const ch = make('column', [{ invertIfNegative: true, negativeColor, stroke: 'none', strokeWidth: 2 }]);
    const wb = new Workbook({ sheets: [{ charts: [ch] }] });
    const negative = barsOf(wb)[1];
    expect(negative.getAttribute('stroke')).toBe(negativeColor ? 'none' : '#000000');
    expect(barsOf(wb)[0].getAttribute('stroke')).toBe('none');
  }
  for (const color of ['none', '#ffaa00']) {
    const ch = make('column', [{ invertIfNegative: false, negativeColor: '#ff00aa', stroke: '#cc2244', strokeWidth: 2 }]);
    ch.appearance.pointColors = [[{ index: 1, color }]];
    const wb = new Workbook({ sheets: [{ charts: [ch] }] }), back = await workbookFromFile(native(await zipOf(wb)), 'external.xlsx');
    for (const book of [wb, back]) {
      const p = barsOf(book)[1];
      expect(p.getAttribute('fill')).toBe(color === 'none' ? 'none' : '#ffffff');
      expect(p.getAttribute('stroke')).toBe(color === 'none' ? 'none' : '#000000');
    }
  }
});
