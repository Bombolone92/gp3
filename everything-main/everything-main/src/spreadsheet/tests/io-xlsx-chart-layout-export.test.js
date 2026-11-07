import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const parser = new (new JSDOM('').window.DOMParser)();
const readPart = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path).content);

it.each(['column', 'line', 'pie'])('exports %s manual layouts as absolute edges and retains automatic dimensions', async type => {
  const wb = new Workbook({ sheets: [{ name: 'Data', cells: {
    '0,0': { v: 'Category' }, '0,1': { v: 'Value' }, '1,0': { v: 'A' }, '1,1': { v: 12 },
  } }] });
  const plot = { x: .23, y: .19, w: .61, h: .53 };
  const title = { x: .37, y: .025 }, legend = { x: .73, y: .82 };
  wb.addChart(wb.activeSheetId, { type, title: 'Totals', legend: true, w: 730, h: 410,
    range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 5, c: 0 }, appearance: { plot, title, legend } });
  const saved = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
  const zip = X.CFB.read(saved, { type: 'array' });
  const doc = parser.parseFromString(readPart(zip, '/xl/charts/chart1_1.xml'), 'application/xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  const get = (node, name) => node.getElementsByTagNameNS('*', name)[0];
  for (const [element, box] of [['plotArea', plot], ['title', title], ['legend', legend]]) {
    const manual = get(get(doc, element), 'manualLayout');
    expect(manual, element).toBeTruthy();
    // layoutTarget describes only the plot's axes. Applying it to a positioned
    // title is schema-valid but makes desktop Excel remove the entire chart.
    if (element === 'plotArea') expect(get(manual, 'layoutTarget').getAttribute('val')).toBe('inner');
    else expect(get(manual, 'layoutTarget')).toBeUndefined();
    // MS-OI29500 21.2.3.20: factor x/y are offsets from automatic layout;
    // the model stores fractions measured from the chart's absolute edges.
    expect(get(manual, 'xMode').getAttribute('val')).toBe('edge');
    expect(get(manual, 'yMode').getAttribute('val')).toBe('edge');
    expect(get(manual, 'wMode').getAttribute('val')).toBe('factor');
    expect(get(manual, 'hMode').getAttribute('val')).toBe('factor');
    for (const key of ['x', 'y', 'w', 'h']) {
      const node = get(manual, key);
      if (box[key] == null) expect(node).toBeUndefined();
      else expect(Number(node.getAttribute('val'))).toBe(box[key]);
    }
  }
  const book = X.CFB.find(zip, '/xl/workbook.xml');
  book.content = new TextEncoder().encode(readPart(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  book.size = book.content.length;
  const back = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
  expect(back.activeSheet.charts[0].appearance).toMatchObject({ plot, title, legend });
  const copyId = wb.duplicateChart(wb.activeSheetId, wb.activeSheet.charts[0].id);
  expect(wb.chartById(wb.activeSheetId, copyId).appearance).toEqual(wb.activeSheet.charts[0].appearance);
});
