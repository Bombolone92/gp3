// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openTableDialog } from '../src/ui/tabledialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { toast } from '../src/ui/toast.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
  toast.mockClear();
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function setup(action) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const range = { r1: 0, c1: 0, r2: 1, c2: 1 };
  wb.setCells(id, [['Item', 'Amount'], ['A', 10]].flatMap((row, r) => row.map((v, c) => ({ r, c, cell: { v } }))));
  const tid = action === 'create' ? null : wb.addTable(id, range, { name: 'Sales' });
  const modal = openTableDialog({ wb, sheetId: () => id, grid: { focus() {}, setSelection() {} } }, { range, table: tid ? wb.tableById(id, tid) : null });
  const name = modal.panel.querySelector('[aria-label="Table name"]');
  name.value = 'Draft';
  const submit = () => action === 'convert'
    ? [...modal.panel.querySelectorAll('button')].find((button) => button.textContent === 'Convert to range').click()
    : modal.panel.querySelector('form').requestSubmit();
  const check = (text) => [...modal.panel.querySelectorAll('label')].find((label) => label.textContent.includes(text)).querySelector('input');
  return { wb, id, tid, modal, name, submit, check };
}

it.each(['create', 'edit'])('retains the draft when %s conflicts with a defined name', (action) => {
  const { wb, id, modal, name, submit } = setup(action);
  wb.defineName('draft', 'Sheet1!D1');
  wb.clearHistory();
  const before = wb.toJSON();
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').textContent).toBe('That name is already used');
  expect(name.value).toBe('Draft');
  expect(document.activeElement).toBe(name);
  expect(toast).not.toHaveBeenCalled();
  name.value = 'UniqueTable';
  submit();
  expect(wb.tablesOn(id)[0].name).toBe('UniqueTable');
});

it.each(['create', 'edit', 'convert'])('keeps the table dialog open when protection refuses %s, then allows retry', (action) => {
  const { wb, id, modal, name, submit } = setup(action);
  wb.setSheetProtected(id, true);
  wb.clearHistory();
  const before = wb.toJSON();
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').hidden).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').textContent).toMatch(/protected/i);
  expect(name.value).toBe('Draft');
  expect(toast).not.toHaveBeenCalled();
  wb.setSheetProtected(id, false);
  submit();
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(true);
  if (action === 'convert') expect(wb.tablesOn(id)).toHaveLength(0);
  else expect(wb.tablesOn(id)[0].name).toBe('Draft');
});

it.each(['create', 'edit'])('retains the draft and makes no structural changes when %s would add protected totals', (action) => {
  const { wb, id, modal, name, submit, check } = setup(action);
  check('Totals row').checked = true;
  if (action === 'create') check('My data has a header').checked = false;
  wb.protectRange(id, { r1: 2, c1: 1, r2: 2, c2: 1 });
  wb.clearHistory();
  const before = wb.toJSON();
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').hidden).toBe(false);
  expect(name.value).toBe('Draft');
  expect(toast).not.toHaveBeenCalled();
});

it.each([true, false])('retains the draft when protected headers prevent creation (existing header: %s)', (existingHeader) => {
  const { wb, id, modal, name, submit, check } = setup('create');
  if (existingHeader) {
    wb.setInput(id, 0, 1, '');
    wb.protectRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 });
  } else {
    modal.panel.querySelector('[aria-label="Range"]').value = 'A2:B3';
    wb.protectRange(id, { r1: 0, c1: 1, r2: 1, c2: 1 });
  }
  check('My data has a header').checked = existingHeader;
  wb.clearHistory();
  const before = wb.toJSON();
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').hidden).toBe(false);
  expect(name.value).toBe('Draft');
  expect(toast).not.toHaveBeenCalled();
});

it.each([
  ['XFE1:XFE2', false, false],
  ['A1048576:A1048576', true, false],
  ['A1048575:A1048576', false, false],
  ['A1048575:A1048576', true, true],
])('keeps the draft without inserting rows when %s leaves no room for the table', (range, header, totals) => {
  const { wb, modal, submit, check } = setup('create');
  modal.panel.querySelector('[aria-label="Range"]').value = range;
  check('My data has a header').checked = header;
  check('Totals row').checked = totals;
  wb.clearHistory();
  const before = wb.toJSON();
  submit();
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
  expect(modal.panel.closest('.modal-root').classList.contains('closing')).toBe(false);
  expect(modal.panel.querySelector('[role="alert"]').textContent).toMatch(/range|room|limit/i);
  expect(toast).not.toHaveBeenCalled();
});
