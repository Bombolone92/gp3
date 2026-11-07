// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { parseRange } from '../src/core/cell.js';
import { closeAllModals } from '../src/ui/modal.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

let view;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
  localStorage.clear(); document.body.replaceChildren();
});
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const key = (node, key, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const flush = () => vi.advanceTimersByTimeAsync(1);
async function mount() {
  const doc = new Doc({ name: 'Ribbon workflows' }); const wb = doc.wb; const id = wb.activeSheetId;
  [['Item', 'Quantity', 'Price', 'Total'], ['Notebook', '3', '4.5', '=B2*C2'], ['Pencil', '6', '1.25', '=B3*C3'], ['Folder', '2', '3', '=B4*C4']]
    .forEach((row, r) => row.forEach((value, c) => wb.setInput(id, r, c, value)));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush(); return { wb, id };
}
const button = label => [...view.el.querySelectorAll(`button[aria-label="${label}"]`)].find(b => !b.closest('[hidden]'));
async function select(range) {
  const name = view.el.querySelector('.name-box'); name.value = range; key(name, 'Enter'); await flush();
}
const ribbonTab = name => [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === name);

it('formats via the ribbon and preserves the resulting workbook in XLSX', async () => {
  const { wb, id } = await mount(); await select('A1:D1'); button('Bold').click(); await flush();
  await select('C2:D4');
  view.el.querySelector('.tb-fmt').click(); await flush();
  [...document.querySelectorAll('.menu-item')].find(n => n.querySelector('.menu-label')?.textContent === 'Currency').click(); await flush();
  button('Bottom align').click(); await flush();
  expect(wb.getValue(id, 1, 3)).toBe(13.5);
  expect(wb.getDisplay(id, 1, 3)).toBe('$13.50');
  expect(wb.getCell(id, 0, 0).s.bold).toBe(true);
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'ribbon.xlsx');
  expect(back.getDisplay(back.activeSheetId, 1, 3)).toBe('$13.50');
  expect(back.getCell(back.activeSheetId, 0, 0).s.bold).toBe(true);
  expect(back.getCell(back.activeSheetId, 1, 3).s.valign).toBe('bottom');
  expect(back.getCell(back.activeSheetId, 1, 3).f).toBe('B2*C2');
});

it('sorts from Data and undoes without separating row values or formulas', async () => {
  const { wb, id } = await mount(); await select('B:B'); ribbonTab('Data').click(); button('Sort Z to A').click(); await flush();
  expect([1, 2, 3].map(r => wb.getValue(id, r, 0))).toEqual(['Pencil', 'Notebook', 'Folder']);
  expect([1, 2, 3].map(r => wb.getValue(id, r, 3))).toEqual([7.5, 13.5, 6]);
  ribbonTab('Home').click(); button('Undo').click(); await flush();
  expect([1, 2, 3].map(r => wb.getValue(id, r, 0))).toEqual(['Notebook', 'Pencil', 'Folder']);
});

it('keeps fixed edit actions in Ready mode and cancels or applies through the validated grid path', async () => {
  const { wb, id } = await mount(); await select('D2');
  expect(view.el.querySelector('.fx-actions').hidden).toBe(false);
  expect(button('Apply edit').disabled).toBe(true);
  const input = view.el.querySelector('.formula-input'); input.focus(); input.value = '=B2*C2*2'; input.dispatchEvent(new Event('input'));
  ribbonTab('Data').click(); await flush(); expect(input.value).toBe('=B2*C2*2');
  expect(button('Cancel edit').disabled).toBe(false); button('Cancel edit').click(); await flush();
  expect(wb.getValue(id, 1, 3)).toBe(13.5);
  input.focus(); input.value = '=B2*C2*2'; input.dispatchEvent(new Event('input')); await flush();
  button('Apply edit').click(); await flush(); expect(wb.getValue(id, 1, 3)).toBe(27);
  expect(button('Apply edit').disabled).toBe(true);
  wb.undo(); expect(wb.getValue(id, 1, 3)).toBe(13.5);
});

it('zooms through the slider while retaining keyboard focus and updating the workbook view', async () => {
  const { wb, id } = await mount(); const slider = view.el.querySelector('.zoom-slider');
  slider.focus(); slider.value = '125'; slider.dispatchEvent(new Event('input', { bubbles: true })); await flush();
  expect(document.activeElement).toBe(slider);
  expect(slider.getAttribute('aria-valuetext')).toBe('125%');
  expect(wb.sheet(id).viewZoom).toBe(1.25);
});

it('adds a sheet from the relocated tab action and can undo the structural change', async () => {
  const { wb } = await mount(); expect(wb.sheets).toHaveLength(1);
  button('Add sheet').click(); await flush(); expect(wb.sheets).toHaveLength(2);
  button('Undo').click(); await flush(); expect(wb.sheets).toHaveLength(1);
});

async function tableContext({ neighbors = false } = {}) {
  const { wb, id } = await mount();
  if (neighbors) wb.setInput(id, 1, 4, 'Adjacent data');
  const tableId = wb.addTable(id, parseRange('A1:D4'), { name: 'Supplies', style: 'blue' });
  await select('B2'); await flush();
  return { wb, id, tableId, table: () => wb.tableById(id, tableId) };
}

