import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';
import { chartXlsx } from './helpers/xlsx-chart-fixture.js';
const get = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);
const set = (zip, path, xml) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(xml));
const bytes = zip => X.CFB.write(zip, { type: 'array', fileType: 'zip' });
it.each([
  ['theme shade', '<a:schemeClr val="tx2"><a:shade val="50000"/></a:schemeClr>', '#0a2b3d'],
  ['RGB tint', '<a:srgbClr val="206080"><a:tint val="50000"/></a:srgbClr>', '#90b0c0'],
  ['preset shade', '<a:prstClr val="blue"><a:shade val="50000"/></a:prstClr>', '#000080'],
  ['system luminance offset', '<a:sysClr val="window" lastClr="808080"><a:lumOff val="25000"/></a:sysClr>', '#c0c0c0'],
  ['ordered shade then tint', '<a:srgbClr val="206080"><a:shade val="50000"/><a:tint val="50000"/></a:srgbClr>', '#8898a0'],
  ['ordered tint then shade', '<a:srgbClr val="206080"><a:tint val="50000"/><a:shade val="50000"/></a:srgbClr>', '#485860'],
  ['saturation', '<a:srgbClr val="206080"><a:sat val="0"/></a:srgbClr>', '#505050'],
])('applies %s to chart solid colors and preserves rendering, native export and duplication', async (_name, color, expected) => {
  const zip = X.CFB.read(chartXlsx({ embedded: true }), { type: 'array' });
  set(zip, '/xl/charts/run.xml', get(zip, '/xl/charts/run.xml').replaceAll('<a:schemeClr val="accent2"/>', color));
  let wb = await workbookFromFile(bytes(zip));
  for (let pass = 0; pass < 2; pass++) {
    const sheet = wb.sheets[0], chart = sheet.charts[0];
    expect(chart.colors[1]).toBe(expected);
    expect(renderChartSvg(chartData(wb, sheet.id, chart), chart, chart.w, chart.h)).toContain(`stroke="${expected}"`);
    expect(wb.chartById(sheet.id, wb.duplicateChart(sheet.id, chart.id)).colors[1]).toBe(expected);
    const saved = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    set(saved, '/xl/workbook.xml', get(saved, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    wb = await workbookFromFile(bytes(saved));
  }
});
