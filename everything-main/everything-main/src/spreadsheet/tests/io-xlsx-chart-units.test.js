import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { areaComboXlsx } from './helpers/xlsx-area-combo-fixture.js';

function fixture(unit = '<c:builtInUnit val="hundreds"/>', withLabel = true, rotation = -5400000) {
  const zip = X.CFB.read(new Uint8Array(areaComboXlsx()), { type: 'array' });
  const part = X.CFB.find(zip, '/xl/charts/run.xml');
  const label = withLabel ? `<c:dispUnitsLbl><c:tx><c:rich><a:bodyPr rot="${rotation}"/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:r><a:t>HUNDREDS</a:t></a:r></a:p></c:rich></c:tx></c:dispUnitsLbl>` : '';
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace('</c:valAx>', `<c:dispUnits>${unit}${label}</c:dispUnits></c:valAx>`));
  part.size = part.content.length;
  return X.CFB.write(zip, { type: 'array', fileType: 'zip' });
}
const render = wb => {
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  return renderChartSvg(chartData(wb, sheet.id, chart), chart, 600, 400);
};

it('scales only axis labels and preserves styled unit labels in native Excel export', async () => {
  let wb = await workbookFromFile(fixture(), 'units.xlsx');
  wb.sheets[0].charts[0].appearance.yFormat = '0.0';
  const unitLayout = { x: .18, y: .12, w: null, h: null };
  wb.sheets[0].charts[0].appearance.yUnits.layout = unitLayout;
  for (let pass = 0; pass < 3; pass++) {
    const chart = wb.sheets[0].charts[0];
    expect(chart.appearance.yUnits).toMatchObject({ builtIn: 'hundreds', divisor: 100, label: 'HUNDREDS', rotation: -90, style: { size: 12 } });
    expect(chart.appearance.yUnits.layout).toEqual(unitLayout);
    const svg = render(wb);
    expect(svg).toContain('>2.0</text>');
    expect(svg).not.toContain('>200</text>');
    expect(svg).toContain('rotate(-90)">HUNDREDS</text>');
    expect(svg).toContain('Withdrawals · 40: 20'); // tooltips still show actual values
    const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const saved = X.CFB.read(bytes, { type: 'array' });
    const nativeLabel = new TextDecoder().decode(X.CFB.find(saved, '/xl/charts/chart1_1.xml').content).match(/<c:dispUnitsLbl>[\s\S]*?<\/c:dispUnitsLbl>/)[0];
    expect(nativeLabel).toContain('<c:x val="0.18"/>');
    expect(nativeLabel).not.toContain('layoutTarget');
    if (pass === 0) wb = await workbookFromFile(bytes, 'saved.xlsx');
    else if (pass === 1) {
      const zip = X.CFB.read(bytes, { type: 'array' }), book = X.CFB.find(zip, '/xl/workbook.xml');
      book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
      book.size = book.content.length;
      wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'external.xlsx');
    }
  }
});

it('preserves custom divisors without inventing a display label', async () => {
  const wb = await workbookFromFile(fixture('<c:custUnit val="25"/>', false), 'custom.xlsx');
  expect(wb.sheets[0].charts[0].appearance.yUnits).toMatchObject({ builtIn: null, divisor: 25, label: '' });
  expect(render(wb)).toContain('>8</text>');
  expect(render(wb)).not.toContain('chart-display-units');
  const bytes = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), zip = X.CFB.read(bytes, { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  expect(xml).toContain('<c:dispUnits><c:custUnit val="25"/></c:dispUnits>');
});

it.each([-180, 135, 360, 450])('retains full display-unit text rotation %s in rendering and native XLSX', async angle => {
  const wb = await workbookFromFile(fixture(undefined, true, angle * 60000), 'units.xlsx');
  expect(wb.sheets[0].charts[0].appearance.yUnits.rotation).toBe(angle);
  expect(render(wb)).toContain(`rotate(${angle})">HUNDREDS</text>`);
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.sheets[0].charts[0].appearance.yUnits.rotation).toBe(angle);
});

it.each(['0', '-5', 'NaN', 'Infinity'])('ignores an invalid display-unit divisor %s', async value => {
  const wb = await workbookFromFile(fixture(`<c:custUnit val="${value}"/>`), 'invalid.xlsx');
  expect(wb.sheets[0].charts[0].appearance.yUnits).toBeUndefined();
  expect(render(wb)).toContain('>200</text>');
});

it('scales numeric X labels without changing point coordinates', async () => {
  const wb = await workbookFromFile(fixture(), 'scatter.xlsx'), sheet = wb.sheets[0];
  sheet.charts[0] = normalizeChart({ ...sheet.charts[0], type: 'scatter',
    sourceRefs: [{ name: 'Points', literal: { categories: [1000000, 2000000], values: [100, 200] } }],
    appearance: { xUnits: { builtIn: 'millions' }, xMin: 0, xMax: 2000000, xStep: 500000, xFormat: '0.0' } });
  expect(chartData(wb, sheet.id, sheet.charts[0]).series[0].x).toEqual([1000000, 2000000]);
  const svg = render(wb);
  expect(svg).toContain('>1.5</text>');
  expect(svg).toContain('>2.0</text>');
  expect(svg).not.toContain('>2000000.0</text>');
  expect(svg).not.toMatch(/NaN|Infinity/);
});
