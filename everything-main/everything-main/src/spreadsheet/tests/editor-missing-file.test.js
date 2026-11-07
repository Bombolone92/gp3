// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

// A save that finds the file gone from its address is reported as a conflict of
// kind "missing". The "changed elsewhere" dialog offered to reload theirs, which
// for a deleted file meant marking the edits clean and landing on the home
// screen with nothing: data loss. A missing file gets its own choices instead.
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
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount() {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  const openPath = vi.fn();
  view = editorView({ doc, goHome: vi.fn(), openPath, newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  doc.wb.setInput(doc.wb.activeSheetId, 0, 0, 'precious');
  await vi.advanceTimersByTimeAsync(1);
  return { doc, openPath };
}
const dialog = (title) => document.querySelector(`.modal-root:not(.closing) .modal-panel[aria-label="${title}"]`);
const button = (panel, label) => [...panel.querySelectorAll('button')].find((b) => b.textContent === label);
async function conflict(doc, detail) {
  doc.dispatchEvent(new CustomEvent('conflict', { detail }));
  await vi.advanceTimersByTimeAsync(1);
}

it('offers to save as a new file, put the file back, or keep editing, never to reload a file that is gone', async () => {
  const { doc, openPath } = await mount();
  const forceSave = vi.spyOn(doc, 'forceSave').mockResolvedValue(true);
  const saveAs = vi.spyOn(doc, 'saveAs').mockResolvedValue(null);
  const markClean = vi.spyOn(doc.wb, 'markClean');
  await conflict(doc, { kind: 'missing' });
  const panel = dialog('This file was moved or deleted');
  expect(panel).toBeTruthy();
  expect(dialog('This file changed elsewhere')).toBeNull();
  expect([...panel.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['Save as new file', 'Keep it here', 'Keep editing']));
  expect(button(panel, 'Reload theirs')).toBeUndefined();

  // Keep editing: nothing happens to the edits or the file.
  button(panel, 'Keep editing').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(dialog('This file was moved or deleted')).toBeNull();
  expect(forceSave).not.toHaveBeenCalled();
  expect(markClean).not.toHaveBeenCalled();
  expect(openPath).not.toHaveBeenCalled();
  expect(doc.wb.getValue(doc.wb.activeSheetId, 0, 0)).toBe('precious');

  // Keep it here: the file is written again at its old address.
  await conflict(doc, { kind: 'missing' });
  button(dialog('This file was moved or deleted'), 'Keep it here').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(forceSave).toHaveBeenCalledOnce();

  // Save as new file: the Save-a-copy flow, under a name of the user's choosing.
  await conflict(doc, { kind: 'missing' });
  button(dialog('This file was moved or deleted'), 'Save as new file').click();
  await vi.advanceTimersByTimeAsync(1);
  const prompt = dialog('Save a copy');
  expect(prompt).toBeTruthy();
  const input = prompt.querySelector('input');
  input.value = 'Budget restored';
  input.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.advanceTimersByTimeAsync(1);
  expect(saveAs).toHaveBeenCalledWith('Budget restored');
  expect(markClean).not.toHaveBeenCalled();
});

it('keeps the changed-elsewhere dialog for a file that changed, with or without a kind', async () => {
  const { doc } = await mount();
  await conflict(doc, { kind: 'changed', remoteModified: 5 });
  expect(dialog('This file changed elsewhere')).toBeTruthy();
  expect(button(dialog('This file changed elsewhere'), 'Reload theirs')).toBeTruthy();
  closeAllModals();
  await vi.advanceTimersByTimeAsync(1);
  await conflict(doc, { remoteModified: 5 });
  expect(dialog('This file changed elsewhere')).toBeTruthy();
});
