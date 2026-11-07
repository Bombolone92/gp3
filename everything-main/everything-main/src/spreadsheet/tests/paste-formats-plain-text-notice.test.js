// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

// Edit > Paste special > Formatting only with another app's plain text on the clipboard did nothing,
// in silence, where the other paste specials that cannot apply say why. It now says that plain text
// carries no formatting; an HTML table's styles still paste as before.
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

const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
const clipboardOf = (items) => ({ read: async () => items.map(({ type, text }) => ({ types: [type], getType: async () => ({ text: async () => text }) })) });

async function mount(clipboard) {
  vi.stubGlobal('navigator', { onLine: true, clipboard });
  const doc = new Doc({ name: 'Special', path: 'Spreadsheets/Special.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'kept');
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('.grid-viewport').focus();
  const toast = vi.spyOn(notifications, 'toast');
  const pasteFormatsOnly = async () => {
    view.el.querySelector('[data-menu="edit"]').click();
    menuItem('Paste special').click();
    menuItem('Formatting only').click();
    await vi.advanceTimersByTimeAsync(5);
  };
  return { wb, id, toast, pasteFormatsOnly, before: JSON.stringify(wb.toJSON()) };
}

it('says that plain text carries no formatting instead of doing nothing', async () => {
  const { wb, toast, pasteFormatsOnly, before } = await mount(clipboardOf([{ type: 'text/plain', text: 'hello\tworld' }]));
  await pasteFormatsOnly();
  expect(toast).toHaveBeenCalledWith('Plain text carries no formatting to paste', expect.objectContaining({ icon: 'info' }));
  expect(JSON.stringify(wb.toJSON())).toBe(before);
  expect(wb.canUndo()).toBe(false);
});

it('still pastes the formatting of an HTML table without the notice', async () => {
  const html = '<table><tr><td style="font-weight:bold">12</td></tr></table>';
  const { wb, id, toast, pasteFormatsOnly } = await mount(clipboardOf([{ type: 'text/html', text: html }, { type: 'text/plain', text: '12' }]));
  await pasteFormatsOnly();
  expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/no formatting/), expect.anything());
  expect(wb.getCell(id, 0, 0)).toMatchObject({ v: 'kept', s: { bold: true } });
});

it('replaces inherited destination formatting through the Formatting only menu', async () => {
  const html = '<table><tr><td style="font-style:italic">12</td></tr></table>';
  const { wb, id, pasteFormatsOnly } = await mount(clipboardOf([{ type: 'text/html', text: html }]));
  wb.applyStyle(id, { r1: 0, c1: 0, r2: wb.activeSheet.rows - 1, c2: 0 },
    { bold: true, bg: '#ffcc99', fmt: 'currency', cur: 'USD', bt: true, bs: 'double' });
  wb.setInput(id, 0, 0, '=6*7'); wb.clearHistory(); const before = wb.toJSON();
  await pasteFormatsOnly();
  expect(wb.getCell(id, 0, 0).f).toBe('6*7'); expect(wb.getValue(id, 0, 0)).toBe(42);
  expect(wb.styleAt(id, 0, 0)).toMatchObject({ italic: true, bold: null, bg: null, fmt: null, cur: null, bt: null, bs: null });
  expect(wb.styleAt(id, 1, 0)).toMatchObject({ bold: true, bg: '#ffcc99', fmt: 'currency', bt: true });
  wb.undo(); expect(wb.toJSON()).toEqual(before);
});
