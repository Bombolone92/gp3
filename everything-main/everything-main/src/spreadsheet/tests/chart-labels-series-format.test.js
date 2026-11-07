import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { chartData, defaultChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

// Value labels were all written in the format of the first formatted series, and a combo chart's
// right-hand axis in none: a Units series beside a Revenue column was labelled $12, and a percent line
// on its own axis read 0, 0.05, 0.10 with labels $0.12, while the tooltips already read each series in
// its own cells' format. The README promises value labels in the data's currency, percent or date format.
function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  return { wb, id };
}
const labels = (svg) => [...svg.matchAll(/<text [^>]*font-size="(?:10|8\.5)"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const titles = (svg) => [...svg.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]);
const rightAxis = (svg) => [...svg.matchAll(/<text class="y2"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const leftAxis = (svg) => [...svg.matchAll(/<text x="[^"]+" y="[^"]+" text-anchor="end" font-size="11" fill="var\(--ink-3\)">([^<]*)<\/text>/g)].map((m) => m[1]);
const draw = (wb, id, chart) => renderChartSvg(chartData(wb, id, chart), chart, 480, 300);

describe('value labels in each series\' own format', () => {
  const UNITS_AND_MONEY = { A1: 'Month', B1: 'Units', C1: 'Revenue', A2: 'Jan', B2: '12', C2: '$1,200', A3: 'Feb', B3: '15', C3: '$1,500', A4: 'Mar', B4: '9', C4: '$900' };

  it('label a plain series plainly beside a currency series, as their tooltips read', () => {
    const { wb, id } = book(UNITS_AND_MONEY);
    for (const type of ['column', 'bar', 'line', 'radar']) {
      const chart = { ...defaultChart(parseRange('A1:C4'), { r: 0, c: 5 }), type, labels: true, legend: false };
      const svg = draw(wb, id, chart);
      // (A radar's ring values come first among the small labels.)
      expect(labels(svg).slice(-6), type).toEqual(['12', '15', '9', '$1,200', '$1,500', '$900']);
      expect(titles(svg), type).toContain('Units · Jan: 12');
      expect(titles(svg), type).toContain('Revenue · Jan: $1,200');
    }
    // The value axis still reads in the format of the first formatted series.
    expect(leftAxis(draw(wb, id, { ...defaultChart(parseRange('A1:C4'), { r: 0, c: 5 }), labels: true }))).toEqual(['$0', '$500', '$1,000', '$1,500', '$2,000']);
  });

  it('label a combo chart\'s right-hand axis and its line in the line\'s format, and the bars in theirs', () => {
    const { wb, id } = book({ A1: 'Month', B1: 'Sales', C1: 'Margin', A2: 'Jan', B2: '$100', C2: '12%', A3: 'Feb', B3: '$200', C3: '18%', A4: 'Mar', B4: '$300', C4: '25%' });
    const chart = { ...defaultChart(parseRange('A1:C4'), { r: 0, c: 5 }), type: 'combo', secondaryAxis: true, labels: true, legend: false };
    const svg = draw(wb, id, chart);
    expect(rightAxis(svg)).toEqual(['0%', '5%', '10%', '15%', '20%', '25%', '30%']);
    expect(labels(svg)).toEqual(['$100', '$200', '$300', '12%', '18%', '25%']);
    expect(leftAxis(svg)).toEqual(['$0', '$100', '$200', '$300', '$400']);
    expect(titles(svg)).toContain('Margin · Jan: 12%');
    // Without its own axis the line still shares the bars' axis, its labels in its own format.
    const shared = draw(wb, id, { ...chart, secondaryAxis: false });
    expect(rightAxis(shared)).toEqual([]);
    expect(labels(shared)).toEqual(['$100', '$200', '$300', '12%', '18%', '25%']);
  });

  it('keep a percent line on its own axis off the bars\' axis when the bars are plain numbers', () => {
    const { wb, id } = book({ A1: 'Month', B1: 'Sales', C1: 'Margin', A2: 'Jan', B2: '100', C2: '12%', A3: 'Feb', B3: '200', C3: '18%' });
    const chart = { ...defaultChart(parseRange('A1:C3'), { r: 0, c: 5 }), type: 'combo', secondaryAxis: true, labels: true, legend: false };
    const svg = draw(wb, id, chart);
    expect(leftAxis(svg)).toEqual(['0', '50', '100', '150', '200', '250']);
    expect(rightAxis(svg)).toEqual(['0%', '5%', '10%', '15%', '20%']);
    expect(labels(svg)).toEqual(['100', '200', '12%', '18%']);
  });

  it('label a waterfall\'s steps and total in its series\' currency', () => {
    const { wb, id } = book({ A1: 'Step', B1: 'Change', A2: 'Start', B2: '$100', A3: 'Fees', B3: '-$30', A4: 'Sales', B4: '$50' });
    const chart = { ...defaultChart(parseRange('A1:B4'), { r: 0, c: 5 }), type: 'waterfall', labels: true, legend: false };
    expect(labels(draw(wb, id, chart))).toEqual(['+$100', '−$30', '+$50', '$120']);
  });

  it('label bubbles with their sizes in the size column\'s format', () => {
    const { wb, id } = book({ A1: 'X', B1: 'Y', C1: 'Share', A2: '1', B2: '10', C2: '25%', A3: '2', B3: '20', C3: '50%' });
    const chart = { ...defaultChart(parseRange('A1:C3'), { r: 0, c: 5 }), type: 'bubble', labels: true, legend: false };
    expect(labels(draw(wb, id, chart))).toEqual(['25%', '50%']);
  });

  it('label the shares of a 100% stack as percents and a combo\'s line beside it in its own format', () => {
    const { wb, id } = book({ A1: 'Month', B1: 'A', C1: 'B', D1: 'Rate', A2: 'Jan', B2: '$30', C2: '$10', D2: '12%', A3: 'Feb', B3: '$20', C3: '$20', D3: '18%' });
    const stack = { ...defaultChart(parseRange('A1:C3'), { r: 0, c: 6 }), stacked: true, stack100: true, labels: true, legend: false };
    expect(labels(draw(wb, id, stack))).toEqual(['75%', '50%', '25%', '50%']);
    const combo = { ...defaultChart(parseRange('A1:D3'), { r: 0, c: 6 }), type: 'combo', seriesIn: 'cols', stacked: true, stack100: true, secondaryAxis: true, labels: true, legend: false };
    expect(labels(draw(wb, id, combo))).toEqual(['75%', '50%', '25%', '50%', '12%', '18%']);
  });
});
