import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// A chart over a spilled range read each cell's style from the cell itself, which a spilled cell has none
// of (only the anchor carries the array's number format, and the grid shows every spilled cell through
// it), so a spilled column of dates was one date-like cell over plain numbers: charted as a numeric series
// of 45293s rather than as the categories the same data gives when charted from its source.
function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
const SOURCE = { A1: '2024-01-02', B1: '10', A2: '2024-01-09', B2: '20', A3: '2024-01-16', B3: '15' };

describe('charts over spilled ranges', () => {
  it('read a spilled column of dates as categories, as the source range is read and the grid shows it', () => {
    const { wb, id } = book({ ...SOURCE, D1: '=A1:A3', E1: '10', E2: '20', E3: '15' });
    expect([0, 1, 2].map((r) => wb.getDisplay(id, r, 3))).toEqual(['2024-01-02', '2024-01-09', '2024-01-16']);
    const spilled = chartData(wb, id, defaultChart(parseRange('D1:E3'), { r: 0, c: 7 }));
    const source = chartData(wb, id, defaultChart(parseRange('A1:B3'), { r: 0, c: 7 }));
    expect(source.categories).toEqual(['2024-01-02', '2024-01-09', '2024-01-16']);
    expect(spilled.categories).toEqual(source.categories);
    expect(spilled.series.map((s) => s.values)).toEqual([[10, 20, 15]]);
    expect(spilled.valueStyle).toBeNull();
  });

  it('carry the anchor\'s number format into a spilled series, so its tooltips read as the cells do', () => {
    const { wb, id } = book({ A1: 'Item', B1: 'Price', A2: 'a', B2: '1500', A3: 'b', B3: '250.5', D1: 'Item', E1: 'Price', D2: 'a', D3: 'b', E2: '=B2:B3' });
    wb.applyStyle(id, parseRange('E2:E2'), { fmt: 'currency', cur: 'EUR', dec: 0 });
    expect([1, 2].map((r) => wb.getDisplay(id, r, 4))).toEqual(['€1,500', '€251']);
    const chart = { ...defaultChart(parseRange('D1:E3'), { r: 0, c: 7 }), legend: false };
    const d = chartData(wb, id, chart);
    expect(d.series[0].style).toMatchObject({ fmt: 'currency', cur: 'EUR' });
    expect(d.valueStyle).toMatchObject({ fmt: 'currency', cur: 'EUR' });
    expect(titles(renderChartSvg(d, chart, 480, 300))).toEqual(['Price · a: €1,500', 'Price · b: €251']);
  });

  it('let a spilled cell\'s own format win over the anchor\'s, as the cell shows it', () => {
    const { wb, id } = book({ ...SOURCE, D1: '=A1:A3', E1: '10', E2: '20', E3: '15' });
    wb.applyStyle(id, parseRange('D2:D3'), { fmt: 'number', dec: 0, group: false }); // shown as serials on screen
    expect(wb.getDisplay(id, 1, 3)).toBe('45300');
    const d = chartData(wb, id, defaultChart(parseRange('D1:E3'), { r: 0, c: 7 }));
    // One date-like cell over two plain numbers: the column is a series, as the screen shows it.
    expect(d.categories).toEqual(['1', '2', '3']);
    expect(d.series.map((s) => s.values)).toEqual([[45293, 45300, 45307], [10, 20, 15]]);
  });
});
