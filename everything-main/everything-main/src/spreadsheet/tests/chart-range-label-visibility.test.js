import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { funnelXlsx } from './helpers/xlsx-funnel-fixture.js';
import { regionalChartXlsx } from './helpers/xlsx-regional-chart-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const C15 = 'http://schemas.microsoft.com/office/drawing/2012/chart';
const chart = wb => wb.sheets[0].charts[0];
const elements = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const labels = wb => elements(new JSDOM(renderChartSvg(chartData(wb, wb.sheets[0].id, chart(wb)), chart(wb), 1000, 400)).window.document, 'text')
  .filter(n => n.getAttribute('class') === 'chart-data-label').map(n => n.textContent);
async function native(wb, patch) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const path = zip.FullPaths.find(p => /\/xl\/charts\/[^/]+\.xml$/.test(p));
  expect(path).toBeTruthy();
  const doc = new JSDOM(new TextDecoder().decode(X.CFB.find(zip, path).content), { contentType: 'text/xml' }).window.document;
  if (patch) {
    patch(doc);
    X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(doc.documentElement.outerHTML));
  }
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), doc };
}
const boolean = (doc, value) => {
  const node = doc.createElementNS(C15, 'c15:showDataLabelsRange');
  if (value !== null) node.setAttribute('val', value);
  return node;
};
async function fixture(value, points = [], make = funnelXlsx) {
  return (await native(await workbookFromFile(make()), doc => {
    const flags = elements(doc, 'showDataLabelsRange');
    flags.forEach(flag => flag.setAttribute('val', '0'));
    const flag = flags[0], parent = flag.parentNode;
    flag.remove();
    if (value !== undefined) parent.append(boolean(doc, value));
    const dlbls = parent.parentNode.parentNode;
    for (const [index, setting, hidden] of points) {
      elements(dlbls, 'dLbl').filter(n => elements(n, 'idx')[0]?.getAttribute('val') === String(index)).forEach(n => n.remove());
      const point = doc.createElementNS(C, 'c:dLbl'), idx = doc.createElementNS(C, 'c:idx');
      idx.setAttribute('val', index);point.append(idx);
      if (hidden) { const del = doc.createElementNS(C, 'c:delete'); del.setAttribute('val', '1');point.append(del); }
      const list = doc.createElementNS(C, 'c:extLst'), ext = doc.createElementNS(C, 'c:ext');
      ext.setAttribute('uri', '{CE6537A1-D6FC-4f65-9D91-7224C49458BB}');
      ext.append(boolean(doc, setting));list.append(ext);point.append(list);dlbls.prepend(point);
    }
  })).wb;
}
it.each([['0',false],['false',false],['1',true],['true',true],[null,true],[' false ',false]])('imports CT_Boolean %s for linked-label visibility', async (value, visible) => {
  let wb = await fixture(value);
  for (let pass = 0; pass < 3; pass++) {
    expect(chart(wb).appearance.dataLabels[5].showRange).toBe(visible);
    expect(labels(wb)).toEqual(visible ? ['100%', '40%'] : []);
    const result = await native(wb);
    expect(elements(result.doc, 'showDataLabelsRange')[0].getAttribute('val')).toBe(visible ? '1' : '0');
    wb = result.wb;
  }
});
it.each([[undefined],['invalid'],['']])('retains the legacy range-present fallback for omitted or malformed visibility %s', async value => {
  const wb = await fixture(value);
  expect(chart(wb).appearance.dataLabels[5].showRange).toBeUndefined();
  expect(labels(wb)).toEqual(['100%', '40%']);
});
it.each([
  ['0', [[1,'1']], ['40%']],
  ['1', [[0,'0']], ['40%']],
  ['false', [[0,null]], ['100%']],
  ['true', [[0,'false'],[1,'true',true]], []],
  [undefined, [[0,'false']], ['40%']],
])('applies point overrides independently of the series setting %s', async (value, points, expected) => {
  let wb = await fixture(value, points);
  for (let pass = 0; pass < 3; pass++) {
    expect(labels(wb)).toEqual(expected);
    expect(chart(wb).sourceRefs[5].labels).toBeTruthy();
    wb = (await native(wb)).wb;
  }
});
it('honors visibility for line/scatter labels as well as area/scatter labels', async () => {
  const hidden = await fixture('false', [], regionalChartXlsx);
  expect(labels(hidden)).toEqual([]);
  const shown = await fixture('false', [[1,'true']], regionalChartXlsx);
  expect(labels(shown)).toEqual(['South']);
  expect(labels((await native(shown)).wb)).toEqual(['South']);
});
it('keeps visibility and live text through editing, metadata save, duplicate and sheet copy', async () => {
  let wb = await fixture('false', [[1,'true']]);
  wb.setInput(wb.sheets[0].id, 7, 3, '125');
  expect(labels(wb)).toEqual(['50%']);
  wb = await workbookFromFile(await workbookToXlsx(wb));
  const id = wb.duplicateChart(wb.sheets[0].id, chart(wb).id);
  expect(wb.chartById(wb.sheets[0].id,id).appearance.dataLabels).toEqual(chart(wb).appearance.dataLabels);
  wb.sheets[0].charts.splice(1,1);
  wb = new Workbook(wb.sheetToWorkbook(wb.sheets[0].id, { sourceWorkbook: '/Source.xlsx' }).toJSON());
  expect(labels(wb)).toEqual(['50%']);
  expect(labels((await native(wb)).wb)).toEqual(['50%']);
});
it('validates optional visibility without coercing untrusted JSON strings', async () => {
  const json = (await fixture('false', [[1,'true']])).toJSON();
  const setting = json.sheets[0].charts[0].appearance.dataLabels[5];
  setting.showRange = 'false';setting.points[0].showRange = 'true';
  const wb = new Workbook(json);
  expect(chart(wb).appearance.dataLabels[5].showRange).toBeUndefined();
  expect(chart(wb).appearance.dataLabels[5].points[0].showRange).toBeUndefined();
});
