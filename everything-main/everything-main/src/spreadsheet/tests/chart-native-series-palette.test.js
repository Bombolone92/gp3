import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { Workbook } from '../src/core/workbook.js';
import { chartData } from '../src/core/charts.js';
import { seriesColor } from '../src/ui/chartsvg.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const chart = wb => wb.activeSheet.charts[0];
function fixture(type, colors) {
  return new Workbook({ sheets: [{ name: 'Palette', charts: [{ type, colors, legend: false,
    anchor: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
    sourceRefs: Array.from({ length: 30 }, (_, i) => ({ name: `Series ${i + 1}`,
      literal: { categories: [1, 2, 3], values: [i + 2, i + 5, i + 3], sizes: [3, 5, 7] } })) }] }] });
}
async function cycle(wb, metadata = false) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const xml = new TextDecoder().decode(X.CFB.find(zip, '/xl/charts/chart1_1.xml').content);
  if (!metadata) {
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  }
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), doc: new JSDOM(xml, { contentType: 'text/xml' }).window.document };
}
it.each(['column', 'bar', 'line', 'area', 'scatter', 'bubble', 'combo', 'radar'])('retains %s palette tail and alternating shade cycles in native series and markers', async type => {
  let wb = fixture(type);
  const expected = Array.from({ length: 30 }, (_, i) => seriesColor(chart(wb), i));
  expect(new Set(expected.slice(0, 27)).size).toBe(27);
  for (let pass = 0; pass < 2; pass++) {
    const result = await cycle(wb);
    const series = [...result.doc.getElementsByTagName('c:ser')];
    expect(series).toHaveLength(30);
    for (const node of series) {
      const i = Number(node.getElementsByTagName('c:idx')[0].getAttribute('val'));
      const props = [...node.children].find(n => n.tagName === 'c:spPr');
      for (const rgb of props.getElementsByTagName('a:srgbClr')) expect(`#${rgb.getAttribute('val').toLowerCase()}`).toBe(expected[i]);
      for (const marker of node.getElementsByTagName('c:marker'))
        for (const rgb of marker.getElementsByTagName('a:srgbClr')) expect(`#${rgb.getAttribute('val').toLowerCase()}`).toBe(expected[i]);
    }
    wb = result.wb;
    expect(chartData(wb, wb.activeSheetId, chart(wb)).series).toHaveLength(30);
    expect(expected.map((_, i) => seriesColor(chart(wb), i))).toEqual(expected);
  }
});
it('preserves sparse explicit colors through copying, metadata and native export without changing the source', async () => {
  const colors = Array(30).fill(null); colors[7] = '#123456'; colors[19] = '#abcdef';
  const original = fixture('column', colors), before = JSON.stringify(chart(original));
  let wb = original.sheetToWorkbook(original.activeSheetId, { sourceWorkbook: '/Source.xlsx' });
  wb = (await cycle(wb, true)).wb;
  wb = (await cycle(wb)).wb;
  expect(Array.from({ length: 30 }, (_, i) => seriesColor(chart(wb), i)))
    .toEqual(Array.from({ length: 30 }, (_, i) => seriesColor(chart(original), i)));
  expect(JSON.stringify(chart(original))).toBe(before);
});
