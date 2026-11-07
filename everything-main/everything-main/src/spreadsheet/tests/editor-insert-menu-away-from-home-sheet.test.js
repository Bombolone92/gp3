// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// With a formula open and another sheet shown to pick references on, the Insert menu was built
// for the sheet on show (its note, its protection, its name) while its committing items acted on
// the formula's home sheet after the commit: Hide sheet hid the sheet the formula was typed on
// while Sheet2 stayed on show, Edit note opened "Add note" on the home cell, and Protect sheet,
// which does not commit, protected the sheet shown. Those items are greyed out while the edit is
// away from its sheet; on the sheet itself they work as before,
// and Delete note commits the entry first as Edit note does.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function setup(cell) {
  const doc = new Doc({ name: 'Sheets', path: 'Spreadsheets/Sheets.xlsx' });
  const wb = doc.wb;
  const home = wb.activeSheetId;
  const other = wb.addSheet('Sheet2').id;
  wb.setActiveSheet(home);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo(`Sheet1!${cell}`);
  await vi.advanceTimersByTimeAsync(1);
  return { wb, home, other };
}

async function type(text) {
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: text[0], bubbles: true, cancelable: true }));
  const editor = view.el.querySelector('.grid-editor');
  editor.value = text;
  editor.setSelectionRange(text.length, text.length);
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1);
  return editor;
}

async function formulaOnOtherSheet(wb, other) {
  const editor = await type('=SUM(');
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', ctrlKey: true, bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.activeSheetId).toBe(other);
  expect(editor.hidden).toBe(false);
  return editor;
}

async function menu(...path) {
  view.el.querySelector(`[data-menu="${path[0]}"]`).click();
  for (const label of path.slice(1)) { item(label).click(); await vi.advanceTimersByTimeAsync(1); }
}

it('greys the sheet, note and link items out while the formula shows another sheet, and a click on one does nothing', async () => {
  const { wb, home, other } = await setup('A4');
  wb.setNote(other, 0, 0, 'on the other sheet');
  wb.clearHistory();
  const editor = await formulaOnOtherSheet(wb, other);
  view.el.querySelector('[data-menu="insert"]').click();
  await vi.advanceTimersByTimeAsync(1);
  for (const label of ['Link…', 'Edit note', 'Delete note']) expect(item(label)?.disabled, label).toBe(true);
  expect(item('Row above')).toBeUndefined(); // inside its submenu, as ever
  item('Sheet').click();
  await vi.advanceTimersByTimeAsync(1);
  for (const label of ['Duplicate sheet', 'Copy sheet to another spreadsheet…', 'Rename sheet…', 'Sheet color…', 'Move sheet left', 'Protect sheet', 'Hide sheet']) {
    expect(item(label)?.disabled, label).toBe(true);
  }
  const deleteSheet = [...document.querySelectorAll('.menu-item')].find((n) => /^Delete sheet/.test(n.querySelector('.menu-label')?.textContent || ''));
  expect(deleteSheet?.disabled).toBe(true);
  expect(item('New sheet').disabled).toBe(false); // adds a sheet, whichever is shown
  item('Hide sheet').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(home).hidden).toBeFalsy();
  expect(wb.sheet(other).hidden).toBeFalsy();
  expect(editor.hidden).toBe(false);
  expect(wb.activeSheetId).toBe(other);
  expect(wb.getCell(home, 3, 0)).toBeFalsy(); // nothing was committed
  closeMenu();
  // Back home (Enter commits), the items are offered again for the sheet shown.
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.activeSheetId).toBe(home);
  await menu('insert', 'Sheet');
  expect(item('Hide sheet').disabled).toBe(false);
  expect(item('Protect sheet').disabled).toBe(false);
});

it('offers them while the edit is on the sheet shown, and Delete note commits the entry first as Edit note does', async () => {
  const { wb, home } = await setup('A4');
  wb.setNote(home, 3, 0, 'here');
  wb.clearHistory();
  const editor = await type('abc');
  view.el.querySelector('[data-menu="insert"]').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(item('Edit note').disabled).toBe(false);
  expect(item('Delete note').disabled).toBe(false);
  expect(item('Link…').disabled).toBe(false);
  item('Sheet').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(item('Hide sheet').disabled).toBe(false);
  closeMenu();
  await menu('insert', 'Delete note');
  expect(wb.getNote(home, 3, 0)).toBeFalsy();
  expect(wb.getValue(home, 3, 0)).toBe('abc');
  expect(editor.hidden).toBe(true);
});
