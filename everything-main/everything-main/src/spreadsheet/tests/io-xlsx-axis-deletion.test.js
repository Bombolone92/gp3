import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { JSDOM } from 'jsdom';

const read = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const edit = (zip, path, fn) => {
  const part = X.CFB.find(zip, path);
  part.content = new TextEncoder().encode(fn(read(zip, path))); part.size = part.content.length;
};
async function native(wb, deleted, inject = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const path = '/xl/charts/chart1_1.xml';
  if (inject) edit(zip, path, xml => xml.replace(/<c:(catAx|valAx)>([\s\S]*?)<\/c:\1>/g, (all, kind, body) => {
    const id = +body.match(/<c:axId val="(\d+)"/)[1];
    return `<c:${kind}>${body.replace(/<c:delete[^>]*\/>/, `<c:delete val="${deleted[id - 1] ? 'true' : '0'}"/>`)}</c:${kind}>`;
  }));
  const axes = [...read(zip, path).matchAll(/<c:(?:catAx|valAx)>([\s\S]*?)<\/c:(?:catAx|valAx)>/g)].map(m => m[1]);
  expect(axes).toHaveLength(3);
  axes.forEach(body => {
    const id = +body.match(/<c:axId val="(\d+)"/)[1];
    expect(['1', 'true'].includes(body.match(/<c:delete val="([^"]+)"/)[1])).toBe(deleted[id - 1]);
  });
  edit(zip, '/xl/workbook.xml', xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'axes.xlsx');
}

it.each([[false, false, true], [false, true, false], [true, true, true], [true, false, false]])('preserves independent native deletion %j through edits, copies and repeated exports', async (x, y, y2) => {
  const deleted = [x, y, y2];
  let wb = new Workbook({ sheets: [{ name: 'Data', charts: [{ type: 'combo', secondaryAxis: true, anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    yMin: -100, yMax: 1000, sourceRefs: [{ name: 'Columns', literal: { categories: ['A', 'B'], values: [20, 80] } },
      { name: 'Line', literal: { categories: ['A', 'B'], values: [2, 8] } }],
    appearance: { y2Min: 0, y2Max: 100, yStep: 250, y2Step: 20, reverseSecondaryValues: true, axisCrossings: { x: 50 },
      y2LabelPosition: 'low', y2Gridlines: true, y2Units: { divisor: 10, label: 'Units' } },
  }] }] });
  wb = await native(wb, deleted, true);
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.activeSheet, chart = sheet.charts[0];
    expect(chart).toMatchObject({ yMin: -100, yMax: 1000, secondaryAxis: true });
    expect(chart.appearance).toMatchObject({ hideXAxis: x, hideYAxis: y, hideY2Axis: y2,
      y2Min: 0, y2Max: 100, yStep: 250, y2Step: 20, reverseSecondaryValues: true, axisCrossings: { x: 50 }, y2LabelPosition: 'low', y2Gridlines: true });
    const id = wb.duplicateChart(sheet.id, chart.id);
    expect(wb.chartById(sheet.id, id).appearance).toEqual(chart.appearance);
    wb.undo();
    wb.updateChart(sheet.id, chart.id, { appearance: { ...chart.appearance, hideY2Axis: !y2 } });
    expect(sheet.charts[0].appearance.hideY2Axis).toBe(!y2);
    wb.undo();
    expect(new Workbook(wb.toJSON()).activeSheet.charts[0].appearance.hideY2Axis).toBe(y2);
    wb = await native(wb, deleted);
  }
});

it.each([1, -1])('recomputes the transferred range after native round trips and cell edits (sign %s)', async sign => {
  const parser = new (new JSDOM('').window.DOMParser)();
  let wb = new Workbook({ sheets: [{ name: 'Data', charts: [{ type: 'combo', secondaryAxis: true, legend: false,
    anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 1, c2: 2 },
    sourceRefs: [{ name: 'Columns', categories: 'Data!A1:A2', values: 'Data!B1:B2' },
      { name: 'Line', literal: { categories: ['A', 'B'], values: [sign * 91, sign * 99] } }],
    appearance: { hideYAxis: true, yStep: 1, y2Step: 1, y2Style: { color: '#cc2255' } },
  }] }] });
  wb.setInput(wb.activeSheet.id, 0, 0, 'A'); wb.setInput(wb.activeSheet.id, 1, 0, 'B');
  wb.setInput(wb.activeSheet.id, 0, 1, String(sign * 90)); wb.setInput(wb.activeSheet.id, 1, 1, String(sign * 100));
  const limits = book => {
    const sheet = book.activeSheet, chart = sheet.charts[0];
    const root = parser.parseFromString(renderChartSvg(chartData(book, sheet.id, chart), chart, 600, 400), 'image/svg+xml');
    const labels = [...root.querySelectorAll('text[fill="#cc2255"]')].map(e => Number(e.textContent));
    return [labels[0], labels.at(-1)];
  };
  const before = sign > 0 ? [84, 102] : [-102, -84];
  const after = sign > 0 ? [0, 111] : [-107, 0];
  for (let pass = 0; pass < 2; pass++) {
    expect(limits(wb)).toEqual(before);
    wb = await native(wb, [false, true, false]);
    expect(limits(wb)).toEqual(before);
    expect(wb.activeSheet.charts[0]).toMatchObject({ yMin: null, yMax: null, appearance: { y2Min: null, y2Max: null } });
    const sheet = wb.activeSheet, chart = sheet.charts[0];
    const copy = wb.chartById(sheet.id, wb.duplicateChart(sheet.id, chart.id));
    expect(copy.appearance).toEqual(chart.appearance);
    wb.undo();
    wb.setInput(sheet.id, 0, 1, String(sign * 80));
    expect(limits(wb)).toEqual(after);
    const edited = await native(wb, [false, true, false]);
    expect(limits(edited)).toEqual(after);
    wb.undo();
    expect(limits(wb)).toEqual(before);
  }
});

it.each([[null, false], [0, false], [null, true], [0, true]])('preserves empty/zero primary fallback through native XLSX (%s, percent %s)', async (value, percent) => {
  const parser = new (new JSDOM('').window.DOMParser)();
  let wb = new Workbook({ sheets: [{ name: 'Data', charts: [{ type: 'combo', secondaryAxis: true, legend: false, stacked: percent, stack100: percent,
    anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 1, c2: 2 },
    sourceRefs: [{ name: 'Columns', literal: { categories: ['A', 'B'], values: [value, value] } },
      { name: 'Line', literal: { categories: ['A', 'B'], values: [.02, .08] } }],
    appearance: { hideYAxis: true, yStep: .01, y2Step: .01, y2Style: { color: '#cc2255' } },
  }] }] });
  for (let pass = 0; pass < 2; pass++) {
    wb = await native(wb, [false, true, false]);
    const sheet = wb.activeSheet, chart = sheet.charts[0], data = chartData(wb, sheet.id, chart);
    expect(data.series[0].values).toEqual([value, value]);
    const root = parser.parseFromString(renderChartSvg(data, chart, 600, 400), 'image/svg+xml');
    const labels = [...root.querySelectorAll('text[fill="#cc2255"]')].map(e => Number(e.textContent));
    expect([labels[0], labels.at(-1)]).toEqual(percent ? [0, .09] : value == null ? [0, 1.11] : [-1.11, .14]);
  }
});
