// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { sheetToHtml } from '../src/core/io.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { parseHtmlClipboard, cellsFromHtmlRows } from '../src/core/clipboard.js';
import { pivotDisplayBook, xml } from './helpers/native-pivot-display.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile } from '../src/core/io.js';
import { defaultCellFormatFile } from './helpers/default-cell-format.js';
import { normalizeNativeFill } from '../src/core/native-fill.js';

let dispose;
beforeEach(() => {
  dispose = [];
  const stored = new Map();
  vi.stubGlobal('localStorage', { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: k => stored.delete(k) });
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ font: '', measureText(text) { return { width: text.length * (this.font.includes('600') ? 14 : 7) }; } }));
});
afterEach(() => {
  closeMenu();
  for (const target of dispose) target.destroy();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
const settle = () => vi.advanceTimersByTimeAsync(5);
it('paints independent default shading while No fill restores paper in the grid, frozen panes, print and public copy', async () => {
  const defaults = await workbookFromFile(defaultCellFormatFile());
  const { wb: base, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  const format = defaults.nativeDefaultCellFormat;
  // Match the ordinary Normal font so only the fill binding controls the
  // report look. A duplicate No fill resource is a direct transparent override.
  format.style = { ...base.normalStyle, bg: format.style.bg, nativeFill: format.style.nativeFill, valign: 'bottom' };
  const wb = new Workbook({ ...base.toJSON(), nativeDefaultCellFormat: format });
  const sheet = wb.sheet(id);
  sheet.cells.get('0,0').s = { bg: null, nativeFill: null };
  sheet.cells.get('0,1').s = { bg: null, nativeFill: normalizeNativeFill({ key: 'independent-none', xml: xml('fill', '<patternFill patternType="none"/>') }) };
  wb.setFrozen(id, 1, 1);
  const before = structuredClone({ cells: [...sheet.cells], defaults: wb.nativeDefaultCellFormat });
  const grid = createGrid({ wb, sheetId: id }); dispose.push(grid); document.body.append(grid.el); await settle();
  expect(grid.el.querySelector('.grid-viewport').style.backgroundColor).toBe('rgb(187, 221, 238)');
  for (const layer of grid.el.querySelectorAll('.frz-layer')) expect(layer.style.backgroundColor).toBe('rgb(187, 221, 238)');
  expect(wb.displayStyleAt(id, 0, 0).bg).toBe('#aaccee');
  expect(wb.displayStyleAt(id, 0, 1).bg).toBe('transparent');
  const table = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 3, c2: 1 } });
  expect(table.style.backgroundColor).toBe('rgb(187, 221, 238)');
  expect(table.rows[0].cells[1].style.backgroundColor).toBe('rgb(255, 255, 255)');
  const noFill = grid.el.querySelector('.cell[data-r="0"][data-c="1"]');
  expect(noFill.style.backgroundColor).toBe('var(--surface, #ffffff)');
  expect(noFill.classList.contains('filled')).toBe(false);
  expect({ cells: [...sheet.cells], defaults: wb.nativeDefaultCellFormat }).toEqual(before);
  const view = await editor(wb); view.goTo('Report!A1:B1');
  const beforeCopy = wb.toJSON();
  let html;
  const copy = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(copy, 'clipboardData', { value: { setData(type, value) { if (type === 'text/html') html = value; } } });
  view.el.querySelector('[role=grid]').dispatchEvent(copy);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelectorAll('td')[1].style.backgroundColor).toBe('');
  expect(doc.querySelectorAll('td')[1].getAttribute('style')).toContain('mso-background-source:auto');
  const parsed = parseHtmlClipboard(html);
  expect(parsed.cells[0][1].s.nativeFill.paint).toBeNull();
  expect(wb.toJSON()).toEqual(beforeCopy);
});
async function editor(wb) {
  const view = editorView({ doc: new Doc({ wb }), goHome() {}, openPath() {}, newDoc() {}, templateDoc() {}, importFile() {} });
  dispose.push(view); document.body.append(view.el); await settle(); return view;
}

