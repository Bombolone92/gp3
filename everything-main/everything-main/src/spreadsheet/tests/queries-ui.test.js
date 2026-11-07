// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openQueryEditor } from '../src/ui/query-editor.js';
import { createQueriesPane } from '../src/ui/queries-pane.js';
import { openTextDialog, openImportData, parseLocation, fromTable } from '../src/ui/get-data.js';
import { createRibbon } from '../src/ui/ribbon.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { saveQuery, queryByName, loadResult, evaluateQuery, loadedTable } from '../src/core/queries.js';

window.matchMedia ||= () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
globalThis.CSS ||= {};
CSS.escape ||= (s) => String(s).replace(/["\\]/g, '\\$&');
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
afterEach(() => { closeMenu(); closeAllModals(); document.body.replaceChildren(); });

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  [['Region', 'Units'], ['North', 10], ['South', 4], ['North', 7], ['East', 1]].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.addTable(id, { r1: 0, c1: 0, r2: 4, c2: 1 }, { name: 'Sales' });
  const ctx = { wb, grid: { focus: vi.fn(), editing: false }, sheetId: () => wb.activeSheetId, active: () => ({ r: 1, c: 0 }), subscribe: () => () => {}, onQueriesChanged: vi.fn() };
  return { wb, id, ctx };
}
const draftFor = () => ({ id: 'q1', name: 'Sales', source: { kind: 'table', table: 'Sales' }, steps: [{ id: 's1', type: 'changeType', columns: { Region: 'text', Units: 'int' } }], load: { kind: 'connection' } });
const steps = () => [...document.querySelectorAll('.pq-step-name')].map((b) => b.textContent);
const headers = () => [...document.querySelectorAll('.pq-live th.pq-col .pq-colname')].map((n) => n.textContent);
const bodyRows = () => [...document.querySelectorAll('.pq-live tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
// Found by attribute value rather than a selector: jsdom's selector engine trips over an '&' in a quoted value.
const button = (label, root = document) => [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label) || null;
const menuItem = (text) => [...document.querySelectorAll('.menu [role="menuitem"], .menu [role="menuitemradio"]')].find((n) => n.textContent.trim().startsWith(text));

describe('Power Query Editor', () => {
  it('previews the query, filters through the header drop-down, and adds the step', async () => {
    const { ctx } = book();
    const editor = openQueryEditor(ctx, { draft: draftFor() });
    await editor.ready;
    expect(headers()).toEqual(['Region', 'Units']);
    expect(steps()).toEqual(['Source', 'Changed Type']);
    expect(bodyRows()).toHaveLength(4);
    button('Filter Region').click();
    const popup = document.querySelector('.pq-popup');
    const north = [...popup.querySelectorAll('label.check')].find((l) => l.textContent === 'North').querySelector('input');
    north.checked = false;
    [...popup.querySelectorAll('button')].find((b) => b.textContent === 'OK').click();
    await settle();
    expect(steps()).toEqual(['Source', 'Changed Type', 'Filtered Rows']);
    expect(bodyRows().map((r) => r[0])).toEqual(['South', 'East']);
    expect(document.querySelector('.pq-formula-text').textContent).toContain('Table.SelectRows(#"Changed Type", each List.Contains({"South", "East"}, [Region]))');
    expect(document.querySelector('.pq-status-left').textContent).toBe('2 COLUMNS, 2 ROWS');
  });

  it('shows any step by selecting it and deletes a step with its button', async () => {
    const { ctx } = book();
    const editor = openQueryEditor(ctx, { draft: { ...draftFor(), steps: [...draftFor().steps, { id: 's2', type: 'sortRows', keys: [{ column: 'Units', desc: false }] }] } });
    await editor.ready;
    expect(bodyRows().map((r) => r[1])).toEqual(['1', '4', '7', '10']);
    [...document.querySelectorAll('.pq-step-name')].find((b) => b.textContent === 'Source').click();
    await settle();
    expect(document.querySelector('.pq-formula-text').textContent).toBe('= Excel.CurrentWorkbook(){[Name="Sales"]}[Content]');
    expect(bodyRows().map((r) => r[1])).toEqual(['10', '4', '7', '1']);
    [...document.querySelectorAll('.pq-step-name')].find((b) => b.textContent === 'Sorted Rows').click();
    await settle();
    button('Delete Sorted Rows').click();
    await settle();
    expect(steps()).toEqual(['Source', 'Changed Type']);
  });

  it('removes, renames and retypes columns from the ribbon and the headers', async () => {
    const { ctx } = book();
    const editor = openQueryEditor(ctx, { draft: draftFor() });
    await editor.ready;
    // Rename by double-clicking the header.
    document.querySelector('th.pq-col[data-col="Units"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = document.querySelector('.pq-rename');
    input.value = 'Qty';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(headers()).toEqual(['Region', 'Qty']);
    expect(steps().at(-1)).toBe('Renamed Columns');
    // The type button merges into the Changed Type step when that step comes just before.
    document.querySelector('th.pq-col[data-col="Region"]').click();
    button('Remove Columns').click();
    menuItem('Remove Columns').click();
    await settle();
    expect(headers()).toEqual(['Qty']);
    expect(steps()).toEqual(['Source', 'Changed Type', 'Renamed Columns', 'Removed Columns']);
  });

  it('groups rows from the Group By dialog', async () => {
    const { ctx } = book();
    const editor = openQueryEditor(ctx, { draft: draftFor() });
    await editor.ready;
    document.querySelector('th.pq-col[data-col="Region"]').click();
    button('Group By').click();
    const dialog = [...document.querySelectorAll('.modal-panel')].at(-1);
    const [name, op, column] = dialog.querySelectorAll('.pq-group-rows')[1].querySelectorAll('input, select');
    name.value = 'Total'; op.value = 'sum'; op.dispatchEvent(new Event('change')); column.value = 'Units';
    dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(headers()).toEqual(['Region', 'Total']);
    expect(bodyRows()).toEqual([['North', '17'], ['South', '4'], ['East', '1']]);
  });

  it('Close & Load saves the new query and loads it to a new sheet as a table', async () => {
    const { wb, ctx } = book();
    const editor = openQueryEditor(ctx, { draft: draftFor() });
    await editor.ready;
    button('Close & Load', document.querySelector('.pq-editor')).click();
    await settle(12);
    const q = queryByName(wb, 'Sales');
    expect(q).toBeTruthy();
    const hit = loadedTable(wb, q);
    expect(hit.sheet.name).toBe('Sales');
    expect(hit.table.name).toBe('Sales_2');
    expect(wb.getValue(hit.sheet.id, 1, 1)).toBe(10);
    expect(document.querySelector('.pq-editor')?.closest('.modal-root:not(.closing)')).toBeFalsy();
  });

  it('asks before discarding changes and keeps the workbook as it was on Discard', async () => {
    const { wb, ctx } = book();
    saveQuery(wb, draftFor());
    const editor = openQueryEditor(ctx, { queryId: 'q1' });
    await editor.ready;
    document.querySelector('th.pq-col[data-col="Region"]').click();
    button('Sort Descending').click();
    await settle();
    button('Close', document.querySelector('.pq-titlebar')).click();
    const discard = [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Discard');
    expect(discard).toBeTruthy();
    discard.click();
    expect(queryByName(wb, 'Sales').steps).toHaveLength(1);
  });

  it('starts a blank query with no source and gives it one from the Source dialog', async () => {
    const { wb, ctx } = book();
    const editor = openQueryEditor(ctx, { draft: { id: 'b', name: 'Query1', source: { kind: 'blank' }, steps: [], load: { kind: 'connection' } } });
    await editor.ready;
    expect(document.querySelector('.pq-empty').textContent).toContain('no source');
    [...document.querySelectorAll('.pq-empty button')][0].click();
    const dialog = [...document.querySelectorAll('.modal-panel')].at(-1);
    dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(10);
    expect(headers()).toEqual(['Region', 'Units']);
    expect(steps()).toEqual(['Source', 'Changed Type']);
    expect(wb.queries).toHaveLength(0);
  });
});

describe('Queries & Connections pane', () => {
  it('lists queries with what they loaded, and refreshes, edits and deletes them', async () => {
    const { wb, id, ctx } = book();
    const q = saveQuery(wb, draftFor());
    loadResult(wb, q, (await evaluateQuery(wb, q, {})).table);
    saveQuery(wb, { id: 'c', name: 'Conn', source: { kind: 'table', table: 'Sales' }, steps: [], load: { kind: 'connection' } });
    const edit = vi.fn();
    const pane = createQueriesPane({ ...ctx, edit });
    document.body.append(pane.el);
    pane.show();
    const items = () => [...pane.el.querySelectorAll('.qc-item')].map((n) => n.querySelector('.qc-name').textContent + ' | ' + n.querySelector('.qc-status').textContent);
    expect(items()).toEqual(['Sales | 4 rows loaded.', 'Conn | Connection only.']);
    wb.setInput(id, 5, 0, 'West'); wb.setInput(id, 5, 1, '3');
    button('Refresh Sales', pane.el).click();
    await settle(10);
    expect(items()[0]).toBe('Sales | 5 rows loaded.');
    button('Edit Conn', pane.el).click();
    expect(edit).toHaveBeenCalledWith('c');
    button('Delete Conn', pane.el).click();
    await settle();
    [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'Delete').click();
    await settle();
    expect(items()).toEqual(['Sales | 5 rows loaded.']);
    pane.destroy();
  });
});

describe('Get Data dialogs', () => {
  it('previews delimited text with the detected delimiter and loads it to a new sheet', async () => {
    const { wb, ctx } = book();
    openTextDialog(ctx, { name: 'people.csv', text: 'Name;Age\nAda;36\nAlan;41\n' });
    const dialog = document.querySelector('.pq-source-dialog');
    expect(dialog.querySelector('select[aria-label="Delimiter"]').value).toBe(';');
    expect([...dialog.querySelectorAll('.pq-table thead .pq-colname')].map((n) => n.textContent)).toEqual(['Name', 'Age']);
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Load').click();
    await settle(10);
    const q = queryByName(wb, 'people');
    expect(q.steps.map((s) => s.type)).toEqual(['promoteHeaders', 'changeType']);
    const hit = loadedTable(wb, q);
    expect(wb.getValue(hit.sheet.id, 2, 1)).toBe(41);
  });

  it('Import Data loads a query at an existing cell, or as a connection only', async () => {
    const { wb, id, ctx } = book();
    expect(parseLocation(wb, '=Sheet1!$D$2', id)).toEqual({ sheetId: id, r: 1, c: 3 });
    expect(parseLocation(wb, "='No such'!A1", id)).toBeNull();
    openImportData(ctx, { query: { id: 'n', name: 'Copy', source: { kind: 'table', table: 'Sales' }, steps: [], load: { kind: 'connection' } }, fresh: true });
    const form = document.querySelector('.pq-import');
    form.querySelector('input[value="existing"]').click();
    form.querySelector('input[aria-label="Existing worksheet location"]').value = '=$E$1';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(10);
    expect(wb.getValue(id, 0, 4)).toBe('Region');
    expect(loadedTable(wb, queryByName(wb, 'Copy')).sheet.id).toBe(id);
  });

  it('From Table/Range on a range makes it a table first, then opens the editor', async () => {
    const { wb, ctx } = book();
    const sheet = wb.addSheet('Plain');
    wb.setInput(sheet.id, 0, 0, 'A'); wb.setInput(sheet.id, 1, 0, '1');
    ctx.sheetId = () => sheet.id; ctx.active = () => ({ r: 0, c: 0 });
    const editor = vi.fn();
    fromTable(ctx, editor, { createTable: (then) => { const tid = wb.addTable(sheet.id, { r1: 0, c1: 0, r2: 1, c2: 0 }); then(wb.tableById(sheet.id, tid)); } });
    await settle();
    expect(editor).toHaveBeenCalledTimes(1);
    const { draft } = editor.mock.calls[0][1];
    expect(draft.source).toEqual({ kind: 'table', table: 'Table1' });
    expect(draft.steps[0].columns).toEqual({ A: 'int' });
  });
});

describe('Data tab', () => {
  it('offers Get Data, the source buttons, Refresh All and the Queries & Connections pane', () => {
    const wb = new Workbook();
    const state = { style: {} };
    const run = vi.fn();
    const ctx = { wb, flags: () => state, run, style: () => ({}), active: () => ({ r: 0, c: 0 }), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId,
      grid: { editing: false, focus: vi.fn() }, subscribe: () => () => {} };
    const ribbon = createRibbon(ctx);
    document.body.append(ribbon.el);
    ribbon.select('Data');
    expect(button('Power Query')).toBeNull();
    const group = [...ribbon.el.querySelectorAll('.ribbon-group')].find((g) => g.getAttribute('aria-label') === 'Get & Transform Data');
    expect([...group.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Get Data', 'From Text/CSV', 'From Web', 'From Table/Range']);
    button('From Text/CSV').click(); expect(run).toHaveBeenLastCalledWith('getDataText', null);
    button('From Web').click(); expect(run).toHaveBeenLastCalledWith('getDataWeb', null);
    button('From Table/Range').click(); expect(run).toHaveBeenLastCalledWith('getDataTable', null);
    button('Refresh All').click(); expect(run).toHaveBeenLastCalledWith('refreshAll', null);
    button('Queries & Connections').click(); expect(run).toHaveBeenLastCalledWith('queriesPane', null);
    button('Get Data').click();
    expect([...document.querySelectorAll('.menu [role="menuitem"]')].map((n) => n.textContent.trim())).toEqual(['From File', 'From Other Sources', 'Launch Power Query Editor…']);
    menuItem('Launch Power Query Editor').click();
    expect(run).toHaveBeenLastCalledWith('powerQueryEditor', undefined);
    ribbon.destroy();
  });
});
