// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Workbook } from '../src/core/workbook.js';
import { Doc } from '../src/lib/doc.js';
import { parseRange } from '../src/core/cell.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { cellMode } from '../src/ui/statusbar.js';

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
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const key = (node, key, extra = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
const flush = () => vi.advanceTimersByTimeAsync(1);
async function mount() {
  const doc = new Doc({ name: 'Status bar' }); const wb = doc.wb; const id = wb.activeSheetId;
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

const mode = () => view.el.querySelector('.status-mode').textContent;
const typeKey = (k, extra) => { const target = document.activeElement; key(target, k, extra); };

it('names the cell mode', () => {
  expect(cellMode(null)).toBe('Ready');
  expect(cellMode({ mode: 'type', text: '12' })).toBe('Enter');
  expect(cellMode({ mode: 'inplace', text: '12' })).toBe('Edit');
  expect(cellMode({ mode: 'type', text: '=SUM(', refInsert: { start: 5, end: 7 } })).toBe('Point');
});

it('shows Ready, Enter, Edit and Point as an entry is typed, and F2 switches what the arrows do', async () => {
  const { wb, id } = await mount(); await select('F2');
  expect(mode()).toBe('Ready');
  view.el.querySelector('.grid-viewport, .viewport, [role="grid"]')?.focus?.();
  typeKey('7'); await flush();
  expect(mode()).toBe('Enter');
  typeKey('F2'); await flush();
  expect(mode()).toBe('Edit');
  typeKey('ArrowLeft'); await flush();
  expect(mode()).toBe('Edit'); // the caret moved; the entry stays open
  typeKey('F2'); await flush();
  expect(mode()).toBe('Enter');
  typeKey('ArrowDown'); await flush();
  expect(mode()).toBe('Ready');
  expect(wb.getValue(id, 1, 5)).toBe(7);
  await select('F3'); typeKey('='); await flush();
  typeKey('ArrowUp'); await flush();
  expect(mode()).toBe('Point');
  typeKey('Escape'); await flush();
  expect(mode()).toBe('Ready');
});

it('customizes the summary and shortcuts from the right-click menu and remembers the choice', async () => {
  await mount(); await select('A1:D4');
  const bar = view.el.querySelector('.status-bar');
  expect(bar.textContent).not.toContain('Numerical Count');
  bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
  await flush();
  const item = label => [...document.querySelectorAll('.menu [role="menuitemcheckbox"]')].find(b => b.textContent.includes(label));
  expect(item('Numerical Count').getAttribute('aria-checked')).toBe('false');
  expect(item('Sum').getAttribute('aria-checked')).toBe('true');
  item('Numerical Count').click(); await flush();
  expect(bar.textContent).toContain('Numerical Count: 9');
  bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); await flush();
  item('Sum').click(); await flush();
  expect(bar.querySelector('.status-left').textContent).not.toContain('Sum');
  expect(JSON.parse(localStorage.getItem('spreadsheet:status-bar'))).toMatchObject({ numCount: true, sum: false });
  expect(bar.querySelector('button[aria-label="Normal"]').getAttribute('aria-pressed')).toBe('true');
  // Normal, Page Layout and Page Break Preview are all offered, in that order.
  expect([...bar.querySelectorAll('.status-view')].map(b => b.getAttribute('aria-label'))).toEqual(['Normal', 'Page Layout', 'Page Break Preview']);
  expect(bar.querySelector('button[aria-label="Page Break Preview"]').disabled).toBe(false);
  expect(bar.querySelector('button[aria-label="Page Layout"]').disabled).toBe(false);
});