it('renders the saved style on populated and missing header cells in the grid and print table', async () => {
  const { wb, id, r, c } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  wb.sheet(id).cells.delete('0,1');
  const grid = createGrid({ wb, sheetId: id }); dispose.push(grid); document.body.append(grid.el); await settle();
  for (const col of [c, c + 1]) {
    const node = grid.el.querySelector(`.cell[data-r="${r}"][data-c="${col}"]`);
    expect(node.style.backgroundColor).toBe('rgb(170, 204, 238)');
    expect(node.style.borderBottomWidth).toBe('2px');
    expect(node.style.borderBottomStyle).toBe('solid');
  }
  expect(grid.el.querySelector('.cell[data-r="0"][data-c="0"]').classList.contains('b')).toBe(true);
  const table = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 3, c2: 1 } });
  for (const td of table.rows[0].cells) {
    expect(td.style.backgroundColor).toBe('rgb(170, 204, 238)'); expect(td.style.borderBottom).toContain('2px solid');
  }
  expect(table.rows[3].cells[0].style.borderTop).toContain('3px double');
});

it('keeps conditional formatting over saved PivotTable font, fill and borders', async () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  wb.sheet(id).rules = [{ id: 'rule', range: { r1: 0, c1: 0, r2: 0, c2: 1 }, type: 'formula', value: 'TRUE()', style: { bg: '#ffeedd', bold: false, bb: true, bbBorder: { bs: 'dotted', bc: '#ff0000' } } }];
  const grid = createGrid({ wb, sheetId: id }); dispose.push(grid); document.body.append(grid.el); await settle();
  const node = grid.el.querySelector('.cell[data-r="0"][data-c="0"]');
  expect(node.style.backgroundColor).toBe('rgb(255, 238, 221)');
  expect(node.classList.contains('b')).toBe(false);
  expect(node.style.borderBottomStyle).toBe('dotted');
  const table = buildPrintTable(wb, id);
  expect(table.rows[0].cells[0].style.backgroundColor).toBe('rgb(255, 238, 221)');
  expect(table.rows[0].cells[0].style.borderBottom).toContain('dotted');
});

it('measures the displayed header font when double-clicking a column border', async () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  const grid = createGrid({ wb, sheetId: id }); dispose.push(grid); document.body.append(grid.el); await settle();
  grid.el.querySelector('.col-resizer[data-c="1"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  expect(wb.colWidth(id, 1)).toBe('Sales'.length * 14 + 14);
});

it('honors a conditional bold-off override when fitting columns from the Format menu', async () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  wb.sheet(id).rules = [{ id: 'rule', range: { r1: 0, c1: 0, r2: 0, c2: 1 }, type: 'formula', value: 'TRUE()', style: { bold: false } }];
  const view = await editor(wb); view.goTo('Report!B1');
  view.el.querySelector('[data-menu="format"]').click();
  const choose = label => [...document.querySelectorAll('.menu-item')].find(item => item.querySelector('.menu-label')?.textContent === label).click();
  choose('Rows and columns'); choose('Fit columns to content'); await settle();
  expect(wb.colWidth(id, 1)).toBe('Sales'.length * 7 + 14);
});

it.each([false, true])('gives a direct neighboring border precedence over a heavier PivotTable style edge (missing header: %s)', async missingHeader => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0, normalFont: missingHeader ? null : { name: 'Calibri', sz: 12 } });
  if (missingHeader) wb.sheet(id).cells.delete('0,0');
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bt: true, btBorder: { bs: 'thin', bc: '#ff0000' } });
  const grid = createGrid({ wb, sheetId: id }); dispose.push(grid); document.body.append(grid.el); await settle();
  const header = grid.el.querySelector('.cell[data-r="0"][data-c="0"]'), below = grid.el.querySelector('.cell[data-r="1"][data-c="0"]');
  expect(header.style.borderBottomWidth).toBe('');
  expect(below.style.borderTopWidth).toBe('1px'); expect(below.style.borderTopColor).toBe('rgb(255, 0, 0)');
  const table = buildPrintTable(wb, id);
  expect(table.rows[0].cells[0].style.borderBottomWidth).toBe('');
  expect(table.rows[1].cells[0].style.borderTopWidth).toBe('1px');
});

