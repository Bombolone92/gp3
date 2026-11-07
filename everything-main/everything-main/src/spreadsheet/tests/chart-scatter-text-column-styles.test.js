import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// A scatter or bubble chart read its x and value formats from column positions, counting from the first
// column after the category column; scatter charts have no category column and skip an all-text column
// from their series, so with a Name column first the dates' format landed on the value axis (amounts
// labelled 1900-01-09…) and the x axis of dates read 45.3K.
function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
const yLabels = (svg) => [...svg.matchAll(/text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const xLabels = (svg) => [...svg.matchAll(/text-anchor="middle" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const NAMED = { A1: 'Name', B1: 'When', C1: 'Amount', A2: 'x', B2: '1/2/2024', C2: '$10', A3: 'y', B3: '1/3/2024', C3: '$20', A4: 'z', B4: '1/4/2024', C4: '$15' };

describe('scatter and bubble charts with a leading text column', () => {
  it('take the x format from the x series and the value format from the y series', () => {
    const { wb, id } = book(NAMED);
    const chart = { ...defaultChart(parseRange('A1:C4'), { r: 0, c: 5 }), type: 'scatter', legend: false };
    const d = chartData(wb, id, chart);
    expect(d.xStyle).toMatchObject({ fmt: 'date' });
    expect(d.valueStyle).toMatchObject({ fmt: 'currency', cur: 'USD' });
    expect(d.series.map((s) => s.name)).toEqual(['Amount']);
    const svg = renderChartSvg(d, chart, 480, 300);
    for (const label of yLabels(svg)) expect(label).toMatch(/^\$\d+$/);
    for (const label of xLabels(svg)) expect(label).toMatch(/^2024-01-0\d$/);
    expect(titles(svg)).toContain('Amount: (2024-01-02, $10)');
    // The same data without the Name column reads the same way.
    const plain = chartData(wb, id, { ...chart, range: parseRange('B1:C4') });
    expect(plain.xStyle).toMatchObject({ fmt: 'date' });
    expect(plain.valueStyle).toMatchObject({ fmt: 'currency' });
  });

  it('size a bubble chart from its own size series, whatever columns precede it', () => {
    const { wb, id } = book({ ...NAMED, D1: 'Share', D2: '10%', D3: '25%', D4: '5%' });
    const chart = { ...defaultChart(parseRange('A1:D4'), { r: 0, c: 6 }), type: 'bubble', legend: false };
    const d = chartData(wb, id, chart);
    expect(d.xStyle).toMatchObject({ fmt: 'date' });
    expect(d.valueStyle).toMatchObject({ fmt: 'currency' });
    expect(d.sizeStyle).toMatchObject({ fmt: 'percent' });
    expect(d.sizes).toEqual([0.1, 0.25, 0.05]);
    expect(titles(renderChartSvg(d, chart, 480, 300))).toContain('Amount: (2024-01-03, $20), size 25%');
  });

  it('leave a value axis without a format when only the x series has one', () => {
    const { wb, id } = book({ A1: 'Name', B1: 'Date', C1: 'Val', A2: 'a', B2: '2024-01-01', C2: '10', A3: 'b', B3: '2024-02-01', C3: '20' });
    const d = chartData(wb, id, { ...defaultChart(parseRange('A1:C3'), { r: 0, c: 5 }), type: 'scatter' });
    expect(d.xStyle).toMatchObject({ fmt: 'date' });
    expect(d.valueStyle).toBeNull();
  });
});
