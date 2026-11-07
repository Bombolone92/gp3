import { describe, it, expect, beforeEach } from 'vitest';
import { mountApp, openBase, tick, key } from './helpers/app.js';
import { makeChoice } from '../src/data/base.js';

let page;
let grid;
let table;
const F = (name) => table.fieldByName(name);

beforeEach(async () => {
  const { app, store } = await mountApp();
  const id = await store.createBase({ name: 'Grid' });
  page = await openBase(app, id);
  table = page.table;
  const b = page.base;
  b.addField(table.id, { name: 'Qty', type: 'number' });
  b.addField(table.id, { name: 'Done', type: 'checkbox' });
  b.createRecords(table.id, [
    { [table.primary.id]: 'Alpha', [F('Qty').id]: 1 },
    { [table.primary.id]: 'Beta', [F('Qty').id]: 2 },
    { [table.primary.id]: 'Gamma', [F('Qty').id]: 3 },
  ]);
  await tick();
  grid = page.viewInst;
  grid.setCursor(0, 0);
  grid.scroller.focus();
});

const cellText = () => grid.cellProxy.textContent;
const names = () => table.ordered().map((r) => r.c[table.primary.id] ?? null);

describe('grid keyboard', () => {
  it('moves the active cell and tells screen readers', () => {
    expect(cellText()).toBe('Name: Alpha');
    key(grid.scroller, 'ArrowDown');
    expect(cellText()).toBe('Name: Beta');
    key(grid.scroller, 'Tab');
    expect(cellText()).toContain('Notes');
    key(grid.scroller, 'End');
    key(grid.scroller, 'ArrowDown', { metaKey: true, ctrlKey: true });
    expect(grid.cursor.r).toBe(2);
    expect(grid.scroller.getAttribute('aria-activedescendant')).toBe(grid.cellProxy.id);
    expect(grid.rowProxy.getAttribute('aria-rowindex')).toBe('4');
  });

  it('edits by typing, commits with Enter and moves down', async () => {
    key(grid.scroller, 'Z');
    const input = grid.overlay.querySelector('input.cell-editor');
    expect(input.value).toBe('Z');
    input.value = 'Zeta';
    key(input, 'Enter');
    expect(names()[0]).toBe('Zeta');
    expect(grid.cursor.r).toBe(1);
    expect(grid.overlay.querySelector('.cell-editor')).toBeNull();
  });

  it('cancels with Escape', () => {
    key(grid.scroller, 'Enter');
    const input = grid.overlay.querySelector('input.cell-editor');
    input.value = 'nope';
    key(input, 'Escape');
    expect(names()[0]).toBe('Alpha');
  });

  it('rejects text in a number field', () => {
    grid.setCursor(0, grid.layout.cols.findIndex((c) => c.field.name === 'Qty'));
    key(grid.scroller, 'Enter');
    const input = grid.overlay.querySelector('input.cell-editor');
    input.value = 'lots';
    key(input, 'Enter');
    expect(table.ordered()[0].c[F('Qty').id]).toBe(1);
  });

  it('clears a selection with Delete, and undo restores it', () => {
    const q = grid.layout.cols.findIndex((c) => c.field.name === 'Qty');
    grid.setCursor(0, q);
    key(grid.scroller, 'ArrowDown', { shiftKey: true });
    key(grid.scroller, 'Delete');
    expect(table.ordered().map((r) => r.c[F('Qty').id] ?? null)).toEqual([null, null, 3]);
    page.undo();
    expect(table.ordered().map((r) => r.c[F('Qty').id])).toEqual([1, 2, 3]);
  });

  it('toggles checkboxes with Enter and Space', () => {
    const c = grid.layout.cols.findIndex((x) => x.field.name === 'Done');
    grid.setCursor(1, c);
    key(grid.scroller, 'Enter');
    expect(table.ordered()[1].c[F('Done').id]).toBe(true);
    key(grid.scroller, ' ');
    expect(table.ordered()[1].c[F('Done').id]).toBeUndefined();
  });

  it('inserts a record below with Shift+Enter', () => {
    key(grid.scroller, 'Enter', { shiftKey: true });
    expect(names()).toEqual(['Alpha', null, 'Beta', 'Gamma']);
    expect(grid.cursor.r).toBe(1);
  });

  it('fills down with Ctrl/Cmd+D', () => {
    const q = grid.layout.cols.findIndex((c) => c.field.name === 'Qty');
    grid.setCursor(0, q);
    grid.setCursor(2, q, { extend: true });
    key(grid.scroller, 'd', { metaKey: true, ctrlKey: true });
    expect(table.ordered().map((r) => r.c[F('Qty').id])).toEqual([1, 1, 1]);
  });

  it('opens the record with Space', async () => {
    key(grid.scroller, ' ');
    await tick();
    expect(document.querySelector('dialog.record-dialog .record-title').textContent).toBe('Alpha');
  });
});

