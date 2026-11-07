// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { CELL_STYLES } from '../src/core/cellstyles.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// The Cell styles gallery painted every sample #0b0b0b on #ffffff, the light theme's ink and surface, so in
// dark mode the menu showed white cards for styles that render light-on-dark on the sheet: the preview said
// the opposite of the result. A preset that names no ink or fill of its own now shows the sheet's tokens,
// and one that names its own keeps it, as the cell does.
const LIGHT_LITERALS = /#0b0b0b|#ffffff|rgba\(0, ?0, ?0/;
const gallery = () => menuLeaves(menubarMenus({}).find((m) => m.id === 'format').items).filter((it) => it.cmd === 'cellStyle');

describe('the Format menu gallery', () => {
  it('paints a preset without colours of its own from the theme tokens', () => {
    const items = gallery();
    expect(items).toHaveLength(CELL_STYLES.length);
    const title = items.find((it) => it.arg === 'title');
    expect(title.style.color).toBe('var(--ink)');
    expect(title.style.background).toBe('var(--surface)');
    expect(title.style.border).toBe('1px solid var(--hairline)');
    for (const it of items) {
      expect([it.style.color, it.style.background, it.style.border].join(' '), it.label).not.toMatch(LIGHT_LITERALS);
    }
  });

  it('keeps the ink and fill a preset names for itself, so the sample still shows what it does', () => {
    const items = gallery();
    const good = items.find((it) => it.arg === 'good');
    expect([good.style.color, good.style.background]).toEqual(['#0b6b3a', '#d8f3dc']);
    // Note names a fill but no ink: the ink is the sheet's, exactly as the cell will be drawn.
    const note = items.find((it) => it.arg === 'note');
    expect([note.style.color, note.style.background]).toEqual(['var(--ink)', '#fff2cc']);
  });
});

describe('the toolbar’s Cell styles menu', () => {
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

  it('shows the same samples, from the tokens', { timeout: 20000 }, async () => {
    const doc = new Doc({ name: 'Chips', path: 'Spreadsheets/Chips.xlsx' });
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('[aria-label="Cell styles"]').click();
    await vi.advanceTimersByTimeAsync(1);
    // The presets; the Themed Cell Styles section below them paints the workbook theme's own colours, as the cells it makes are.
    const samples = [...document.querySelectorAll('.cell-style-item:not(.themed-cell-style) .cell-style-sample')];
    expect(samples).toHaveLength(CELL_STYLES.length);
    expect(document.querySelectorAll('.themed-cell-style .cell-style-sample')).toHaveLength(24);
    const title = samples.find((s) => s.textContent === 'Title');
    expect(title.style.color).toBe('var(--ink)');
    expect(title.style.background).toBe('var(--surface)');
    for (const s of samples) expect(s.getAttribute('style'), s.textContent).not.toMatch(LIGHT_LITERALS);
    // A preset with its own colours keeps them.
    expect(samples.find((s) => s.textContent === 'Bad').style.background).toBe('rgb(255, 214, 214)');
  });
});
