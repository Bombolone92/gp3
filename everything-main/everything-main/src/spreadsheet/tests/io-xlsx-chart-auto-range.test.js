import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { chartData } from '../src/core/charts.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const parser = new (new JSDOM('').window.DOMParser)();
const axisTicks = wb => {
  const sheet = wb.sheets[0], chart = sheet.charts[0];
  const svg = renderChartSvg(chartData(wb, sheet.id, chart), chart, 480, 280);
  return [...parser.parseFromString(svg, 'image/svg+xml').querySelectorAll('text[fill="#123456"]')].map(n => Number(n.textContent));
};

it.each([null, 2.3])('keeps automatic limits live through native XLSX export, reopen and edits with minimum %s', async minimum => {
  let wb = new Workbook({ sheets: [{ name: 'Data', charts: [{ type: 'column', legend: false,
    anchor: { r: 0, c: 3 }, range: { r1: 0, c1: 0, r2: 1, c2: 1 }, yMin: minimum,
    sourceRefs: [{ name: 'Values', categories: 'Data!$A$1:$A$2', values: 'Data!$B$1:$B$2' }],
    appearance: { yStyle: { color: '#123456' }, yFormat: '0.0', yStep: 2 },
  }] }] });
  wb.setInput(wb.sheets[0].id, 0, 0, 'A'); wb.setInput(wb.sheets[0].id, 1, 0, 'B');
  wb.setInput(wb.sheets[0].id, 0, 1, '4'); wb.setInput(wb.sheets[0].id, 1, 1, '9');
  let previousMax = -Infinity;
  for (let pass = 0; pass < 3; pass++) {
    const ticks = axisTicks(wb);
    expect(Math.min(...ticks)).toBe(minimum ?? 0);
    expect(Math.max(...ticks)).toBeGreaterThan(previousMax);
    previousMax = Math.max(...ticks);
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const chartXml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
    const scaling = chartXml.match(/<c:valAx>[\s\S]*?<c:scaling>([\s\S]*?)<\/c:scaling>/)[1];
    expect(scaling).not.toContain('<c:max');
    if (minimum == null) expect(scaling).not.toContain('<c:min');
    else expect(scaling).toContain('<c:min val="2.3"/>');
    const book = X.CFB.find(zip, '/xl/workbook.xml');
    book.content = new TextEncoder().encode(new TextDecoder().decode(book.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
    book.size = book.content.length;
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
    expect(axisTicks(wb)).toEqual(ticks);
    expect(wb.sheets[0].charts[0]).toMatchObject({ yMin: minimum, yMax: null });
    wb.setInput(wb.sheets[0].id, 1, 1, String(20 * (pass + 1)));
  }
});