it('changes table style options and totals with undo and XLSX persistence', async () => {
  const { wb, id, table } = await tableContext();
  expect(ribbonTab('Table').getAttribute('aria-selected')).toBe('true');
  button('Banded Rows').click(); await flush(); expect(table().banded).toBe(false);
  button('First Column').click(); await flush(); expect(table().firstColumn).toBe(true);
  button('Last Column').click(); await flush(); expect(table().lastColumn).toBe(true);
  button('Green table style').click(); await flush(); expect(table().style).toBe('green');
  button('Total Row').click(); await flush(); expect(table().totalsRow).toBe(true);
  expect(wb.getValue(id, 4, 3)).toBe(27);
  expect(button('Total Row').getAttribute('aria-pressed')).toBe('true');
  wb.undo(); await flush(); expect(table().totalsRow).toBe(false);
  expect(button('Total Row').getAttribute('aria-pressed')).toBe('false');
  wb.redo(); await flush();
  const back = await workbookFromFile(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), 'table-ribbon.xlsx');
  expect(back.tablesOn(back.activeSheetId)[0]).toMatchObject({ name: 'Supplies', style: 'green', banded: false, firstColumn: true, lastColumn: true, totalsRow: true });
  expect(back.getValue(back.activeSheetId, 4, 3)).toBe(27);
  expect(back.getCell(back.activeSheetId, 1, 3).f).toBe('B2*C2');
});

it('renames from the contextual field, validates errors, rewrites references and undoes', async () => {
  const { wb, id, table } = await tableContext();
  wb.setInput(id, 1, 5, '=SUM(Supplies[Total])'); await flush();
  const name = view.el.querySelector('[aria-label="Table Name"]');
  name.focus(); name.value = 'A1'; key(name, 'Enter'); await flush();
  expect(name.getAttribute('aria-invalid')).toBe('true'); expect(table().name).toBe('Supplies');
  expect(view.el.querySelector('.ribbon-table-error').textContent).toContain('cell reference');
  name.value = 'Purchases'; name.dispatchEvent(new Event('input')); key(name, 'Enter'); await flush();
  expect(table().name).toBe('Purchases'); expect(wb.getCell(id, 1, 5).f).toBe('SUM(Purchases[Total])');
  expect(wb.getValue(id, 1, 5)).toBe(27); expect(name.hasAttribute('aria-invalid')).toBe(false);
  wb.undo(); await flush(); expect(table().name).toBe('Supplies'); expect(name.value).toBe('Supplies');
  expect(wb.getCell(id, 1, 5).f).toBe('SUM(Supplies[Total])');
});

it('converts the table to a range, preserves values and rewrites formulas, with undo', async () => {
  const { wb, id, table } = await tableContext();
  wb.setInput(id, 1, 5, '=SUM(Supplies[Total])'); await flush();
  button('Convert to Range').click(); await flush();
  expect(table()).toBeFalsy(); expect(ribbonTab('Table').hidden).toBe(true);
  expect(wb.getValue(id, 1, 5)).toBe(27); expect(wb.getCell(id, 1, 5).f).not.toContain('Supplies');
  wb.undo(); await flush(); expect(table().name).toBe('Supplies'); expect(ribbonTab('Table').hidden).toBe(false);
  expect(wb.getCell(id, 1, 5).f).toBe('SUM(Supplies[Total])');
});

it('uses the table header and data as the source for table tools, excluding totals and neighbors', async () => {
  await tableContext({ neighbors: true });
  button('Total Row').click(); await flush();
  button('Summarize with PivotTable').click(); await flush();
  expect(document.querySelector('[aria-label="Source range"]').value).toBe('A1:D4');
  closeAllModals(); await vi.advanceTimersByTimeAsync(200);
  button('Remove Duplicates').click(); await flush();
  expect(document.querySelector('.modal-root').textContent).toContain('Rows in A1:D4');
  expect(document.querySelector('.modal-root input[type="checkbox"]').checked).toBe(true);
});

it('disables contextual mutations while a cell entry is pending and leaves it unchanged', async () => {
  const { wb, id, table } = await tableContext();
  await select('D2'); const input = view.el.querySelector('.formula-input');
  input.focus(); input.value = '=B2*C2*2'; input.dispatchEvent(new Event('input')); await flush();
  expect(button('Banded Rows').disabled).toBe(true); button('Banded Rows').click();
  expect(table().banded).toBe(true); expect(wb.getValue(id, 1, 3)).toBe(13.5);
  expect(input.value).toBe('=B2*C2*2'); button('Cancel edit').click(); await flush();
  expect(button('Banded Rows').disabled).toBe(false);
});

it('preserves imported table themes for option edits and replaces them on an explicit gallery choice', async () => {
  const { wb, id } = await mount();
  const customStyle = { headerRow: { bg: '#224466', bold: true }, firstRowStripe: { bg: '#ccddee', stripeSize: 2 } };
  const [sheet] = wb.importSheets(new Workbook({ sheets: [{ name: 'Imported', tables: [{ id: 'themeTable', name: 'ImportedTable', range: parseRange('A1:D4'), style: 'blue', banded: true, totalsRow: false, customStyle }] }] }));
  wb.setActiveSheet(sheet.id); await flush();
  const table = () => wb.tableAt(sheet.id, 1, 1);
  await select('B2'); button('Banded Rows').click(); await flush();
  expect(table().customStyle).toMatchObject(customStyle);
  button('Blue table style').click(); await flush();
  expect(table().customStyle).toBeUndefined(); expect(table().style).toBe('blue');
  wb.undo(); await flush(); expect(table().customStyle).toMatchObject(customStyle);
});

it('blocks contextual table mutations on a protected sheet and enables them after unprotecting', async () => {
  const { wb, id, table } = await tableContext();
  wb.setSheetProtected(id,true); await flush(); wb.clearHistory();
  const before = wb.toJSON();
  for (const label of ['Banded Rows','Total Row','First Column','Last Column','Convert to Range','Green table style']) {
    expect(button(label).disabled).toBe(true); button(label).click();
  }
  expect(wb.toJSON()).toEqual(before); expect(wb.canUndo()).toBe(false);
  wb.setSheetProtected(id,false); await flush();
  button('Banded Rows').click(); await flush(); expect(table().banded).toBe(false);
});
