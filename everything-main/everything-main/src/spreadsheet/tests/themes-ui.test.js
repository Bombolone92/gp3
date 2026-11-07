// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { colorScheme } from '../src/core/workbook-theme.js';
import { seriesColor, SERIES_COLORS } from '../src/ui/chartsvg.js';

let view;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
  localStorage.clear(); document.body.replaceChildren();
});
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => vi.advanceTimersByTimeAsync(1);
async function mount() {
  const doc = new Doc({ name: 'Themes' }); const wb = doc.wb; const id = wb.activeSheetId;
  [['Item', 'Total'], ['Notebook', '3']].forEach((row, r) => row.forEach((value, c) => wb.setInput(id, r, c, value)));
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush(); return { wb, id };
}
const tab = name => [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === name);
const ribbonButton = label => [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === label) || null;

it('applies a gallery theme from Page Layout ▸ Themes, recolouring theme fills, and undoes it', async () => {
  const { wb, id } = await mount();
  view.goTo('A1'); await flush();
  // Fill color ▸ Theme Colors ▸ Accent 1.
  view.el.querySelector('.ribbon-home [aria-label="Fill color"]').click(); await flush();
  const accent = document.querySelector('.menu .swatches-theme [aria-label="Accent 1"]');
  expect(document.querySelectorAll('.menu .swatches-theme .swatch')).toHaveLength(60);
  accent.click(); await flush();
  expect(wb.styleAt(id, 0, 0).bg).toMatchObject({ theme: 4, rgb: '#4f81bd' });
  expect(view.el.querySelector('.ribbon-home [aria-label^="Apply fill color"]').getAttribute('aria-label')).toBe('Apply fill color accent 1');

  tab('Page Layout').click(); await flush();
  const themes = ribbonButton('Themes');
  expect(themes.disabled).toBe(false);
  themes.click(); await flush();
  const tiles = [...document.querySelectorAll('.menu .theme-tile')];
  expect(tiles.length).toBeGreaterThan(8);
  expect(tiles.find(t => t.getAttribute('aria-checked') === 'true').getAttribute('aria-label')).toBe('Default theme');
  tiles.find(t => t.getAttribute('aria-label') === 'Lagoon theme').click(); await flush();
  expect(wb.styleAt(id, 0, 0).bg).toMatchObject({ theme: 4, rgb: colorScheme('Lagoon').colors[4] });
  expect(wb.themeInfo).toMatchObject({ name: 'Lagoon', colors: 'Lagoon' });
  expect(wb.fontTheme.name).toBe('Studio');
  expect(seriesColor({}, 0)).toBe(colorScheme('Lagoon').colors[4]);
  // The palette follows the theme.
  view.el.querySelector('.ribbon-home [aria-label="Fill color"]').click(); await flush();
  expect(document.querySelector('.menu .swatches-theme [aria-label="Accent 1"]').getAttribute('aria-checked')).toBe('true');
  expect(document.querySelector('.menu .swatches-theme [aria-label="Accent 1"]').style.background).toContain('20, 151, 166');
  closeMenu();
  wb.undo(); await flush();
  expect(wb.styleAt(id, 0, 0).bg.rgb).toBe('#4f81bd');
  expect(seriesColor({}, 0)).toBe(SERIES_COLORS[0]);
});

it('changes only the colours from Colors, and only the fonts from Fonts', async () => {
  const { wb } = await mount();
  tab('Page Layout').click(); await flush();
  ribbonButton('Theme Colors').click(); await flush();
  const rows = [...document.querySelectorAll('.menu .theme-scheme-item')];
  rows.find(r => r.textContent === 'Ember').click(); await flush();
  expect(wb.colorPalette.theme[4]).toBe(colorScheme('Ember').colors[4]);
  expect(wb.fontTheme).toBeNull();
  ribbonButton('Theme Fonts').click(); await flush();
  [...document.querySelectorAll('.menu .theme-font-item')].find(r => r.getAttribute('aria-label').startsWith('Ledger:')).click(); await flush();
  expect(wb.fontTheme.minor.latin.typeface).toBe('Verdana');
  expect(wb.normalFont).toMatchObject({ name: 'Verdana', scheme: 'minor' });
  expect(wb.themeInfo).toMatchObject({ colors: 'Ember' });
  expect(wb.fontTheme.name).toBe('Ledger');
});

it('saves custom theme colours from Customize Colors…', async () => {
  const { wb } = await mount();
  tab('Page Layout').click(); await flush();
  ribbonButton('Theme Colors').click(); await flush();
  [...document.querySelectorAll('.menu .menu-item')].find(n => n.textContent.includes('Customize Colors')).click(); await flush();
  const dialog = document.querySelector('[role="dialog"][aria-label="Create New Theme Colors"]');
  const accent = dialog.querySelector('input[aria-label="Accent 1"]');
  accent.value = '#123456'; accent.dispatchEvent(new Event('input'));
  dialog.querySelector('input[aria-label="Name"]').value = 'Mine';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await flush();
  expect(wb.colorPalette.theme[4]).toBe('#123456');
  expect(wb.themeInfo.colors).toBe('Mine');
  ribbonButton('Theme Colors').click(); await flush();
  const mine = [...document.querySelectorAll('.menu .theme-scheme-item')].find(r => r.textContent === 'Mine');
  expect(mine.getAttribute('aria-checked')).toBe('true');
});

it('offers themed cell styles that follow the theme', async () => {
  const { wb, id } = await mount();
  view.goTo('B2'); await flush();
  view.el.querySelector('.tb-btn[aria-label="Cell styles"]').click(); await flush();
  const item = [...document.querySelectorAll('.menu .themed-cell-style')].find(b => b.title === '40% - Accent3');
  item.click(); await flush();
  expect(wb.styleAt(id, 1, 1).bg).toMatchObject({ theme: 6, tint: 0.6 });
});
