// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { paletteCommands } from '../src/ui/palette.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

// Format > Rotation stopped at "Rotate up (90°)": the command's other end, −90, and the custom
// angle the command already asks for were reachable from nowhere; the palette lacked −90 too.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

describe('definitions', () => {
  it('list every rotation the command takes, the custom angle marked as a dialog', () => {
    const rotation = (flags) => menuLeaves(menubarMenus(flags).find((m) => m.id === 'format').items.find((it) => it.label === 'Rotation').submenu);
    expect(rotation({}).map((it) => [it.label, it.arg])).toEqual([['None', 0], ['Tilt up (45°)', 45], ['Tilt down (−45°)', -45], ['Rotate up (90°)', 90], ['Rotate down (−90°)', -90], ['Custom angle…', 'custom']]);
    const down = rotation({ style: { rot: -90 } }).find((it) => it.label === 'Rotate down (−90°)');
    expect(down).toMatchObject({ radio: true, checked: true });
    expect(rotation({}).find((it) => it.label === 'Rotate down (−90°)').checked).toBe(false);
    expect(rotation({}).find((it) => it.label === 'Custom angle…').radio).toBeUndefined();
    const palette = paletteCommands({}).filter((c) => c.cmd === 'rotate').map((c) => [c.label, c.arg]);
    expect(palette).toContainEqual(['Rotate text down (−90°)', -90]);
    expect(palette).toContainEqual(['Custom text rotation…', 'custom']);
  });
});

describe('the editor', () => {
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
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('rotates the selection down and asks for a custom angle from the Format menu', async () => {
    const doc = new Doc({ name: 'Rot', path: 'Spreadsheets/Rot.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'tilt');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    const menu = async (label) => {
      view.el.querySelector('[data-menu="format"]').click();
      item('Rotation').click();
      await vi.advanceTimersByTimeAsync(1);
      item(label).click();
      await vi.advanceTimersByTimeAsync(1);
    };
    await menu('Rotate down (−90°)');
    expect(wb.getCell(id, 0, 0).s.rot).toBe(-90);
    await menu('Custom angle…');
    const dialog = document.querySelector('.modal-panel[aria-label="Text rotation"]');
    expect(dialog).toBeTruthy();
    const input = dialog.querySelector('input');
    expect(input.value).toBe('-90'); // the current angle, ready to change
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Rotate').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getCell(id, 0, 0).s.rot).toBe(30);
  });
});
