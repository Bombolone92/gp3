// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The editor screen had a header but no main landmark, and its sheet tabs
// controlled no tab panel, so assistive technology had neither a place to
// jump to nor a panel to associate the tabs with. The home screen has both.
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

it('has one main landmark holding the grid, which is the tab panel the sheet tabs control', async () => {
  const doc = new Doc({ name: 'Landmarks', path: 'Spreadsheets/Landmarks.xlsx' });
  const wb = doc.wb;
  const first = wb.activeSheetId;
  const second = wb.addSheet('Two').id;
  wb.setActiveSheet(first);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);

  expect(view.el.querySelectorAll('header')).toHaveLength(1);
  const mains = view.el.querySelectorAll('main, [role="main"]');
  expect(mains).toHaveLength(1);
  const main = mains[0];
  expect(main.classList.contains('editor-grid')).toBe(true);
  // Ribbon tabs own separate panels; worksheet relationships are scoped to the grid landmark.
  const panel = main.querySelector('[role="tabpanel"]');
  expect(panel).toBeTruthy();
  expect(panel.id).toBeTruthy();
  expect(main.contains(panel)).toBe(true);
  expect(panel.contains(view.el.querySelector('[role="grid"]'))).toBe(true);

  const tabs = [...view.el.querySelectorAll('.sheet-tabs [role="tab"]')];
  expect(tabs).toHaveLength(2);
  for (const tab of tabs) {
    expect(tab.id).toBeTruthy();
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
  }
  const selected = () => view.el.querySelector('.sheet-tabs [role="tab"][aria-selected="true"]');
  expect(panel.getAttribute('aria-labelledby')).toBe(selected().id);
  expect(selected().textContent).toBe('Sheet1');

  wb.setActiveSheet(second);
  await vi.advanceTimersByTimeAsync(1);
  expect(selected().textContent).toBe('Two');
  expect(panel.getAttribute('aria-labelledby')).toBe(selected().id);
  expect(document.getElementById(panel.getAttribute('aria-labelledby'))).toBe(selected());
});
