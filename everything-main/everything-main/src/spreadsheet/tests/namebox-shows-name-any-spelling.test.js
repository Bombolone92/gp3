// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// The name box showed a selected named range's name only when the name's reference was spelt exactly as
// the box spells one (Sheet1!$A$1:$A$3): a name defined as Sheet1!A1:A3, as the Named ranges dialog or an
// imported file may write it, showed A1:A3 after being picked from the names menu. The box now matches
// names by where they point.
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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function setup() {
  const doc = new Doc({ name: 'Names', path: 'Spreadsheets/Names.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  expect(wb.defineName('Total', 'Sheet1!A1:A3')).toBeNull(); // relative spelling
  expect(wb.defineName('Anchored', 'Sheet1!$C$1:$C$2')).toBeNull(); // as the name box writes one
  expect(wb.defineName('Here', 'Sheet1!e1', 'Sheet1')).toBeNull(); // sheet-local, lower case, one cell
  wb.addSheet('Sheet2');
  wb.setActiveSheet(id);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const nameBox = view.el.querySelector('[aria-label="Cell reference"]');
  const pick = async (label) => {
    view.el.querySelector('[aria-label="Named ranges"]').click();
    [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label).click();
    await vi.advanceTimersByTimeAsync(1);
  };
  const goTo = async (where) => { view.goTo(where); await vi.advanceTimersByTimeAsync(1); };
  return { wb, id, nameBox, pick, goTo };
}

it('shows the name of a range picked from the names menu whatever the spelling of its reference', async () => {
  const { nameBox, pick } = await setup();
  await pick('Total');
  expect(nameBox.value).toBe('Total');
  await pick('Anchored');
  expect(nameBox.value).toBe('Anchored');
  await pick('Sheet1!Here');
  expect(nameBox.value).toBe('Here');
});

it('shows the name when the same cells are selected by hand, and the address when they are not named', async () => {
  const { nameBox, goTo } = await setup();
  await goTo('Sheet1!A1:A3');
  expect(nameBox.value).toBe('Total');
  await goTo('Sheet1!E1');
  expect(nameBox.value).toBe('Here');
  await goTo('Sheet1!A1:A4');
  expect(nameBox.value).toBe('A1:A4');
  // The same cells on another sheet are not the named ones.
  await goTo('Sheet2!A1:A3');
  expect(nameBox.value).toBe('A1:A3');
});
