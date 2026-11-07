// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';
import * as XLSX from '../src/vendor/xlsx.mjs';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ font: '13px Arial', measureText(text) {
    const scale = Number(/([\d.]+)px/.exec(this.font)?.[1] || 13) / 13;
    return { width: [...text].reduce((sum, char) => sum + (char === '\u200b' ? 0 : char === 'W' ? 20 : char === 'i' ? 3 : 7), 0) * scale };
  } });
  Element.prototype.scrollTo = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
});
afterEach(() => document.body.replaceChildren());
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
function book(code = '_W0*-', value = 12) {
  return new Workbook({ sheets: [{ defaultColWidth: 100, cells: { '0,0': { v: value, s: { fmt: 'custom', code, size: 13, font: 'arial' } } } }] });
}
async function mount(wb) {
  const grid = createGrid({ wb, sheetId: wb.activeSheetId }); document.body.replaceChildren(grid.el); await flush(); return grid;
}
const cell = grid => grid.el.querySelector('#gc-0-0');
const printed = wb => buildPrintTable(wb, wb.activeSheetId, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, fit: 'actual' }).querySelector('td');
it('renders matching grid and print runs, then recalculates fill after a resize and undo', async () => {
  const wb = book(), grid = await mount(wb);
  expect(cell(grid).textContent).toBe('12--------');
  expect(cell(grid).querySelector('[aria-hidden]').style.inlineSize).toBe('20px');
  expect(printed(wb).textContent).toBe(cell(grid).textContent);
  wb.setColWidth(wb.activeSheetId, 0, 142); await flush();
  expect(cell(grid).textContent).toBe('12--------------');
  wb.undo(); await flush(); expect(cell(grid).textContent).toBe('12--------');
  expect(wb.getDisplay(wb.activeSheetId, 0, 0)).toBe(' 12');
  grid.destroy();
});
it('includes padding in numeric overflow instead of dropping or shrinking it', async () => {
  const wb = book('_W_W_W_W0'), grid = await mount(wb);
  expect(cell(grid).textContent).toBe('12');
  wb.setColWidth(wb.activeSheetId, 0, 90); await flush();
  expect(cell(grid).textContent).toBe('###'); expect(printed(wb).textContent).toBe('###');
  grid.destroy();
});
it('auto-fits to intrinsic padded content without growing to the repeated fill', async () => {
  const wb = book('_W_W_W0*-'), grid = await mount(wb);
  grid.el.querySelector('.col-resizer[data-c="0"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(wb.colWidth(wb.activeSheetId, 0)).toBe(88);
  grid.destroy();
});
it('keeps fill-only formats visible and respects hidden zeros', async () => {
  const wb = book('*.', 0), grid = await mount(wb);
  expect(cell(grid).textContent).toBe('.'.repeat(13));
  expect(printed(wb).textContent).toBe('.'.repeat(13));
  wb.setZeros(wb.activeSheetId, false); await flush();
  expect(cell(grid).textContent).toBe(''); expect(printed(wb).textContent).toBe('');
  grid.destroy();
});
it('uses the combined visible width of merged columns for grid and print', async () => {
  const wb = book('0*-'), id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 2 }); wb.setHidden(id, 'col', [1], true);
  const grid = await mount(wb);
  const print = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 0, c2: 2 }, fit: 'actual' }).querySelector('td');
  expect(cell(grid).textContent).toBe('12' + '-'.repeat(25));
  expect(print.textContent).toBe(cell(grid).textContent); grid.destroy();
});
it('retains semantic codes and values through XLSX and external clipboard HTML', async () => {
  const wb = book(), id = wb.activeSheetId;
  const html = cellsToHtml([[wb.getDisplay(id, 0, 0)]], [[wb.getCell(id, 0, 0)]], null, [[12]]);
  const rows = parseHtmlClipboard(html.replace(/ data-spreadsheet-\w+="[^"]*"/g, '')).rows;
  expect(rows[0][0].style.code).toBe('_W0*-');
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const back = await workbookFromFile(bytes, 'spacing.xlsx');
  expect(back.getValue(back.activeSheetId, 0, 0)).toBe(12);
  expect(back.styleAt(back.activeSheetId, 0, 0).code).toBe('_W0*-');
  expect(printed(back).textContent).toBe('12--------');
});
it('keeps spacing within rotated text and responds to row height, independently of column width', async () => {
  const wb = book('0*-'), id = wb.activeSheetId;
  wb.applyStyle(id, {r1:0,c1:0,r2:0,c2:0}, {rot:30});
  wb.setRowHeight(id,0,56);
  const grid = await mount(wb), initial = cell(grid).textContent;
  expect(initial).toMatch(/^12-+$/); expect(printed(wb).textContent).toBe(initial);
  wb.setColWidth(id,0,200); await flush(); expect(cell(grid).textContent).toBe(initial);
  wb.setRowHeight(id,0,100); await flush(); expect(cell(grid).textContent.length).toBeGreaterThan(initial.length);
  grid.destroy();
});
it('preserves wrapping and text spill around physical padding', async () => {
  const wb = book('0;0;0;_W@', 'a long text label across several cells'), id = wb.activeSheetId;
  const grid = await mount(wb);
  expect(cell(grid).classList.contains('spill')).toBe(true);
  expect(cell(grid).querySelector('.number-format-layout')).not.toBeNull();
  wb.applyStyle(id,{r1:0,c1:0,r2:0,c2:0},{wrap:true}); await flush();
  expect(cell(grid).querySelector('.number-format-layout').style.whiteSpace).toBe('pre-wrap');
  expect(printed(wb).querySelector('.number-format-layout').style.whiteSpace).toBe('pre-wrap');
  grid.destroy();
});

it.each([false, true])('constrains non-leading filled text without changing its value (wrap=%s)', async wrap => {
  const wb = book('0;0;0;@*.', 'long wrapped label'), id = wb.activeSheetId;
  wb.applyStyle(id, {r1:0,c1:0,r2:0,c2:0}, {wrap});
  const grid = await mount(wb);
  expect(cell(grid).textContent).toBe('###'); expect(printed(wb).textContent).toBe('###');
  expect(cell(grid).classList.contains('spill')).toBe(false);
  const table = buildPrintTable(wb, id, {range:{r1:0,c1:0,r2:0,c2:2},fit:'actual'});
  expect(table.querySelector('td').classList.contains('spill')).toBe(false);
  expect(wb.getValue(id,0,0)).toBe('long wrapped label');
  wb.setColWidth(id,0,220); await flush();
  expect(cell(grid).textContent).toMatch(/^long wrapped label\.+$/);
  expect(printed(wb).textContent).toBe(cell(grid).textContent);
  wb.undo(); await flush(); expect(cell(grid).textContent).toBe('###');
  grid.destroy();
});
it.each(['*.@', '@*\u200b', '*.@*\u200b'])('keeps leading and zero-width fills compatible with wrapping: %s', async code => {
  const wb = book(`0;0;0;${code}`, 'long wrapped label'), id=wb.activeSheetId;
  wb.applyStyle(id,{r1:0,c1:0,r2:0,c2:0},{wrap:true});
  const grid = await mount(wb);
  expect(cell(grid).textContent).toBe('long wrapped label');
  expect(printed(wb).textContent).toBe('long wrapped label');
  expect(cell(grid).querySelector('.number-format-layout').style.whiteSpace).toBe('pre-wrap');
  grid.destroy();
});

it('exports underlying wrapped text and its fill format even when the display is hashes', async () => {
  const value = 'long wrapped\nlabel', code = '0;0;0;@*.';
  const wb = book(code, value), id = wb.activeSheetId;
  wb.applyStyle(id, {r1:0,c1:0,r2:0,c2:0}, {wrap:true});
  expect(printed(wb).textContent).toBe('###');
  const html = cellsToHtml([[wb.getDisplay(id,0,0)]], [[wb.getCell(id,0,0)]], null, [[value]]);
  const copied = parseHtmlClipboard(html.replace(/ data-spreadsheet-\w+="[^"]*"/g, '')).rows[0][0];
  expect(copied.value).toBe(value);
  expect(copied.style).toMatchObject({code, wrap:true});
  const blob = await workbookToXlsx(wb), bytes = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsArrayBuffer(blob); });
  const zip = XLSX.CFB.read(new Uint8Array(bytes), {type:'array'}), part = XLSX.CFB.find(zip, '/xl/workbook.xml');
  part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  part.size = part.content.length;
  const back = await workbookFromFile(XLSX.CFB.write(zip, {type:'array',fileType:'zip'}), 'filled-text.xlsx');
  expect(back.getValue(back.activeSheetId,0,0)).toBe(value);
  expect(back.styleAt(back.activeSheetId,0,0)).toMatchObject({code,wrap:true});
  expect(printed(back).textContent).toBe('###');
});
