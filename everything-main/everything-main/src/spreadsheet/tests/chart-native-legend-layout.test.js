import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const parser = new (new JSDOM('').window.DOMParser)();
const widthOf = (name, size) => [...name].reduce((sum, ch) => sum + (/\p{Extended_Pictographic}/u.test(ch) ? 1.2 : .56) * size, 0);
const xml = text => parser.parseFromString(text, 'application/xml');
const labels = doc => [...doc.querySelectorAll('.chart-legend-label')];
function setup(type = 'column', names = ['North', 'South'], appearance = {}, position = 'bottom') {
  const pie = ['pie', 'donut'].includes(type);
  const chart = normalizeChart({ type, legend: true, legendPos: position, title: 'Regions',
    range: { r1: 0, c1: 0, r2: 3, c2: 2 }, anchor: { r: 0, c: 0 },
    appearance: { legendStyle: { size: 16 }, plotStroke: '#123456', ...(pie ? { pie: {} } : {}), ...appearance } });
  const data = { categories: pie ? names : ['A', 'B', 'C'], series: pie
    ? [{ name: 'Totals', values: names.map((_, i) => i + 1) }]
    : names.map((name, i) => ({ name, values: [2 + i, 5 + i, 3 + i], x: [1, 2, 3] })) };
  return { chart, data, render: (w = 700, h = 400) => xml(renderChartSvg(data, chart, w, h)) };
}
const keyLeft = text => {
  let key = text.previousElementSibling;
  if (key.tagName === 'circle' && key.previousElementSibling?.tagName === 'line') key = key.previousElementSibling;
  return +(key.getAttribute('x') ?? key.getAttribute('x1') ?? (+key.getAttribute('cx') - +key.getAttribute('r')));
};

it.each(['column', 'bar', 'line', 'scatter', 'pie', 'donut'])('centers compact automatic %s legends without stretching their gaps on resize', type => {
  for (const size of [12, 24]) {
    const { render } = setup(type, ['North', 'South'], { legendStyle: { size } });
    const distances = [];
    for (const W of [400, 900]) {
      const texts = labels(render(W));
      expect(texts.map(t => t.textContent)).toEqual(['North', 'South']);
      const left = keyLeft(texts[0]), right = +texts[1].getAttribute('x') + widthOf('South', size);
      expect((left + right) / 2).toBeCloseTo(W / 2, 1);
      distances.push(+texts[1].getAttribute('x') - +texts[0].getAttribute('x'));
      expect(keyLeft(texts[1]) - (+texts[0].getAttribute('x') + widthOf('North', size))).toBeGreaterThan(0);
    }
    expect(distances[0]).toBeCloseTo(distances[1], 1);
  }
});

it.each(['top', 'bottom'])('wraps %s legends into aligned columns and reserves their measured height', position => {
  const names = ['North region', 'South region', 'East region', 'West region', 'Central region'];
  const { render } = setup('column', names, {}, position), doc = render(360), texts = labels(doc);
  expect(texts.map(t => t.textContent)).toEqual(names);
  const rows = [...new Set(texts.map(t => +t.getAttribute('y')))];
  expect(rows).toHaveLength(3);
  expect(+texts[0].getAttribute('x')).toBe(+texts[2].getAttribute('x'));
  expect(+texts[0].getAttribute('x')).toBe(+texts[4].getAttribute('x'));
  for (const text of texts) {
    expect(keyLeft(text)).toBeGreaterThan(0);
    expect(+text.getAttribute('x') + widthOf(text.textContent, 16)).toBeLessThan(360);
    expect(+text.getAttribute('y')).toBeLessThan(400);
  }
  const plot = doc.querySelector('.chart-plot-border'), y = +plot.getAttribute('y');
  if (position === 'top') expect(y).toBeGreaterThan(Math.max(...rows));
  else expect(y + +plot.getAttribute('height') + 16).toBeLessThan(Math.min(...rows));
});

it('wraps long names without dropping words, newlines, or splitting surrogate pairs', () => {
  const names = ['Operating revenue across all regions\nAnnual total', '😀'.repeat(30)];
  const { render } = setup('column', names), texts = labels(render(280, 500));
  expect(texts.map(t => t.textContent).join('').replace(/\s/g, '')).toBe(names.join('').replace(/\s/g, ''));
  for (const text of texts) {
    expect(text.textContent).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(+text.getAttribute('x') + widthOf(text.textContent, 16)).toBeLessThan(280);
  }
});

