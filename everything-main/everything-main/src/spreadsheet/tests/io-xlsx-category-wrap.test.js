import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';

const text = file => new TextDecoder().decode(file.content);
function change(file, transform) { file.content = new TextEncoder().encode(transform(text(file))); file.size = file.content.length; }
function native(zip) {
  change(X.CFB.find(zip, '/xl/workbook.xml'), xml => xml.replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
function source(wrap, type) {
  const zip = X.CFB.read(new Uint8Array(chartXlsx({ embedded: true })), { type: 'array' });
  change(X.CFB.find(zip, '/xl/charts/run.xml'), xml => xml.replaceAll('dateAx', type === 'date' ? 'dateAx' : 'catAx')
    .replace(/(<c:(?:cat|date)Ax>[\s\S]*?<c:txPr>)/, `$1<a:bodyPr${wrap == null ? '' : ` wrap="${wrap}"`}/>`));
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}

it.each(['category', 'date'])('retains native %s-axis wrapping independently of private metadata', async type => {
  for (const wrap of ['square', 'none', null, 'invalid']) {
    let wb = await workbookFromFile(source(wrap, type), 'labels.xlsx');
    const expected = wrap === 'none' ? 'none' : 'square';
    expect(wb.sheets[0].charts[0].appearance.xWrap).toBe(expected);
    for (let pass = 0; pass < 2; pass++) {
      const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
      expect(text(X.CFB.find(zip, '/xl/charts/chart1_1.xml'))).toMatch(new RegExp(`<c:${type === 'date' ? 'date' : 'cat'}Ax>[\\s\\S]*?<a:bodyPr[^>]*wrap="${expected}"`));
      wb = await workbookFromFile(native(zip), 'roundtrip.xlsx');
      expect(wb.sheets[0].charts[0].appearance.xWrap).toBe(expected);
    }
  }
});

it('reflows edited categories, preserves hard breaks through native export, copies and drafts, and undoes edits', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Region'); wb.setInput(id, 0, 1, 'Revenue');
  wb.setInput(id, 1, 0, 'North\nSales'); wb.setInput(id, 1, 1, '3');
  wb.setInput(id, 2, 0, 'South\nSales'); wb.setInput(id, 2, 1, '7');
  const chartId = wb.addChart(id, { type: 'column', legend: false, anchor: { r: 1, c: 3 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    appearance: { xWrap: 'none', xRotation: 35 } });
  const render = book => { const c = book.activeSheet.charts[0]; return renderChartSvg(chartData(book, book.activeSheetId, c), c, 700, 350); };
  expect(render(wb)).toContain('>North</tspan>');
  wb.clearHistory(); wb.setInput(id, 1, 0, 'A single label'); expect(render(wb)).not.toContain('>North</tspan>');
  wb.undo(); expect(render(wb)).toContain('>North</tspan>');
  const copyId = wb.duplicateChart(id, chartId);
  expect(wb.chartById(id, copyId).appearance.xWrap).toBe('none');
  const draft = new Workbook(wb.toJSON()); expect(render(draft)).toContain('>North</tspan>');
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const back = await workbookFromFile(native(zip), 'edited.xlsx');
  expect(back.getValue(back.activeSheetId, 1, 0)).toBe('North\nSales');
  expect(render(back)).toContain('>North</tspan>');
  expect(back.activeSheet.charts[0].appearance.xWrap).toBe('none');
});

it('normalizes invalid wrapping without changing the stored rotation or interval', () => {
  const chart = normalizeChart({ type: 'bar', anchor: { r: 0, c: 1 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    appearance: { xWrap: 'invalid', xRotation: -270, xLabelSkip: 3 } });
  expect(chart.appearance).toMatchObject({ xWrap: 'square', xRotation: -270, xLabelSkip: 3 });
});
