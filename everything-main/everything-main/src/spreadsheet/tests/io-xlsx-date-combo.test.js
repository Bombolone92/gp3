import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { areaComboXlsx } from './helpers/xlsx-area-combo-fixture.js';

// Native date axis with a nine-day gap and shared area/column/line groups.
function fixture() {
  const zip = X.CFB.read(areaComboXlsx(), { type: 'array' });
  const edit = (path, fn) => {
    const part = X.CFB.find(zip, path);
    part.content = new TextEncoder().encode(fn(new TextDecoder().decode(part.content)));
    part.size = part.content.length;
  };
  edit('/xl/worksheets/sheet1.xml', xml => xml.replace('<v>40</v>', '<v>45000</v>').replace('<v>41</v>', '<v>45001</v>').replace('<v>42</v>', '<v>45010</v>'));
  edit('/xl/charts/run.xml', xml => xml.replaceAll('c:catAx', 'c:dateAx').replace('<c:dateAx>', '<c:dateAx><c:numFmt formatCode="yyyy-mm-dd"/><c:majorUnit val="5"/>')
    .replaceAll('c:scatterChart', 'c:lineChart').replace('<c:scatterStyle val="smoothMarker"/>', '<c:grouping val="standard"/>')
    .replaceAll('c:yVal', 'c:val').replace('<c:smooth val="1"/>', '<c:smooth val="0"/>'));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const dataOf = wb => chartData(wb, wb.sheets[0].id, wb.sheets[0].charts[0]);
const svgOf = wb => renderChartSvg(dataOf(wb), wb.sheets[0].charts[0], 600, 400);
const firstArea = svg => /class="chart-series chart-area" d="([^"]+)"/.exec(svg)[1];

it('uses date serials for every group, preserves date gaps and updates after edits and undo', async () => {
  const wb = await workbookFromFile(fixture(), 'dates.xlsx'), id = wb.sheets[0].id;
  expect(wb.sheets[0].charts[0].appearance).toMatchObject({ dateAxis: true, seriesTypes: ['area', 'area', 'column', 'line'] });
  expect(dataOf(wb).x).toEqual([45000, 45001, 45010]);
  expect(dataOf(wb).series.map(s => s.x)).toEqual(Array(4).fill([45000, 45001, 45010]));
  const svg = svgOf(wb);
  expect(svg).toContain('>2023-03-15</text>');
  expect(svg).toContain('>2023-03-25</text>');
  expect(svg).not.toMatch(/NaN|Infinity|1899|1900/);
  const xs = [...firstArea(svg).matchAll(/[ML] ([\d.]+) /g)].slice(0, 3).map(m => +m[1]);
  expect(xs[2] - xs[1]).toBeCloseTo(9 * (xs[1] - xs[0]), 0);
  const doc = new (new JSDOM('').window.DOMParser)().parseFromString(svg, 'image/svg+xml');
  const columns = [...doc.querySelectorAll('.chart-column')];
  expect(columns).toHaveLength(3);
  columns.forEach((node, i) => expect(+node.getAttribute('x') + +node.getAttribute('width') / 2).toBeCloseTo(xs[i], 1));
  wb.setInput(id, 1, 0, '45005');
  expect(dataOf(wb).series[3].x).toEqual([45000, 45005, 45010]);
  expect(firstArea(svgOf(wb))).not.toBe(firstArea(svg));
  wb.undo();
  expect(firstArea(svgOf(wb))).toBe(firstArea(svg));
  const copy = wb.duplicateChart(id, wb.sheets[0].charts[0].id);
  expect(chartData(wb, id, wb.chartById(id, copy))).toEqual(dataOf(wb));
});

it('exports native date categories and chart groups that reopen without private metadata', async () => {
  let wb = await workbookFromFile(fixture(), 'dates.xlsx');
  const expected = firstArea(svgOf(wb));
  for (let pass = 0; pass < 2; pass++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const path = zip.FullPaths.find(p => /\/charts\/chart[^/]*\.xml$/.test(p));
    const xml = new TextDecoder().decode(X.CFB.find(zip, path).content);
    expect(xml).toContain('<c:dateAx>');
    expect(xml).toContain('<c:areaChart>');
    expect(xml).toContain('<c:lineChart>');
    const categories = [...xml.matchAll(/<c:cat>([\s\S]*?)<\/c:cat>/g)];
    expect(categories).toHaveLength(4);
    for (const [, cat] of categories) expect([...cat.matchAll(/<c:v>([^<]+)<\/c:v>/g)].map(m => +m[1])).toEqual([45000, 45001, 45010]);
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    part.size = part.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
    expect(firstArea(svgOf(wb))).toBe(expected);
  }
});