it('balances the columns when the same number of rows can use a smaller legend box', () => {
  const { render } = setup('column', ['North region', 'South region', 'East region', 'West region', 'Central region']);
  const texts = labels(render(560));
  expect(new Set(texts.map(t => t.getAttribute('y'))).size).toBe(2);
  expect(texts.filter(t => t.getAttribute('y') === texts[0].getAttribute('y'))).toHaveLength(3);
  expect(texts[3].getAttribute('x')).toBe(texts[0].getAttribute('x'));
});

it.each(['👩‍👩‍👧‍👦', 'A\u030A'])('keeps the grapheme %s intact when a long token must wrap', unit => {
  const name = unit.repeat(20), { render } = setup('column', [name]);
  const texts = labels(render(220, 500));
  expect(texts.length).toBeGreaterThan(1);
  expect(texts.map(t => t.textContent).join('')).toBe(name);
  for (const text of texts) expect(text.textContent.split(unit).join('')).toBe('');
});

it('lays out only visible entries while retaining their original series colors', () => {
  const { chart, render } = setup('column', ['North', 'Hidden', 'South'], { legendHidden: [1] });
  chart.colors = ['#112233', '#445566', '#778899'];
  const texts = labels(render());
  expect(texts.map(t => t.textContent)).toEqual(['North', 'South']);
  expect(texts.map(t => t.previousElementSibling.getAttribute('fill'))).toEqual(['#112233', '#778899']);
});

it('keeps saved manual legend boxes and plot geometry independent from automatic layout', () => {
  const appearance = { legendPos: 'bottom', legend: { x: .1, y: .85, w: .8, h: .1 }, plot: { x: .2, y: .2, w: .6, h: .5 } };
  const { chart, render } = setup('column', ['North', 'South'], appearance), before = JSON.stringify(chart);
  const doc = render();
  expect(labels(doc)).toHaveLength(2); // Manual layout retains distributed entries.
  const texts = [...doc.querySelectorAll('text')].filter(t => ['North', 'South'].includes(t.textContent));
  expect(+texts[1].getAttribute('x') - +texts[0].getAttribute('x')).toBeGreaterThan(150);
  const plot = doc.querySelector('.chart-plot-border');
  expect(+plot.getAttribute('y')).toBe(80);
  expect(+plot.getAttribute('height')).toBe(200);
  expect(JSON.stringify(chart)).toBe(before);
});

it.each(['column', 'bar', 'line', 'scatter', 'pie', 'donut'])('fits measured %s keys and labels inside a compact manual legend', type => {
  for (const [size, W, H] of [[12, 640, 320], [18, 900, 460], [24, 1100, 600]]) {
    const line = ['line', 'scatter'].includes(type);
    const box = { x: .1, y: .04, w: size * (line ? 16 : 13) / W, h: size * 2.4 / H };
    const { render } = setup(type, ['North 23', 'South 42'], { legendPos: 'top', legend: box, legendStyle: { size } }, 'top');
    const texts = labels(render(W, H));
    expect(texts.map(t => t.textContent)).toEqual(['North 23', 'South 42']);
    expect(+texts[0].getAttribute('y')).toBe(+texts[1].getAttribute('y'));
    expect(keyLeft(texts[0])).toBeGreaterThanOrEqual(box.x * W);
    expect(+texts[1].getAttribute('x') + widthOf('South 42', size)).toBeLessThanOrEqual((box.x + box.w) * W + .02);
    expect(+texts[0].getAttribute('y')).toBeGreaterThan(box.y * H);
    expect(+texts[0].getAttribute('y')).toBeLessThan((box.y + box.h) * H);
    if (!line) expect(+texts[0].previousElementSibling.getAttribute('width')).toBeCloseTo(size * .65, 2);
  }
});

it.each(['column', 'pie'])('distributes a tall manual %s legend and wraps its text without changing the saved box', type => {
  const appearance = { legendPos: 'right', legend: { x: .7, y: .15, w: .25, h: .7 }, legendStyle: { size: 18 } };
  const { chart, render } = setup(type, ['North', 'South', 'West'], appearance, 'right'), before = JSON.stringify(chart);
  const texts = labels(render(700, 400));
  expect(texts.map(t => t.textContent)).toEqual(['North', 'South', 'West']);
  expect(+texts[1].getAttribute('y') - +texts[0].getAttribute('y')).toBeCloseTo(280 / 3, 1);
  expect(+texts[2].getAttribute('y') - +texts[1].getAttribute('y')).toBeCloseTo(280 / 3, 1);
  expect(JSON.stringify(chart)).toBe(before);
  const narrow = setup(type, ['A long northern name', 'Another southern name'], {
    ...appearance, legend: { x: .7, y: .1, w: .15, h: .8 }, legendStyle: { size: 14 },
  }, 'right');
  const wrapped = labels(narrow.render(600, 500));
  expect(wrapped.map(t => t.textContent).join(' ')).toBe('A long northern name Another southern name');
  expect(wrapped.length).toBeGreaterThan(2);
  expect(wrapped.every(t => +t.getAttribute('x') + widthOf(t.textContent, 14) <= 510.02)).toBe(true);
});

