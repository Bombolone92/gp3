import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { progressChartXlsx } from './helpers/xlsx-progress-chart-fixture.js';

const parser = new (new JSDOM('').window.DOMParser)();
const xml = text => parser.parseFromString(text, 'application/xml');
const partText = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const setPart = (zip, path, text) => {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(text); part.size = part.content.length;
};

function fixture({ position = 't', labels = 'nextTo', manual = true, reversed = true } = {}) {
  const zip = X.CFB.read(new Uint8Array(progressChartXlsx({ reversed })), { type: 'array' });
  const path = '/xl/charts/progress1.xml';
  let chart = partText(zip, path).replace('<c:valAx>', `<c:valAx><c:axPos val="${position}"/><c:tickLblPos val="${labels}"/>`);
  // The balance-sheet template leaves room above its plot, which reaches
  // almost to the chart bottom. Drawing these ticks below clips the labels.
  if (manual) chart = chart.replace('<c:plotArea>', '<c:plotArea><c:layout><c:manualLayout><c:x val="0.12"/><c:y val="0.3"/><c:w val="0.8"/><c:h val="0.68"/></c:manualLayout></c:layout>');
  setPart(zip, path, chart);
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

const svgFor = (wb, ch = wb.activeSheet.charts[0]) => xml(renderChartSvg(chartData(wb, wb.activeSheetId, ch), ch, ch.w, ch.h));
const ticks = svg => [...svg.getElementsByTagName('text')].filter(n => /^\d+%$/.test(n.textContent));
const plot = svg => svg.querySelector('clipPath rect');

it('places a native top value axis above the plot through save, reopen and duplication', async () => {
  let wb = await workbookFromFile(fixture(), 'balance.xlsx');
  for (let pass = 0; pass < 2; pass++) {
    const ch = wb.activeSheet.charts[0], svg = svgFor(wb);
    expect(ch.appearance).toMatchObject({ yPosition: 't', yLabelPosition: 'nextTo', reverseCategories: true });
    expect(ticks(svg).map(n => n.textContent)).toEqual(['0%', '25%', '50%', '75%', '100%']);
    for (const tick of ticks(svg)) {
      expect(+tick.getAttribute('y')).toBeGreaterThan(0);
      expect(+tick.getAttribute('y')).toBeLessThan(+plot(svg).getAttribute('y'));
    }
    if (!pass) wb = await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx');
  }
  const sheet = wb.activeSheet, id = wb.duplicateChart(sheet.id, sheet.charts[0].id);
  expect(wb.chartById(sheet.id, id).appearance).toEqual(sheet.charts[0].appearance);
  wb.setInput(sheet.id, 1, 5, '3');
  expect(chartData(wb, sheet.id, sheet.charts[0]).series[0].values).toEqual([.5]);
  wb.undo();
  expect(chartData(wb, sheet.id, sheet.charts[0]).series[0].values).toEqual([1 / 6]);
});

it.each([
  ['t', 'nextTo', true], ['b', 'nextTo', false], ['b', 'high', true], ['t', 'low', false],
])('reserves room for a %s value axis with %s labels in automatic layouts', async (position, labels, above) => {
  const wb = await workbookFromFile(fixture({ position, labels, manual: false, reversed: false }), 'bars.xlsx');
  const svg = svgFor(wb), ch = wb.activeSheet.charts[0], top = +plot(svg).getAttribute('y'), bottom = top + +plot(svg).getAttribute('height');
  for (const tick of ticks(svg)) {
    const y = +tick.getAttribute('y');
    expect(y).toBeGreaterThan(ch.appearance.yStyle.size);
    expect(y).toBeLessThan(ch.h - 2);
    if (above) expect(y).toBeLessThan(top);
    else expect(y).toBeGreaterThan(bottom);
  }
});

it('honors hidden tick labels without deleting the axis or its plot', async () => {
  const wb = await workbookFromFile(fixture({ labels: 'none', manual: false }), 'bars.xlsx');
  expect(ticks(svgFor(wb))).toHaveLength(0);
  expect(svgFor(wb).querySelector('.chart-bar')).not.toBeNull();
  expect(wb.activeSheet.charts[0].appearance.hideYAxis).toBe(false);
});

it.each([false, true])('exports native axis settings without private metadata (reversed: %s)', async reversed => {
  const wb = await workbookFromFile(fixture({ labels: 'high', reversed }), 'balance.xlsx');
  const blob = await workbookToXlsx(wb), zip = X.CFB.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  const doc = xml(partText(zip, '/xl/charts/chart1_1.xml'));
  expect(doc.querySelector('parsererror')).toBeNull();
  const axis = doc.getElementsByTagNameNS('*', 'valAx')[0];
  expect(axis.getElementsByTagNameNS('*', 'axPos')[0].getAttribute('val')).toBe('t');
  expect(axis.getElementsByTagNameNS('*', 'tickLblPos')[0].getAttribute('val')).toBe('high');
  expect(axis.getElementsByTagNameNS('*', 'majorTickMark')[0].getAttribute('val')).toBe('out');
  expect(axis.getElementsByTagNameNS('*', 'crosses')[0].getAttribute('val')).toBe(reversed ? 'autoZero' : 'max');
  setPart(zip, '/xl/workbook.xml', partText(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
  expect(back.activeSheet.charts[0].appearance).toMatchObject({ yPosition: 't', yLabelPosition: 'high', valueTicks: true });
  expect(ticks(svgFor(back)).map(n => +n.getAttribute('y'))).toEqual(ticks(svgFor(wb)).map(n => +n.getAttribute('y')));
});

it.each([false, true].flatMap(reversed => [
  ['r', 'nextTo', true, reversed], ['l', 'high', !reversed, reversed], ['r', 'low', reversed, reversed],
]))('positions vertical value labels for %s / %s (right: %s, reversed: %s)', async (position, labels, right, reversed) => {
  // Excel high/low follow the perpendicular domain ends; nextTo follows axPos.
  const wb = await workbookFromFile(fixture({ reversed }), 'bars.xlsx');
  const ch = normalizeChart({ ...wb.activeSheet.charts[0], type: 'column', h: 300,
    appearance: { ...wb.activeSheet.charts[0].appearance, yPosition: position, yLabelPosition: labels } });
  const svg = svgFor(wb, ch), x = +plot(svg).getAttribute('x'), edge = x + +plot(svg).getAttribute('width');
  for (const tick of ticks(svg)) {
    if (right) { expect(+tick.getAttribute('x')).toBeGreaterThan(edge); expect(tick.getAttribute('text-anchor')).toBe('start'); }
    else { expect(+tick.getAttribute('x')).toBeLessThan(x); expect(tick.getAttribute('text-anchor')).toBe('end'); }
  }
});

it('rejects invalid imported axis settings', () => {
  const ch = normalizeChart({ type: 'bar', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 0, c: 0 },
    appearance: { yPosition: 'url(bad)', yLabelPosition: '<bad>' } });
  expect(ch.appearance.yPosition).toBeNull();
  expect(ch.appearance.yLabelPosition).toBe('nextTo');
});
