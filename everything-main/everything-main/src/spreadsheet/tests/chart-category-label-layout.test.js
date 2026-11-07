import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
const parser = new (new JSDOM('').window.DOMParser)();
it('reserves category space on the high edge independently of a right legend', () => {
  const chart = normalizeChart({ type: 'bar', legend: true, legendPos: 'right', range: {r1:0,c1:0,r2:1,c2:1}, anchor:{r:0,c:3}, appearance:{} });
  const plot = (position, categories) => {
    const ch = normalizeChart({...chart,appearance:{...chart.appearance,xLabelPosition:position}});
    const doc = parser.parseFromString(renderChartSvg({categories,series:[{name:'Values',values:[3,8]}]},ch,600,320),'image/svg+xml');
    const p = doc.querySelector('clipPath rect');
    return {left:+p.getAttribute('x'),right:+p.getAttribute('x') + +p.getAttribute('width')};
  };
  const short = ['A','B'], long = ['First lengthy category','Second lengthy category'];
  // Low labels consume the left margin; changing their length must not
  // reserve another copy of the value-axis margin beside the right legend.
  expect(plot('low',short).right).toBe(plot('low',long).right);
  expect(plot('low',short).right).toBe(plot('none',short).right);
  expect(plot('high',long).right).toBeLessThan(plot('high',short).right);
  expect(plot('high',long).left).toBe(plot('none',short).left);
});
