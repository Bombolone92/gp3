import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { pieXlsx } from './helpers/xlsx-pie-fixture.js';

const uri = '{CE6537A1-D6FC-4f65-9D91-7224C49458BB}';
const ext = (body, id = uri) => `<c:extLst><c:ext uri="${id}"><new:layout xmlns:new="http://schemas.microsoft.com/office/drawing/2012/chart"><c:manualLayout>${body}</c:manualLayout></new:layout></c:ext></c:extLst>`;
const box = values => Object.entries(values).map(([k, v]) => `<c:${k} val="${v}"/>`).join('');
const labels = wb => wb.sheets[0].charts[0].appearance.pie.labels;
const reopen = async wb => {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), xml };
};
it.each(['pieChart', 'doughnutChart'])('retains %s parent and point extension layouts separately through copies and native export', async type => {
  let wb = await workbookFromFile(pieXlsx({ type, editChart: xml => xml
    .replace('<c:dLblPos val="inEnd"/>', '<c:dLblPos val="inEnd"/>' + ext(box({ x: .7, y: -.8, w: .43, h: .21, wMode: 'edge' })))
    .replace('</c:dLbls>', ext(box({ x: -.12, y: .09, w: .8, h: .3 })) + '</c:dLbls>') }));
  const check = () => {
    const l = labels(wb);
    expect(l.extensionLayout).toEqual({ x: -.12, y: .09, w: .8, h: .3 });
    expect(l.points.find(p => p.index === 1)).toMatchObject({ dx: .02, dy: -.03, extensionLayout: { w: .43, h: .21 } });
    expect(l.points.find(p => p.index === 3).extensionLayout).toBeUndefined();
  };
  check();
  const ch = wb.sheets[0].charts[0], id = wb.duplicateChart(wb.activeSheetId, ch.id);
  expect(wb.chartById(wb.activeSheetId, id).appearance.pie.labels).toEqual(labels(wb)); wb.undo();
  for (let i = 0; i < 2; i++) {
    const saved = await reopen(wb); wb = saved.wb; check();
    expect(saved.xml.match(/<c15:layout /g)).toHaveLength(2);
    expect(saved.xml).toContain('<c:w val="0.43"/><c:h val="0.21"/>');
    expect(saved.xml).toContain('xmlns:c15="http://schemas.microsoft.com/office/drawing/2012/chart"');
  }
});
it('inherits group point sizing through a series point style override without spreading parent layout to points', async () => {
  const wb = await workbookFromFile(pieXlsx({ editChart: xml => xml.replace(
    '<c:dLbls><c:showVal val="0"/>', `<c:dLbls><c:dLbl><c:idx val="1"/>${ext(box({ w: .52 }))}</c:dLbl>${ext(box({ h: .7 }))}<c:showVal val="0"/>`) }));
  expect(labels(wb).extensionLayout).toEqual({ h: .7 });
  expect(labels(wb).points.find(p => p.index === 1).extensionLayout).toEqual({ w: .52 });
  expect(labels(wb).points.find(p => p.index === 3).extensionLayout).toBeUndefined();
  const back = await reopen(wb);
  expect(labels(back.wb).points.find(p => p.index === 1).extensionLayout).toEqual({ w: .52 });
});
it('ignores unrelated extensions and nonfinite dimensions while retaining zero and one-sided sizes', async () => {
  const wb = await workbookFromFile(pieXlsx({ editChart: xml => xml
    .replace('<c:dLblPos val="inEnd"/>', ext(box({ w: 'NaN', h: 0, x: .3 })))
    .replace('</c:dLbls>', ext(box({ w: .6 }), '{UNRELATED}') + '</c:dLbls>') }));
  expect(labels(wb).extensionLayout).toBeUndefined();
  expect(labels(wb).points.find(p => p.index === 1).extensionLayout).toEqual({ h: 0 });
  const back = await reopen(wb);
  expect(labels(back.wb).points.find(p => p.index === 1).extensionLayout).toEqual({ h: 0 });
});
it('does not materialize a parent layout on generated rich-field labels, and preserves hidden point sizing', async () => {
  let wb = await workbookFromFile(pieXlsx());
  const ch = wb.sheets[0].charts[0], l = labels(wb);
  l.extensionLayout = { x: .2, w: .6 };
  l.content = [{ kind: 'value' }];
  l.points = [{ ...l, index: 0, hidden: true, extensionLayout: { w: .23, h: .14 } }];
  wb.updateChart(wb.activeSheetId, ch.id, { appearance: ch.appearance });
  const back = await reopen(wb);
  expect(labels(back.wb).extensionLayout).toEqual({ x: .2, w: .6 });
  expect(labels(back.wb).points.find(p => p.index === 0)).toMatchObject({ hidden: true, extensionLayout: { w: .23, h: .14 } });
  expect(labels(back.wb).points.filter(p => p.index !== 0).every(p => !p.extensionLayout)).toBe(true);
});