describe('grid clipboard', () => {
  it('pastes a block, adding records and select options as needed', () => {
    const b = page.base;
    const a = makeChoice('Low');
    b.addField(table.id, { name: 'Pri', type: 'singleSelect', options: { choices: [a] } });
    const pri = grid.layout.cols.findIndex((c) => c.field.name === 'Pri');
    grid.setCursor(2, pri - 1);
    grid.pasteText('7\tLow\n8\tHigh\n9\tHigh');
    const recs = table.ordered();
    expect(recs.length).toBe(5);
    const field = F('Pri');
    expect(field.options.choices.map((c) => c.name)).toEqual(['Low', 'High']);
    const high = field.options.choices[1].id;
    expect(recs.slice(2).map((r) => r.c[field.id])).toEqual([a.id, high, high]);
    page.undo();
    expect(table.ordered().length).toBe(3);
  });

  it('fills a selection with a single pasted value', () => {
    const q = grid.layout.cols.findIndex((c) => c.field.name === 'Qty');
    grid.setCursor(0, q);
    grid.setCursor(2, q, { extend: true });
    grid.pasteText('5');
    expect(table.ordered().map((r) => r.c[F('Qty').id])).toEqual([5, 5, 5]);
  });

  it('copies cells as tab separated text', () => {
    const q = grid.layout.cols.findIndex((c) => c.field.name === 'Qty');
    grid.setCursor(0, 0);
    grid.setCursor(1, q, { extend: true });
    const data = {};
    const e = new Event('copy', { bubbles: true, cancelable: true });
    e.clipboardData = { setData: (t, v) => (data[t] = v) };
    grid.handleCopy(e, false);
    const rows = data['text/plain'].split('\n').map((r) => r.split('\t'));
    expect(rows[0][0]).toBe('Alpha');
    expect(rows[1][rows[1].length - 1]).toBe('2');
  });
});

describe('grid view state', () => {
  it('follows filters, sorts and groups', async () => {
    const b = page.base;
    const v = page.view;
    b.updateView(table.id, v.id, { sorts: [{ fieldId: F('Qty').id, dir: 'desc' }] });
    expect(grid.layout.records.map((r) => r.c[table.primary.id])).toEqual(['Gamma', 'Beta', 'Alpha']);
    b.updateView(table.id, v.id, { groups: [{ fieldId: F('Done').id, dir: 'asc' }] });
    expect(grid.layout.rows.filter((r) => r.k === 'group').length).toBe(1);
    // Collapsing a group hides its records.
    grid.toggleGroup(grid.layout.rows.find((r) => r.k === 'group').node.path);
    expect(grid.layout.records.length).toBe(0);
  });

  it('keeps the active cell on the same record when rows move', () => {
    grid.setCursor(2, 0);
    page.base.updateView(table.id, page.view.id, { sorts: [{ fieldId: F('Qty').id, dir: 'desc' }] });
    expect(cellText()).toBe('Name: Gamma');
    expect(grid.cursor.r).toBe(0);
  });

  it('summarizes a column', () => {
    page.base.updateView(table.id, page.view.id, { summaries: { [F('Qty').id]: 'sum' } });
    expect(grid.summaryText(grid.layout.cols.find((c) => c.field.name === 'Qty'))).toBe('Sum 6');
  });
});