it('exports the same displayed font, fill and borders as a standalone HTML page', () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 }), before = wb.toJSON();
  const html = sheetToHtml(wb, id), doc = new DOMParser().parseFromString(html, 'text/html'), td = doc.querySelector('td');
  expect(td.style.backgroundColor).toBe('rgb(170, 204, 238)');
  expect(td.style.fontWeight).toBe('bold'); expect(td.style.borderBottom).toContain('2px solid');
  expect(html).not.toContain('data-spreadsheet'); expect(wb.toJSON()).toEqual(before);
});

it('copies public displayed paint while retaining the original embedded cell styles', async () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  const view = await editor(wb); view.goTo('Report!A1:B1');
  const before = wb.toJSON();
  const data = {}, event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { data[type] = value; } } });
  view.el.querySelector('.grid-viewport').dispatchEvent(event);
  const node = document.createElement('div'); node.innerHTML = data['text/html'];
  expect(node.querySelector('td').style.backgroundColor).toBe('rgb(170, 204, 238)');
  const privateData = parseHtmlClipboard(data['text/html']);
  expect(privateData.cells[0][0].s).not.toHaveProperty('bg');
  const stripped = data['text/html'].replace(/\sdata-spreadsheet-[\w-]+="[^"]*"/g, '');
  const foreign = parseHtmlClipboard(stripped);
  expect(cellsFromHtmlRows(foreign.rows)[0].cell.s).toMatchObject({ bg: '#aaccee', bold: true, bb: true });
  expect(wb.toJSON()).toEqual(before); expect(wb.getValue(id, 0, 0)).toBe('Region');
});

it('resolves direct/style border conflicts in public clipboard CSS while retaining source border metadata', async () => {
  const { wb, id } = pivotDisplayBook({ ref: 'A1:B4', r: 0, c: 0 });
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bt: true, btBorder: { bs: 'thin', bc: '#ff0000' } });
  const view = await editor(wb); view.goTo('Report!A1:B2');
  const data = {}, event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { data[type] = value; } } });
  view.el.querySelector('.grid-viewport').dispatchEvent(event);
  const doc = new DOMParser().parseFromString(data['text/html'], 'text/html'), rows = doc.querySelectorAll('tr');
  expect(['', 'none']).toContain(rows[0].cells[0].style.borderBottomStyle);
  expect(rows[1].cells[0].style.borderTopWidth).toBe('0.5pt');
  expect(rows[1].cells[0].style.borderTopColor).toBe('rgb(255, 0, 0)');
  const parsed = parseHtmlClipboard(data['text/html']);
  expect(parsed.cells[0][0].s).not.toHaveProperty('bb');
  expect(parsed.cells[1][0].s).toMatchObject({ bt: true, btBorder: { bs: 'thin', bc: '#ff0000' } });
});

it('shows unsupported display diagnostics and clears them when a compatible native style replaces the report', async () => {
  const { wb } = pivotDisplayBook({ dxfs: [xml('dxf', '<fill><gradientFill/></fill>'), xml('dxf')] });
  const view = await editor(wb), notice = view.el.querySelector('.pivot-display-notice');
  expect(notice.hidden).toBe(false); expect(notice.textContent).toContain('“Summary”');
  expect(notice.title).toContain('not implemented');
  wb.nativePivots = { ...wb.nativePivots, dxfs: [xml('dxf', '<font><b/></font>'), xml('dxf')] };
  wb._changed('pivots'); await settle(); expect(notice.hidden).toBe(true);
});
