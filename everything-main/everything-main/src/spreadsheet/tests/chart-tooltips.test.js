import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);

describe('chart tooltips', () => {
  it('retains custom series formats after duplication, editing and native-only XLSX reopening', async () => {
    const { wb, id } = book({ A1: 'Item', B1: 'Value', A2: 'a', B2: '1234.5', A3: 'b', B3: '12.25' });
    wb.applyStyle(id, parseRange('B2:B3'), { fmt: 'custom', code: '"USD "#,##0.00' });
    const chartId = wb.addChart(id, { ...defaultChart(parseRange('A1:B3'), { r: 0, c: 5 }), labels: true, legend: false });
    wb.duplicateChart(id, chartId);
    wb.setInput(id, 1, 1, '4321.75');
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')); part.size = part.content.length;
    const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'formats.xlsx');
    expect(back.activeSheet.charts).toHaveLength(2);
    for (const ch of back.activeSheet.charts) {
      const svg = renderChartSvg(chartData(back, back.activeSheetId, ch), ch, 600, 400);
      expect(titles(svg)).toContain('Value · a: USD 4,321.75');
      expect(svg).toContain('>USD 4,321.75</text>');
      expect(svg).toContain('>USD 12.25</text>');
    }
    wb.undo(); expect(wb.getValue(id, 1, 1)).toBe(1234.5);
  });

  it.each([
    [{ fmt: 'custom', code: '"€"#,##0.00;("€"#,##0.00);"zero"' }, ['€1,234.50', '(€12.25)', 'zero']],
    [{ fmt: 'custom', code: '0.0" kg"' }, ['1234.5 kg', '-12.3 kg', '0.0 kg']],
    [{ fmt: 'custom', code: ';;;' }, ['', '', '']],
  ])('honors complete series formats in labels and tooltips: %j', (style, expected) => {
    const { wb, id } = book({ A1: 'Item', B1: 'Value', A2: 'a', B2: '1234.5', A3: 'b', B3: '-12.25', A4: 'c', B4: '0' });
    wb.applyStyle(id, parseRange('B2:B4'), style);
    const base = { ...defaultChart(parseRange('A1:B4'), { r: 0, c: 5 }), labels: true, legend: false };
    for (const type of ['column', 'bar', 'line', 'radar']) {
      const chart = { ...base, type }, svg = renderChartSvg(chartData(wb, id, chart), chart, 600, 400);
      for (const [i, category] of ['a', 'b', 'c'].entries()) {
        expect(titles(svg), type).toContain(`Value · ${category}: ${expected[i]}`);
        if (expected[i]) expect(svg, type).toContain(`>${expected[i]}</text>`);
      }
    }
  });

  const CELLS = {
    A1: 'Item', B1: 'Money', C1: 'Share', D1: 'When', E1: 'Sum', F1: 'Noise',
    A2: 'a', B2: '$1,500', C2: '10%', D2: '2024-01-15', E2: '=0.1+0.2', F2: '1e-9',
    A3: 'b', B3: '$200', C3: '5%', D3: '2024-01-16', E3: '1', F3: '2e-9',
    A4: 'c', B4: '$300', C4: '8%', D4: '2024-01-17', E4: '2', F4: '3e-9',
  };

  it('write each value in its own cells\' number format, not as a raw JavaScript number', () => {
    const { wb, id } = book(CELLS);
    const chart = { ...defaultChart(parseRange('A1:F4'), { r: 0, c: 8 }), seriesIn: 'cols', legend: false };
    const d = chartData(wb, id, chart);
    expect(d.series.map((s) => s.style?.fmt ?? null)).toEqual(['currency', 'percent', 'date', null, null]);
    for (const type of ['column', 'bar', 'line', 'radar']) {
      const tips = titles(renderChartSvg(d, { ...chart, type }, 480, 300));
      expect(tips).toContain('Money · a: $1,500');
      expect(tips).toContain('Share · a: 10%'); // typed as 10%, so the cell shows no decimals
      expect(tips).toContain('When · a: 2024-01-15');
      expect(tips).toContain('Sum · a: 0.3');
      expect(tips).toContain('Noise · a: 0.000000001');
    }
  });

  it('honour the cells\' decimal places and currency', () => {
    const { wb, id } = book({ A1: 'Item', B1: 'Price', A2: 'a', B2: '1500', A3: 'b', B3: '250.5' });
    wb.applyStyle(id, parseRange('B2:B3'), { fmt: 'currency', cur: 'EUR', dec: 0 });
    const chart = { ...defaultChart(parseRange('A1:B3'), { r: 0, c: 4 }), legend: false };
    const tips = titles(renderChartSvg(chartData(wb, id, chart), chart, 480, 300));
    expect(tips).toEqual(['Price · a: €1,500', 'Price · b: €251']);
    const pie = titles(renderChartSvg(chartData(wb, id, chart), { ...chart, type: 'pie' }, 480, 300));
    expect(pie).toEqual(['a: €1,500 (86%)', 'b: €251 (14%)']);
  });

  it('name the value, with its share after it, on a 100% stacked chart instead of the share alone', () => {
    const { wb, id } = book({ A1: 'Item', B1: 'Money', C1: 'Other', A2: 'a', B2: '$1,500', C2: '$500', A3: 'b', B3: '$100', C3: '$300' });
    const chart = { ...defaultChart(parseRange('A1:C3'), { r: 0, c: 5 }), stacked: true, stack100: true, legend: false };
    const tips = titles(renderChartSvg(chartData(wb, id, chart), chart, 480, 300));
    expect(tips).toEqual(['Money · a: $1,500 (75%)', 'Money · b: $100 (25%)', 'Other · a: $500 (25%)', 'Other · b: $300 (75%)']);
    const area = titles(renderChartSvg(chartData(wb, id, chart), { ...chart, type: 'area' }, 480, 300));
    expect(area).toContain('Money · a: $1,500 (75%)');
  });

  it('write a scatter point\'s coordinates and a bubble\'s size in their own formats', () => {
    const { wb, id } = book({ A1: 'When', B1: 'Price', C1: 'Size', A2: '2024-01-15', B2: '$1,500', C2: '=0.1+0.2', A3: '2024-01-16', B3: '$250', C3: '4' });
    const chart = { ...defaultChart(parseRange('A1:C3'), { r: 0, c: 5 }), type: 'bubble', legend: false };
    const tips = titles(renderChartSvg(chartData(wb, id, chart), chart, 480, 300));
    expect(tips).toEqual(['Price: (2024-01-15, $1,500), size 0.3', 'Price: (2024-01-16, $250), size 4']);
  });
});
