// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

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
afterEach(() => {
  closeAllModals();
  view?.destroy();
  view = null;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  document.body.classList.remove('printing');
  delete document.fonts;
});

function setup({ recoverable = null, mayBeOlder = false, workbook = null } = {}) {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  if (workbook) doc.wb.replaceWith(workbook);
  doc.recoverable = recoverable;
  doc.recoverableMayBeOlder = mayBeOlder;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  return { doc };
}

it("lays the sheet out for the browser's own Print command and takes it down afterwards", () => {
  const { doc } = setup();
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Quarterly total');
  window.dispatchEvent(new Event('beforeprint'));
  const root = document.querySelector('.print-root');
  expect(root).not.toBeNull();
  expect(root.textContent).toContain('Quarterly total');
  expect(document.body.classList.contains('printing')).toBe(true);
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.print-root')).toBeNull();
  expect(document.body.classList.contains('printing')).toBe(false);
});

it('stops listening for the Print command once the editor is closed', () => {
  setup();
  view.destroy();
  view = null;
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelector('.print-root')).toBeNull();
  expect(document.body.classList.contains('printing')).toBe(false);
});

it('loads offscreen cell fonts before the synchronous browser print measures number-format spacing', async () => {
  let loaded = false;
  const fonts = new EventTarget();
  fonts.check = font => !font.includes('Open Sans') || loaded;
  fonts.load = vi.fn(async () => { loaded = true; fonts.dispatchEvent(new Event('loadingdone')); return []; });
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  HTMLCanvasElement.prototype.getContext.mockImplementation(() => ({
    font: '', measureText(text) { return { width: [...text].length * (this.font.includes('Open Sans') && loaded ? 10 : 5) }; },
  }));
  setup({ workbook: { normalFont: { name: 'Arial', sz: 10 }, sheets: [{ cells: {
    '0,0': { v: 'Visible Arial', s: { font: 'arial' } },
    '90,0': { v: 123, s: { font: 'Open Sans', fmt: 'custom', code: '_W0*-' } },
  } }] } });
  await vi.advanceTimersByTimeAsync(100);
  expect(fonts.load).toHaveBeenCalledWith(expect.stringContaining('Open Sans'), expect.any(String));
  expect(document.querySelector('.print-root')).toBeNull();
  window.dispatchEvent(new Event('beforeprint'));
  const padding = document.querySelector('.print-root .number-format-layout [aria-hidden]');
  expect(padding.style.inlineSize).toBe('10px');
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.print-root')).toBeNull();
});
