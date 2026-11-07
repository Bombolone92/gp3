import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart, axisLabel } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}

const valueLabels = (svg) => [...svg.matchAll(/<text x="[^"]+" y="[^"]+" text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const DATES = { A1: 'Task', B1: 'Due', A2: 'Design', B2: '2024-01-10', A3: 'Build', B3: '2024-03-01', A4: 'Ship', B4: '2024-04-15' };

describe('date-formatted values in charts', () => {
  it('carries the date format into the value axis instead of 45K-style serials', () => {
    const { wb, id } = book(DATES);
    const chart = defaultChart(parseRange('A1:B4'), { r: 0, c: 4 });
    const d = chartData(wb, id, chart);
    expect(d.valueStyle).toMatchObject({ fmt: 'date' });
    expect(d.series[0].values.every((v) => v > 40000)).toBe(true);
    const labels = valueLabels(renderChartSvg(d, chart, 480, 300));
    expect(labels.length).toBeGreaterThan(2);
    for (const label of labels) expect(label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The axis starts near the data, not at day zero.
    for (const label of labels) expect(Number(label.slice(0, 4))).toBeGreaterThanOrEqual(2023);
  });

  it('uses the cells\' date style for the labels and for values written on the bars', () => {
    const { wb, id } = book(DATES);
    wb.applyStyle(id, parseRange('B2:B4'), { fmt: 'date', dateStyle: 'medium' });
    const chart = { ...defaultChart(parseRange('A1:B4'), { r: 0, c: 4 }), type: 'bar', labels: true };
    const d = chartData(wb, id, chart);
    const svg = renderChartSvg(d, chart, 480, 300);
    const ticks = [...svg.matchAll(/text-anchor="middle" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(ticks.length).toBeGreaterThan(2);
    for (const tick of ticks) expect(tick).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    expect(svg).toContain('>Jan 10, 2024<');
  });

  it('leaves a scatter chart\'s value axis alone when only its x column holds dates', () => {
    const { wb, id } = book({ A1: '2024-01-01', B1: '10', A2: '2024-02-01', B2: '20', A3: '2024-03-01', B3: '35' });
    const chart = { ...defaultChart(parseRange('A1:B3'), { r: 0, c: 4 }), type: 'scatter' };
    const d = chartData(wb, id, chart);
    expect(d.valueStyle).toBeNull();
    expect(valueLabels(renderChartSvg(d, chart, 480, 300))).toEqual(['0', '10', '20', '30', '40']);
  });

  it('reads a scatter chart\'s x column of dates as dates on its x axis and in its tooltips, stepping in whole days', () => {
    const { wb, id } = book({ A1: 'Date', B1: 'Val', A2: '2024-01-01', B2: '1', A3: '2024-01-02', B3: '5', A4: '2024-01-03', B4: '3', A5: '2024-01-04', B5: '9' });
    const chart = { ...defaultChart(parseRange('A1:B5'), { r: 0, c: 4 }), type: 'scatter' };
    const d = chartData(wb, id, chart);
    expect(d.xStyle).toMatchObject({ fmt: 'date' });
    expect(d.valueStyle).toBeNull();
    const svg = renderChartSvg(d, chart, 480, 300);
    const xTicks = [...svg.matchAll(/text-anchor="middle" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
    expect(xTicks.length).toBeGreaterThan(2);
    for (const tick of xTicks) expect(tick).toMatch(/^(2023-12-31|2024-01-0\d)$/);
    expect(new Set(xTicks).size).toBe(xTicks.length); // whole-day steps: no two ticks read the same date
    expect(svg).toContain('<title>Val: (2024-01-02, 5)</title>');
    // The cells' own date style carries too, as it does on the value axis.
    wb.applyStyle(id, parseRange('A2:A5'), { fmt: 'date', dateStyle: 'medium' });
    const styled = renderChartSvg(chartData(wb, id, chart), chart, 480, 300);
    expect(styled).toContain('>Jan 2, 2024<');
    // A scatter chart whose x column holds plain numbers keeps its number ticks.
    const plain = book({ A1: 'x', B1: 'y', A2: '1', B2: '2', A3: '2', B3: '4', A4: '3', B4: '6' });
    const pd = chartData(plain.wb, plain.id, chart);
    expect(pd.xStyle).toBeNull();
    expect(renderChartSvg(pd, chart, 480, 300)).toContain('<title>y: (2, 4)</title>');
  });

  it('formats a date or time axis value with formatValue', () => {
    expect(axisLabel(45292, { fmt: 'date' }, 10)).toBe('2024-01-01');
    expect(axisLabel(0.5, { fmt: 'time' })).toMatch(/12:00/);
    expect(axisLabel(45292, { fmt: 'currency', cur: 'USD' })).toBe('$45.3K'); // other formats as before
  });

  it('steps a date axis in whole days, so neighbouring ticks never read the same date', () => {
    const chart = defaultChart(parseRange('A1:B3'), { r: 0, c: 4 });
    const days = book({ A1: 'Task', B1: 'Due', A2: 'a', B2: '2024-01-10', A3: 'b', B3: '2024-01-11' });
    expect(valueLabels(renderChartSvg(chartData(days.wb, days.id, chart), chart, 480, 300))).toEqual(['2024-01-09', '2024-01-10', '2024-01-11', '2024-01-12']);
    const one = book({ A1: 'Task', B1: 'Due', A2: 'a', B2: '2024-01-10' });
    const single = valueLabels(renderChartSvg(chartData(one.wb, one.id, chart), chart, 480, 300));
    expect(single.length).toBeGreaterThan(1);
    expect(new Set(single).size).toBe(single.length);
    // Dates with a time of day keep finer ticks: their labels tell them apart.
    const times = book({ A1: 'Task', B1: 'When', A2: 'a', B2: '2024-01-10 08:00', A3: 'b', B3: '2024-01-10 20:00' });
    const stamps = valueLabels(renderChartSvg(chartData(times.wb, times.id, chart), chart, 480, 300));
    expect(stamps.length).toBeGreaterThan(2);
    expect(new Set(stamps).size).toBe(stamps.length);
    for (const label of stamps) expect(label).toMatch(/^2024-01-1[01] \d{2}:\d{2}$/);
  });

  it('reads a custom date code, as dates arrive from files, for categories and for the value axis', () => {
    const { wb, id } = book({ A1: 'Date', B1: 'Sales', A2: '2024-01-01', B2: '10', A3: '2024-01-02', B3: '20', A4: '2024-01-03', B4: '30' });
    wb.applyStyle(id, parseRange('A2:A4'), { fmt: 'custom', code: 'dd/mm/yyyy' });
    const d = chartData(wb, id, defaultChart(parseRange('A1:B4'), { r: 0, c: 4 }));
    expect(d.categories).toEqual(['01/01/2024', '02/01/2024', '03/01/2024']);
    expect(d.series.map((s) => s.name)).toEqual(['Sales']);

    const dated = book(DATES);
    dated.wb.applyStyle(dated.id, parseRange('B2:B4'), { fmt: 'custom', code: 'm/d/yyyy' });
    const chart = defaultChart(parseRange('A1:B4'), { r: 0, c: 4 });
    const dd = chartData(dated.wb, dated.id, chart);
    expect(dd.valueStyle).toMatchObject({ fmt: 'custom', code: 'm/d/yyyy', dateKind: 'date' });
    const labels = valueLabels(renderChartSvg(dd, chart, 480, 300));
    expect(labels.length).toBeGreaterThan(2);
    for (const label of labels) expect(label).toMatch(/^\d{1,2}\/\d{1,2}\/20\d{2}$/); // native range headroom can extend into the preceding year
    expect(axisLabel(45292, { fmt: 'custom', code: 'yyyy"-"mm', dateKind: 'date' })).toBe('2024-01');
  });
});
