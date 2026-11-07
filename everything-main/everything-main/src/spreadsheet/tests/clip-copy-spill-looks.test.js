// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { parseHtmlClipboard } from '../src/core/clipboard.js';

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key), clear: () => storage.clear(),
} });
let view;
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
});
afterEach(() => {
  view?.destroy(); view = null;
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

async function mount(prep) {
  const doc = new Doc({ name: 'Spilled copy', path: 'Spreadsheets/Spilled copy.xlsx' });
  const wb = doc.wb, id = wb.activeSheetId;
  prep(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.body.append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const copy = async (range) => {
    view.goTo(range);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    const data = {};
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type, value) => { data[type] = value; } } });
    viewport.dispatchEvent(event);
    return data['text/html'];
  };
  return { wb, id, copy };
}

it.each([false, true])('copies conditional looks of spilled numbers and booleans, including styled destinations=%s', async (styled) => {
  const { wb, id, copy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, '={0;2;"";FALSE}');
    if (styled) wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { italic: true, bg: '#ffffff' });
    wb.addRule(id, { range: { r1: 0, c1: 0, r2: 4, c2: 0 }, type: 'notEmpty', style: { bg: '#123456', color: '#abcdef', bold: true } });
  });
  expect(wb.getValue(id, 1, 0)).toBe(2);
  expect(wb.getValue(id, 3, 0)).toBe(false);
  const html = await copy('A1:A5');
  const tds = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('td')];
  for (const i of [0, 1, 3]) {
    expect(tds[i].style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(tds[i].style.color).toBe('rgb(171, 205, 239)');
    expect(tds[i].style.fontWeight).toBe('bold');
  }
  for (const i of [2, 4]) expect(tds[i].style.backgroundColor).toBe('');
  expect(tds[1].style.fontStyle).toBe(styled ? 'italic' : '');
  // HTML carries the appearance for other apps; the embedded copy keeps the editable source styles.
  const cells = parseHtmlClipboard(html).cells;
  expect(cells[0][0].f).toBe('{0;2;"";FALSE}');
  expect(cells[1][0]?.s?.bg).toBe(styled ? '#ffffff' : undefined);
  expect(cells[1][0]?.s?.bold).toBeUndefined();
  expect(wb.canUndo()).toBe(false);
});

it('carries the conditional look when copying only an array result', async () => {
  const { copy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, '=SEQUENCE(2)');
    wb.addRule(id, { range: { r1: 1, c1: 0, r2: 1, c2: 0 }, type: 'notEmpty', style: { bg: '#123456' } });
  });
  const html = await copy('A2');
  const td = new DOMParser().parseFromString(html, 'text/html').querySelector('td');
  expect(td.textContent).toBe('2');
  expect(td.style.backgroundColor).toBe('rgb(18, 52, 86)');
  expect(parseHtmlClipboard(html).cells[0][0]).toMatchObject({ v: 2, f: null });
});

it.each([false, true])('carries displayed spill number formats to other apps with destination line defaults=%s', async (lineDefaults) => {
  const { copy } = await mount((wb, id) => {
    wb.setCells(id, [{ r: 0, c: 0, cell: { f: 'SEQUENCE(3)', s: { fmt: 'currency', cur: 'EUR', dec: 2 } } }]);
    if (lineDefaults) wb.sheet(id).colStyles.set(0, { fmt: 'percent', dec: 0, bold: true });
    wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { fmt: 'percent', dec: 1 });
  });
  const html = await copy('A1:A3');
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table');
  expect([...table.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['€1.00', '€2.00', '300.0%']);
  // Other apps consume the actual HTML and typed attributes, not this app's embedded source cells.
  for (const attr of [...table.attributes]) if (attr.name.startsWith('data-spreadsheet-')) table.removeAttribute(attr.name);
  const rows = parseHtmlClipboard(table.outerHTML).rows;
  expect(rows[1][0]).toMatchObject({ value: 2, style: { fmt: 'currency', cur: 'EUR', dec: 2 } });
  expect(rows[2][0]).toMatchObject({ value: 3, style: { fmt: 'percent', dec: 1 } });
  expect(rows[1][0].style.bold).toBe(lineDefaults ? true : undefined);
  // Keeping the anchor in a copy still carries its formula and leaves its results unmaterialized.
  const internal = parseHtmlClipboard(html).cells;
  expect(internal[0][0].f).toBe('SEQUENCE(3)');
  expect(internal[1][0]?.v ?? null).toBeNull();
  if (!lineDefaults) expect(internal[1][0]).toBeNull();
});
