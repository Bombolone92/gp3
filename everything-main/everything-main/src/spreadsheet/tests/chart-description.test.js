import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { chartData, normalizeChart } from '../src/core/charts.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { renderChartSvg } from '../src/ui/chartsvg.js';

const decode = part => new TextDecoder().decode(part.content);
const description = 'Revenue & costs: <sales> rose 15%.\nDetails: ' + 'Year-over-year comparison. '.repeat(15);
function fixture(type = 'column', extra = {}) {
  return new Workbook({ sheets: [{ name: 'Data', cells: { '0,0': { v: 1 }, '0,1': { v: 3 }, '0,2': { v: 4 }, '1,0': { v: 2 }, '1,1': { v: 7 }, '1,2': { v: 6 } },
    charts: [{ type, seriesIn: 'cols', headers: false, title: 'Visible title', description, anchor: { r: 4, c: 2 }, range: { r1: 0, c1: 0, r2: 1, c2: type === 'bubble' ? 2 : 1 }, ...extra }] }] });
}
async function cycle(wb, { metadata = false, edit = null } = {}) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  const drawing = '/xl/drawings/drawing1.xml';
  if (edit) X.CFB.utils.cfb_add(zip, drawing, new TextEncoder().encode(edit(decode(X.CFB.find(zip, drawing)))));
  if (!metadata) X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(decode(X.CFB.find(zip, '/xl/workbook.xml')).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
  const xml = decode(X.CFB.find(zip, drawing));
  return { wb: await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' })), xml };
}
const chart = wb => wb.activeSheet.charts[0];
const props = xml => new JSDOM(xml, { contentType: 'application/xml' }).window.document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing', 'cNvPr')[0];
const svg = wb => new JSDOM(renderChartSvg(chartData(wb, wb.activeSheetId, chart(wb)), chart(wb), 600, 400)).window.document.querySelector('svg');

it.each(['column', 'bar', 'line', 'pie', 'donut', 'scatter', 'bubble', 'radar', 'area', 'combo'])('preserves a %s description separately from the visible title through two native XLSX cycles', async type => {
  let wb = fixture(type);
  for (let pass = 0; pass < 2; pass++) {
    const result = await cycle(wb);
    expect(props(result.xml).getAttribute('descr')).toBe(description);
    wb = result.wb;
    expect(chart(wb)).toMatchObject({ description, title: 'Visible title' });
    const rendered = svg(wb);
    expect(rendered.getAttribute('aria-label')).toBe(description);
    expect(rendered.textContent).toContain('Visible title');
    expect(rendered.textContent).not.toContain(description);
  }
});
it.each([undefined, '', 'Δ, 日本語 & _x0041_'])('preserves absent, empty, and literal XML descriptions: %j', async value => {
  const wb = fixture('column', { description: value });
  const result = await cycle(wb);
  expect(props(result.xml).getAttribute('descr')).toBe(value ?? null);
  expect(chart(result.wb).description).toBe(value);
  expect(svg(result.wb).getAttribute('aria-label')).toBe(value || 'Visible title');
});
it('reads authoritative native alternative-text edits despite retained private metadata', async () => {
  const wb = fixture();
  const result = await cycle(wb, { metadata: true, edit: xml => xml.replace(/ descr="[^"]*"/, ' descr="External &amp; edit"') });
  expect(chart(result.wb).description).toBe('External & edit');
  expect(chart(result.wb).title).toBe('Visible title');
  const removed = await cycle(result.wb, { metadata: true, edit: xml => xml.replace(/ descr="[^"]*"/, '') });
  expect(chart(removed.wb).description).toBeUndefined();
});
it('keeps descriptions through duplication, sheet extraction, edits, undo and JSON', async () => {
  const wb = fixture(), id = wb.activeSheetId, original = chart(wb);
  const copied = wb.duplicateChart(id, original.id);
  wb.updateChart(id, copied, { description: 'Changed alternative', title: 'Changed title' });
  expect(wb.chartById(id, copied).description).toBe('Changed alternative');
  wb.undo(); expect(wb.chartById(id, copied).description).toBe(description);
  wb.redo();
  const extracted = new Workbook(wb.sheetToWorkbook(id).toJSON()), result = await cycle(extracted);
  expect(result.wb.activeSheet.charts.map(c => c.description)).toEqual([description, 'Changed alternative']);
});
it('omits decorative chart descriptions natively but retains the editable description in private metadata', async () => {
  const wb = fixture('column', { decorative: true });
  const result = await cycle(wb, { metadata: true });
  expect(props(result.xml).hasAttribute('descr')).toBe(false);
  expect(chart(result.wb)).toMatchObject({ description, decorative: true });
  wb.updateChart(wb.activeSheetId, chart(wb).id, { decorative: false });
  expect(props((await cycle(wb)).xml).getAttribute('descr')).toBe(description);
});
it('validates description input without coercion or the visible title limit', () => {
  const raw = chart(fixture());
  expect(normalizeChart({ ...raw, description: { toString: () => 'wrong' } }).description).toBeUndefined();
  expect(normalizeChart({ ...raw, description: 'x'.repeat(32768) }).description).toHaveLength(32767);
});

it.each(['histogram', 'waterfall'])('exports alternative text on a %s preview and reimports external alt-text edits without changing the chart title', async type => {
  const wb = fixture(type), before = chartData(wb, wb.activeSheetId, chart(wb));
  const saved = await cycle(wb, { metadata: true });
  expect(props(saved.xml).getAttribute('descr')).toBe(description);
  expect(chart(saved.wb)).toMatchObject({ type, title: 'Visible title', description });
  const edited = await cycle(saved.wb, { metadata: true, edit: xml => xml.replace(/ descr="[^"]*"/, ' descr="Edited picture alternative"') });
  expect(chart(edited.wb)).toMatchObject({ type, title: 'Visible title', description: 'Edited picture alternative' });
  expect(chartData(edited.wb, edited.wb.activeSheetId, chart(edited.wb))).toEqual(before);
  const removed = await cycle(edited.wb, { metadata: true, edit: xml => xml.replace(/ descr="[^"]*"/, '') });
  expect(chart(removed.wb).description).toBeUndefined();
  expect(chart(removed.wb).title).toBe('Visible title');
  const decorative = await cycle(fixture(type, { decorative: true }), { metadata: true });
  expect(chart(decorative.wb)).toMatchObject({ description, title: 'Visible title', decorative: true });
  const noDescription = await cycle(fixture(type, { description: undefined }), { metadata: true });
  expect(props(noDescription.xml).getAttribute('descr')).toBe('Visible title');
  expect(chart(noDescription.wb)).toMatchObject({ type, title: 'Visible title' });
});
