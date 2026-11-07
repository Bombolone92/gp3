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
});

function setup({ recoverable = null, mayBeOlder = false } = {}) {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  doc.recoverable = recoverable;
  doc.recoverableMayBeOlder = mayBeOlder;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  return { doc };
}

it('says when the file was saved again after the recovered edits were made', async () => {
  const recoverable = { savedAt: Date.now() - 60000, revision: 1, book: new Doc({ name: 'x' }).wb.toJSON() };
  setup({ recoverable, mayBeOlder: true });
  await vi.advanceTimersByTimeAsync(2000);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain('the file has been saved since');
});

it('keeps the plain wording when the recovered edits are the newest', async () => {
  const recoverable = { savedAt: Date.now() - 60000, revision: 1, book: new Doc({ name: 'x' }).wb.toJSON() };
  setup({ recoverable, mayBeOlder: false });
  await vi.advanceTimersByTimeAsync(2000);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog.textContent).toContain('Restore them?');
  expect(dialog.textContent).not.toContain('saved since');
});
