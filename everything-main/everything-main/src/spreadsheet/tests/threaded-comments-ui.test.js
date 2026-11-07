// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { getThread, addComment } from '../src/core/comments.js';

// Review ▸ Comments: New Comment opens a card to start a thread, the card replies and resolves, Next Comment
// walks the threads, Show Comments lists them in a pane, and Delete removes the selected threads.
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

const tick = () => vi.advanceTimersByTimeAsync(20);
const button = (label) => view.el.querySelector(`[aria-label="${label}"]`);
async function review() {
  [...view.el.querySelectorAll('.ribbon-tab')].find((t) => t.textContent === 'Review').click();
  await tick();
}
const type = (area, text) => { area.value = text; area.dispatchEvent(new Event('input')); };

it('starts, replies to, resolves, walks, lists and deletes threads from the ribbon', async () => {
  const doc = new Doc({ name: 'Comments', path: 'Spreadsheets/Comments.xlsx' });
  const wb = doc.wb, id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await tick();
  await review();
  // With no thread on the sheet, only New Comment and Show Comments are on offer.
  expect(button('New Comment').disabled).toBe(false);
  expect(button('Next Comment').disabled).toBe(true);
  expect(button('Delete Comment').disabled).toBe(true);

  button('New Comment').click();
  await tick();
  const compose = document.querySelector('.comment-card textarea');
  expect(compose).toBeTruthy();
  type(compose, 'Is this final?');
  [...document.querySelectorAll('.comment-card button')].find((b) => b.textContent === 'Post').click();
  await tick();
  expect(getThread(wb, id, 0, 0).items.map((i) => i.text)).toEqual(['Is this final?']);
  expect(getThread(wb, id, 0, 0).items[0].author).toBeTruthy();
  expect(view.el.querySelector('#gc-0-0').classList.contains('has-comment')).toBe(true);

  const reply = document.querySelector('.comment-card .cmt-reply');
  type(reply, 'Yes');
  document.querySelector('.comment-card .cmt-post').click();
  await tick();
  expect(getThread(wb, id, 0, 0).items.map((i) => i.text)).toEqual(['Is this final?', 'Yes']);
  document.querySelector('.comment-card .cmt-resolve').click();
  await tick();
  expect(getThread(wb, id, 0, 0).done).toBe(true);
  expect(view.el.querySelector('#gc-0-0').classList.contains('comment-done')).toBe(true);
  wb.undo();
  await tick();
  expect(getThread(wb, id, 0, 0).done).toBe(false);

  addComment(wb, id, 3, 2, 'Second thread', 'Grace');
  await tick();
  expect(button('Next Comment').disabled).toBe(false);
  button('Next Comment').click();
  await tick();
  await tick();
  expect(document.querySelector('.comment-card .cmt-text')?.textContent).toBe('Second thread');

  button('Show Comments').click();
  await tick();
  const pane = view.el.querySelector('.comments-pane');
  expect(pane.hidden).toBe(false);
  expect([...pane.querySelectorAll('.cmt-cell')].map((n) => n.textContent)).toEqual(['A1', 'C4']);

  // The active cell is C4: Delete removes its thread, in one undo step.
  button('Delete Comment').click();
  await tick();
  expect(getThread(wb, id, 3, 2)).toBeNull();
  expect([...pane.querySelectorAll('.cmt-cell')].map((n) => n.textContent)).toEqual(['A1']);
  wb.undo();
  await tick();
  expect(getThread(wb, id, 3, 2)).not.toBeNull();

  button('Show Comments').click();
  await tick();
  expect(pane.hidden).toBe(true);
}, 30000);

it('opens a thread from Ctrl+Shift+F2 and from Ctrl+Alt+M', async () => {
  const doc = new Doc({ name: 'Keys', path: 'Spreadsheets/Keys.xlsx' });
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await tick();
  const vp = view.el.querySelector('[role="grid"]');
  vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', shiftKey: true, ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
  await tick();
  expect(document.querySelector('.comment-card textarea')).toBeTruthy();
  document.querySelector('.comment-card textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await tick();
  expect(document.querySelector('.comment-card')).toBeNull();
  vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'µ', code: 'KeyM', altKey: true, ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
  await tick();
  expect(document.querySelector('.comment-card textarea')).toBeTruthy();
}, 30000);
