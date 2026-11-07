import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// A histogram over currency or percent cells wrote its counts in that format: the count axis read
// $0 $1 $2 $3, the count labels $2, and a tooltip "Count · 5–16.75: $2.00" (200% over percent cells).
// The counts are plain numbers whatever the cells hold. The bin edges are the other way round: they
// name values from those very cells, so they read in the cells' own format.
function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}
const labels = (svg) => [...svg.matchAll(/<text [^>]*font-size="(?:10|8\.5)"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
const leftAxis = (svg) => [...svg.matchAll(/<text x="[^"]+" y="[^"]+" text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const categories = (svg) => [...svg.matchAll(/<text [^>]*font-size="11" fill="var\(--ink-2\)">([^<]*)<\/text>/g)].map((m) => m[1]);

describe('a histogram\'s counts', () => {
  it('read as plain numbers over currency cells, on the axis, in the labels and in the tooltips', () => {
    const { wb, id } = book({ A2: '5', A3: '12', A4: '18', A5: '25', A6: '31', A7: '44', A8: '47', A9: '52' });
    wb.applyStyle(id, parseRange('A2:A9'), { fmt: 'currency', cur: 'USD', dec: 2 });
    const chart = { ...defaultChart(parseRange('A2:A9'), { r: 0, c: 5 }), type: 'histogram', bins: 4, labels: true, legend: false };
    const data = chartData(wb, id, chart);
    expect(data.valueStyle?.fmt).toBe('currency'); // the cells' format, which the counts do not share
    const svg = renderChartSvg(data, chart, 480, 300);
    expect(leftAxis(svg)).toEqual(['0', '1', '2', '3']);
    expect(labels(svg)).toEqual(['2', '2', '1', '3']);
    expect(titles(svg)).toEqual(['Count · $5–$16.75: 2', 'Count · $16.75–$28.5: 2', 'Count · $28.5–$40.25: 1', 'Count · $40.25–$52: 3']);
    expect(categories(svg)).toEqual(['$5–$16.75', '$16.75–$28.5', '$28.5–$40.25', '$40.25–$52']);
  });

  it('read as plain numbers over percent cells', () => {
    const { wb, id } = book({ A1: '5%', A2: '10%', A3: '15%', A4: '20%', A5: '25%' });
    const chart = { ...defaultChart(parseRange('A1:A5'), { r: 0, c: 5 }), type: 'histogram', bins: 2, labels: true, legend: false };
    const svg = renderChartSvg(chartData(wb, id, chart), chart, 480, 300);
    expect(leftAxis(svg)).toEqual(['0', '1', '2', '3']);
    expect(labels(svg)).toEqual(['2', '3']);
    expect(titles(svg)).toEqual(['Count · 5%–15%: 2', 'Count · 15%–25%: 3']);
    expect(categories(svg)).toEqual(['5%–15%', '15%–25%']);
  });

  it('bin dates as dates, not as the serial numbers behind them', () => {
    const { wb, id } = book({ A1: '2024-01-01', A2: '2024-02-01', A3: '2024-03-01', A4: '2024-04-01', A5: '2024-05-01' });
    const chart = { ...defaultChart(parseRange('A1:A5'), { r: 0, c: 5 }), type: 'histogram', bins: 2, legend: false };
    const svg = renderChartSvg(chartData(wb, id, chart), chart, 480, 300);
    // The axis labels are cut to the width a category gets; the tooltips carry the bin whole.
    for (const c of categories(svg)) expect(c).toMatch(/^\d{4}-\d{2}-\d{2}–/);
    for (const t of titles(svg)) expect(t).toMatch(/^Count · \d{4}-\d{2}-\d{2}–\d{4}-\d{2}-\d{2}: \d+$/);
    for (const l of leftAxis(svg)) expect(l).toMatch(/^[\d.]+$/); // the counts stay plain numbers
  });
});
