// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
const sample = () => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'Source', cells: { '3000,7': { v: 3 }, '3000,8': { v: 5 } }, sparklineGroups: [{ sparklines: [{ ref: 'L3001', formula: 'H3001:I3001' }] }] }] });
  const rows = Array.from({ length: 1001 }, (_, i) => i + 2000), cols = [7,8,9,10,11];
  const cells = wb.copyCells('s', rows, cols), values = rows.map(r => cols.map(c => wb.getValue('s', r, c)));
  const nativeSparklines = wb.copyNativeSparklines('s', rows, cols);
  const html = cellsToHtml(values.map(row => row.map(v => v == null ? '' : String(v))), cells, null, values, { r: 2000, c: 7 }, { nativeSparklines });
  return { wb, html, nativeSparklines };
};
it('carries native-only destinations beyond the embedded-cell limit and pastes their data with undo', () => {
  const { wb, html, nativeSparklines } = sample();
  expect(html).not.toContain('data-spreadsheet-cells=');
  const parsed = parseHtmlClipboard(html);
  expect(parsed.nativeSparklines).toEqual(nativeSparklines);
  const before = wb.toJSON();
  wb.pasteCells('s', parsed.cells, 0, 0, null, null, { nativeSparklines: parsed.nativeSparklines });
  expect(wb.sheet('s').sparklineGroups[1].sparklines).toEqual([{ ref: 'E1001', formula: 'A1001:B1001' }]);
  expect(wb.getValue('s', 1000, 0)).toBe(3); expect(wb.getValue('s', 1000, 1)).toBe(5);
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('does not restore stale native metadata after another application changes the table', () => {
  const { html } = sample(), doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelector('td').textContent = 'Changed';
  const parsed = parseHtmlClipboard(doc.body.innerHTML);
  expect(parsed.nativeSparklines).toBeUndefined(); expect(parsed.rows[0][0].text).toBe('Changed');
});
it('rejects malformed or mismatched native coordinates without losing visible HTML data', () => {
  const { html } = sample(), doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelector('table').setAttribute('data-spreadsheet-sparklines', JSON.stringify({ groups: [], rows: [0], cols: [0], sheetName: 'Source' }));
  const parsed = parseHtmlClipboard(doc.body.innerHTML);
  expect(parsed.nativeSparklines).toBeUndefined(); expect(parsed.rows[1000][0].value).toBe(3);
});
it('signs native metadata even when neither full cells nor copied values are present', () => {
  const wb = new Workbook({ sheets: [{ id: 's', sparklineGroups: [{ sparklines: [{ ref: 'B1' }] }] }] });
  const nativeSparklines = wb.copyNativeSparklines('s', [0], [1]);
  const html = cellsToHtml([['']], null, null, null, null, { nativeSparklines });
  const parsed = parseHtmlClipboard(html);
  expect(parsed.nativeSparklines).toEqual(nativeSparklines); expect(parsed.cells[0][0]).toMatchObject({ v: null, f: null });
});
it('an empty native snapshot clears overwritten charts through the normal cell paste path', () => {
  const { wb, html } = sample(), doc = new DOMParser().parseFromString(html, 'text/html'), table = doc.querySelector('table');
  const snapshot = JSON.parse(table.getAttribute('data-spreadsheet-sparklines')); snapshot.groups = [];
  table.setAttribute('data-spreadsheet-sparklines', JSON.stringify(snapshot));
  const parsed = parseHtmlClipboard(doc.body.innerHTML);
  wb.pasteCells('s', parsed.cells, 2000, 7, null, null, { nativeSparklines: parsed.nativeSparklines });
  expect(wb.sheet('s').sparklineGroups).toEqual([]);
});
it('keeps merged geometry and native metadata together when scalar cells come from HTML', () => {
  const { wb } = sample(), rows = Array.from({ length: 1001 }, (_, i) => i + 2000), cols = [7,8,9,10,11];
  wb.sheet('s').sparklineGroups[0].sparklines[0].ref = 'K3001';
  const cells = wb.copyCells('s', rows, cols), texts = rows.map(() => cols.map(() => ''));
  const html = cellsToHtml(texts, cells, null, null, null, { nativeSparklines: wb.copyNativeSparklines('s', rows, cols), rows, cols, merges: [{ r1:3000,r2:3000,c1:10,c2:11 }] });
  const parsed = parseHtmlClipboard(html);
  expect(parsed.merges).toEqual([{r1:1000,r2:1000,c1:3,c2:4}]);
  expect(parsed.cells).toHaveLength(1001); expect(parsed.nativeSparklines.groups[0].sparklines[0].ref).toBe('D1001');
});
