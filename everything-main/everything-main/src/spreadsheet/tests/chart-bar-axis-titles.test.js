import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const data = { categories: ['Alpha', 'Beta', 'Gamma'], series: [{ name: 'Volume', values: [2, 5, 3] }] };
function chart(type = 'bar', appearance) {
  return normalizeChart({ type, legend: false, xTitle: 'Categories', yTitle: 'Amounts',
    anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 }, appearance,
    sourceRefs: [{ name: 'Volume', literal: { categories: data.categories, values: data.series[0].values } }] });
}
function draw(ch, width = 500, height = 300) {
  const svg = renderChartSvg(data, ch, width, height);
  expect(svg).not.toMatch(/NaN|Infinity/);
  const doc = new JSDOM(svg).window.document;
  const text = value => [...doc.querySelectorAll('text')].find(n => n.textContent === value);
  const clip = doc.querySelector('clipPath rect');
  return { doc, category: text('Categories'), value: text('Amounts'), plot: clip && {
    x: +clip.getAttribute('x'), y: +clip.getAttribute('y') + 1,
    w: +clip.getAttribute('width'), h: +clip.getAttribute('height') - 2,
  } };
}
async function cycle(wb, metadata = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  if (!metadata) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  }
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
}
it.each(['bar', 'column', 'line', 'area', 'scatter'])('retains %s title axis identity through two native-only cycles', async type => {
  let wb = new Workbook({ sheets: [{ name: 'Report', charts: [chart(type)] }] });
  for (let pass = 0; pass < 3; pass++) {
    const ch = wb.activeSheet.charts[0], rendered = draw(ch);
    expect(chartData(wb, wb.activeSheetId, ch).series[0].values).toEqual([2, 5, 3]);
    expect((type === 'bar' ? rendered.category : rendered.value).getAttribute('transform')).toContain('rotate(-90)');
    expect((type === 'bar' ? rendered.value : rendered.category).getAttribute('transform')).toBeNull();
    if (pass < 2) wb = await cycle(wb);
  }
});
it.each(['low', 'high', 'nextTo'])('fits horizontal titles beside %s labels, reversed axes and manual plots', position => {
  for (const reverseValues of [false, true]) for (const crossing of ['min', 'max', 2]) for (const manual of [false, true]) {
    const ch = chart('bar', { xLabelPosition: position, reverseValues, axisCrossings: { x: crossing, y: 'max' }, reverseCategories: true,
      xStyle: { size: 18, color: '#123456' }, yStyle: { size: 24, color: '#abcdef' },
      ...(manual ? { plot: { x: .02, y: .05, w: .96, h: .93 } } : {}) });
    const before = JSON.stringify(ch), result = draw(ch);
    const x = Number(/translate\(([-\d.]+)/.exec(result.category.getAttribute('transform'))[1]);
    expect(x).toBeGreaterThan(18 * .8); expect(x + 18 * .2).toBeLessThan(500);
    expect(result.category.getAttribute('font-size')).toBe('18'); expect(result.value.getAttribute('font-size')).toBe('24');
    expect(result.category.getAttribute('fill')).toBe('#123456'); expect(result.value.getAttribute('fill')).toBe('#abcdef');
    const categoryLabels = [...result.doc.querySelectorAll('text')].filter(n => data.categories.includes(n.textContent));
    const high = (position === 'nextTo' ? crossing === 'max' : position === 'high') !== reverseValues;
    for (const label of categoryLabels) expect(high ? x > +label.getAttribute('x') : x < +label.getAttribute('x')).toBe(true);
    const bottom = +result.value.getAttribute('y') - 24 * .8;
    expect(result.plot.y + result.plot.h).toBeLessThan(bottom);
    for (const label of result.doc.querySelectorAll('text[fill="#abcdef"]')) {
      if (label !== result.value) expect(+label.getAttribute('y') + 24 * .2).toBeLessThan(bottom);
    }
    expect(JSON.stringify(ch)).toBe(before);
  }
});
it('retains titles when both axes and labels are hidden and survives sheet copy and metadata', async () => {
  const original = new Workbook({ sheets: [{ name: 'Report', charts: [chart('bar', { hideXAxis: true, hideYAxis: true })] }] });
  const before = JSON.stringify(original.activeSheet.charts[0]);
  let wb = original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '/Original.xlsx' });
  wb = await cycle(await cycle(wb, true));
  const result = draw(wb.activeSheet.charts[0]);
  expect(result.category.getAttribute('transform')).toContain('rotate(-90)');
  expect(result.value.getAttribute('transform')).toBeNull();
  expect(JSON.stringify(original.activeSheet.charts[0])).toBe(before);
});
it.each(['top', 'bottom', 'right'])('reserves each title independently with a %s legend', legendPos => {
  for (const titles of ['category', 'value', 'both']) for (const height of [180, 450]) {
    const ch = chart('bar', { reverseCategories: true, axisCrossings: { y: 'max' },
      xStyle: { size: 12 }, yStyle: { size: 20 } });
    ch.legend = true; ch.legendPos = legendPos;
    if (titles === 'category') ch.yTitle = '';
    if (titles === 'value') ch.xTitle = '';
    const result = draw(ch, 540, height);
    expect(!!result.category).toBe(titles !== 'value'); expect(!!result.value).toBe(titles !== 'category');
    if (result.value) {
      const top = +result.value.getAttribute('y') - 16;
      expect(result.plot.y + result.plot.h).toBeLessThan(top);
      const legend = [...result.doc.querySelectorAll('text')].find(n => n.textContent === 'Volume');
      if (legendPos === 'bottom') expect(+result.value.getAttribute('y') + 4).toBeLessThan(+legend.getAttribute('y'));
    }
  }
});
it.each(['low', 'high', 'nextTo'])('keeps value title clear of %s labels with reversed category order', yLabelPosition => {
  for (const reverseCategories of [false, true]) for (const crossing of ['min', 'max', 2]) {
    const result = draw(chart('bar', { yLabelPosition, reverseCategories, axisCrossings: { y: crossing },
      plot: { x: .3, y: .02, w: .6, h: .96 }, yStyle: { size: 20, color: '#abcdef' } }));
    const titleTop = +result.value.getAttribute('y') - 16;
    for (const label of result.doc.querySelectorAll('text[fill="#abcdef"]'))
      if (label !== result.value) expect(+label.getAttribute('y') + 4).toBeLessThan(titleTop);
  }
});
