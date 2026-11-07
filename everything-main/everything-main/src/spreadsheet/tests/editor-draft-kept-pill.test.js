// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// Unsaved edits are copied into this browser's draft as a fallback. When the
// document reports that it could not keep that copy (doc.draftKept false, with
// a 'draft' event), the save pill must say so: nothing else warns that closing
// the tab would lose the edits.
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
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return doc;
}
const pill = () => view.el.querySelector('.save-status');

it('says when this browser could not keep a copy of the unsaved edits, and stops once it can again', async () => {
  const doc = await mount();
  doc.status = 'unsaved';
  doc.draftKept = false;
  doc.dispatchEvent(new CustomEvent('draft', { detail: { kept: false } }));
  expect(pill().textContent).toContain('Unsaved changes');
  expect(pill().textContent).toContain('This browser could not keep a copy');
  expect(pill().title).toContain('This browser could not keep a copy');
  doc.draftKept = true;
  doc.dispatchEvent(new CustomEvent('draft', { detail: { kept: true } }));
  expect(pill().textContent).toContain('Unsaved changes');
  expect(pill().textContent).not.toContain('could not keep');
});

it('leaves the pill alone once the edits are saved, and for documents that do not report on their draft', async () => {
  const doc = await mount();
  doc.status = 'saved';
  doc.draftKept = false;
  doc.dispatchEvent(new CustomEvent('draft', { detail: { kept: false } }));
  expect(pill().textContent).toBe('Saved');
  doc.status = 'unsaved';
  delete doc.draftKept;
  doc.dispatchEvent(new CustomEvent('status'));
  expect(pill().textContent).toBe('Unsaved changes');
});
