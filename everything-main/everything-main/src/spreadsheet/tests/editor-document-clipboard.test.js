// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

let views;
beforeEach(() => {
  views = [];
  const stored = new Map();
  vi.stubGlobal('localStorage', { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: k => stored.delete(k) });
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
});
afterEach(() => {
  for (const view of views) view.destroy();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});
const settle = () => vi.advanceTimersByTimeAsync(5);
async function mount() {
  const doc = new Doc({ name: 'Clipboard' }), wb = doc.wb, id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '23'); wb.setInput(id, 0, 1, '=A1*2'); wb.clearHistory(); wb.markClean();
  const view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, templateDoc() {}, importFile() {} });
  views.push(view); document.body.append(view.el); await settle(); view.goTo('Sheet1!A1:B1');
  return { view, doc, wb, id, viewport: view.el.querySelector('.grid-viewport') };
}
function clipboard(type, target, data = {}, files = []) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const getData = vi.fn(kind => data[kind] ?? ''), setData = vi.fn((kind, text) => { data[kind] = text; });
  Object.defineProperty(event, 'clipboardData', { value: { getData, setData, files } });
  target.dispatchEvent(event);
  return { event, data, getData, setData };
}

it('copies the focused grid even when the native copy event targets the body', async () => {
  const { wb, id } = await mount();
  const { event, data } = clipboard('copy', document.body);
  expect(event.defaultPrevented).toBe(true); expect(data['text/plain']).toBe('23\t46');
  expect(data['text/html']).toContain('<table'); expect(data['text/html']).toContain('46');
  expect(wb.getValue(id, 0, 0)).toBe(23); expect(wb.canUndo()).toBe(false);
});

it('moves a body-targeted cut once, rewrites references and undoes it in one step', async () => {
  const { view, wb, id } = await mount();
  const cut = clipboard('cut', document.body); expect(cut.event.defaultPrevented).toBe(true);
  view.goTo('Sheet1!D4');
  const paste = clipboard('paste', document.body, cut.data); await settle();
  expect(paste.event.defaultPrevented).toBe(true);
  expect(wb.getValue(id, 0, 0)).toBeNull(); expect(wb.getValue(id, 0, 1)).toBeNull();
  expect(wb.getValue(id, 3, 3)).toBe(23); expect(wb.getCell(id, 3, 4).f).toBe('D4*2'); expect(wb.getValue(id, 3, 4)).toBe(46);
  wb.undo(); expect(wb.getValue(id, 0, 0)).toBe(23); expect(wb.getValue(id, 0, 1)).toBe(46); expect(wb.getValue(id, 3, 3)).toBeNull(); expect(wb.canUndo()).toBe(false);
});

it.each(['body', 'viewport'])('pastes HTML values and formatting once through a %s event', async target => {
  const { view, wb, id, viewport } = await mount(); view.goTo('Sheet1!C3');
  const paste = clipboard('paste', target === 'body' ? document.body : viewport, {
    'text/plain': 'Label\t4.5',
    'text/html': '<table><tr><td style="font-weight:bold;background:#ffeecc">Label</td><td style="color:#345678">4.5</td></tr></table>',
  });
  await settle(); expect(paste.event.defaultPrevented).toBe(true);
  expect(wb.rangeValues(id, { r1: 2, c1: 2, r2: 2, c2: 3 })).toEqual([['Label', 4.5]]);
  expect(wb.styleAt(id, 2, 2)).toMatchObject({ bold: true, bg: '#ffeecc' }); expect(wb.styleAt(id, 2, 3).color).toBe('#345678');
  wb.undo(); expect(wb.getValue(id, 2, 2)).toBeNull(); expect(wb.canUndo()).toBe(false);
});

it.each(['copy', 'cut', 'paste'])('leaves %s in another focused field to the browser', async type => {
  const { wb, id } = await mount(); const input = document.createElement('input'); document.body.append(input); input.focus();
  const { event, getData, setData } = clipboard(type, document.body, { 'text/plain': 'unrelated text' });
  expect(event.defaultPrevented).toBe(false); expect(getData).not.toHaveBeenCalled(); expect(setData).not.toHaveBeenCalled();
  expect(wb.getValue(id, 0, 0)).toBe(23); expect(wb.canUndo()).toBe(false);
});

it('delivers a clipboard event only to the focused editor when two views are mounted', async () => {
  const first = await mount(), second = await mount(); second.view.goTo('Sheet1!E5');
  const paste = clipboard('paste', document.body, { 'text/plain': 'new content' }); await settle();
  expect(paste.event.defaultPrevented).toBe(true); expect(second.wb.getValue(second.id, 4, 4)).toBe('new content');
  expect(first.wb.getValue(first.id, 4, 4)).toBeNull(); expect(first.wb.canUndo()).toBe(false);
});

it('removes clipboard ownership when the editor closes, even if its DOM remains focused', async () => {
  const { view, wb, id, viewport } = await mount(); view.destroy(); views = [];
  expect(document.activeElement).toBe(viewport);
  const paste = clipboard('paste', document.body, { 'text/plain': 'late paste' }); await settle();
  expect(paste.event.defaultPrevented).toBe(false); expect(wb.getValue(id, 0, 0)).toBe(23); expect(wb.canUndo()).toBe(false);
});

it('marks a retargeted in-cell paste as pasted content without replacing the cells behind it', async () => {
  const { view, wb, id, viewport } = await mount(); view.goTo('Sheet1!E1');
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
  const editor = view.el.querySelector('.grid-editor'), formula = '=IMAGE("https://example.com/picture.png")'; editor.focus();
  const paste = clipboard('paste', document.body, { 'text/plain': formula });
  expect(paste.event.defaultPrevented).toBe(false); expect(wb.getCell(id, 0, 4)).toBeUndefined();
  editor.value = formula; editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
  expect(wb.externalAllowed).toBe(false); expect(wb.getValue(id, 0, 4)).toEqual({ error: '#BLOCKED!' });
});

it('does not mark another field’s paste as part of an unfinished grid entry', async () => {
  const { view, wb, viewport } = await mount(); view.goTo('Sheet1!E1');
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
  const input = document.createElement('input'); document.body.append(input); input.focus();
  clipboard('paste', document.body, { 'text/plain': 'other field' });
  const editor = view.el.querySelector('.grid-editor'); editor.focus(); editor.value = '=IMAGE("https://example.com/typed.png")'; editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(); expect(wb.externalAllowed).toBe(true);
});
