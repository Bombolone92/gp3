// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { memoryStorage } from './helpers/memory-storage.js';

let view, doc;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('plausible', vi.fn());
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
});
afterEach(() => {
  view?.destroy(); doc?.destroy(); view = doc = null;
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  document.body.replaceChildren();
});

async function mount() {
  doc = new Doc({ name: 'Private report', path: 'Spreadsheets/Private.xlsx' });
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'Imported data');
  doc.wb.markClean();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, templateDoc() {}, importFile() {} });
  document.body.replaceChildren(view.el);
  await vi.advanceTimersByTimeAsync(1);
  return { wb: doc.wb, id: doc.wb.activeSheetId, viewport: view.el.querySelector('.grid-viewport') };
}

it('counts first data edits once per editor session, excluding opening and layout changes', async () => {
  const { wb, id } = await mount();
  wb.setColWidth(id, 0, 150);
  expect(plausible).not.toHaveBeenCalled();
  wb.setInput(id, 0, 0, 'Private edit');
  wb.setInput(id, 1, 0, 'Another private edit');
  expect(plausible.mock.calls).toEqual([['Spreadsheet Edited']]);
});

it('does not count typing that is cancelled or committing an unchanged value', async () => {
  const { viewport } = await mount();
  const key = name => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  viewport.focus(); key('x'); key('Escape');
  viewport.focus(); key('F2'); key('Enter');
  expect(plausible).not.toHaveBeenCalled();
  viewport.focus(); key('x'); key('Enter');
  expect(plausible.mock.calls).toEqual([['Spreadsheet Edited']]);
});