it('does not wrap exactly fitting measured names at fractional font sizes', () => {
  for (const size of [11 / 3, 44 / 3, 53 / 3, 68 / 3]) {
    for (const legend of [null, { x: .05, y: .8, w: .9, h: .15 }]) {
      const names = ['Northern trade costs', 'East costs', 'Revenue'];
      const { render } = setup('column', names, { legend, legendStyle: { size } });
      expect(labels(render(1000)).map(t => t.textContent)).toEqual(names);
    }
  }
});

it.each(['column', 'pie'])('preserves manual %s legend geometry through duplication, editing and native XLSX reopening', async type => {
  const box = { x: .12, y: .76, w: .76, h: .16 };
  const { chart, data } = setup(type, ['North', 'South'], { legend: box, legendStyle: { font: 'arial', size: 18 } });
  chart.sourceRefs = data.series.map(s => ({ name: s.name, literal: { categories: data.categories, values: s.values } }));
  const wb = new Workbook({ sheets: [{ name: 'Regions', charts: [chart] }] }), sheet = wb.activeSheet;
  const copy = wb.chartById(sheet.id, wb.duplicateChart(sheet.id, sheet.charts[0].id));
  expect(copy.appearance.legend).toEqual(box);
  copy.sourceRefs[0].literal.values[0] = 27;
  expect(sheet.charts[0].sourceRefs[0].literal.values[0]).not.toBe(27);
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  for (const restored of back.activeSheet.charts) {
    expect(restored.appearance.legend).toEqual(box);
    expect(restored.appearance.legendStyle.size).toBe(18);
    expect(restored.appearance.legendStyle.font).toBe('arial');
    const texts = labels(xml(renderChartSvg(data, restored, 700, 400)));
    expect(texts.map(t => t.textContent)).toEqual(['North', 'South']);
    expect(texts[0].getAttribute('y')).toBe(texts[1].getAttribute('y'));
  }
  expect(back.activeSheet.charts[1].sourceRefs[0].literal.values[0]).toBe(27);
});

it('retains automatic layout through duplication and native-only XLSX reopening', async () => {
  const { chart, data } = setup();
  chart.sourceRefs = data.series.map(s => ({ name: s.name, literal: { categories: data.categories, values: s.values } }));
  const wb = new Workbook({ sheets: [{ name: 'Regions', charts: [chart] }] }), sheet = wb.activeSheet;
  const copy = wb.duplicateChart(sheet.id, sheet.charts[0].id);
  expect(wb.chartById(sheet.id, copy).appearance.legend).toBeNull();
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  expect(xml(part).getElementsByTagNameNS('*', 'legend')[0].getElementsByTagNameNS('*', 'manualLayout')).toHaveLength(0);
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.activeSheet.charts[0].appearance.legend).toBeNull();
  expect(labels(xml(renderChartSvg(data, back.activeSheet.charts[0], 700, 400))).map(t => t.textContent)).toEqual(['North', 'South']);
});

it('measures the selected legend font including weight and italic styling', () => {
  const measured = [], context = { font: '', measureText(text) { measured.push(this.font); return { width: [...text].length * 20 }; } };
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return context; } });
  try {
    for (const legend of [null, { x: .2, y: .8, w: .6, h: .15 }]) {
      const { render } = setup('column', ['North', 'South'], { legend, legendStyle: { font: 'arial', size: 20, bold: true, italic: true } });
      const texts = labels(render(800));
      expect((keyLeft(texts[0]) + +texts[1].getAttribute('x') + 100) / 2).toBeCloseTo(400, 1);
      expect(measured.some(font => font.startsWith('italic 700 20px '))).toBe(true);
      expect(texts.every(t => t.getAttribute('font-weight') === '700' && t.getAttribute('font-style') === 'italic')).toBe(true);
    }
  } finally { vi.unstubAllGlobals(); }
});
