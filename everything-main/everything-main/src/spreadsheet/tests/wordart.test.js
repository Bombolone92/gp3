// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { normalizeTextEffects, textBoxStyle } from '../src/core/charts.js';
import { wordArtStyles } from '../src/ui/wordart.js';
import { DEFAULT_COLOR_PALETTE } from '../src/core/font-color.js';

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

it('normalizes text effects and draws them', () => {
  expect(normalizeTextEffects({ outline: '#ABCDEF', outlineWidth: 50, shadow: 'red', glow: '#000000' })).toEqual({ outline: '#abcdef', outlineWidth: 1, glow: '#000000' });
  expect(normalizeTextEffects({})).toBeNull();
  const css = textBoxStyle({ style: { size: 20, effects: { outline: '#112233', outlineWidth: 2, shadow: '#000000' } } });
  expect(css.WebkitTextStroke).toBe('2px #112233');
  expect(css.textShadow).toContain('rgba(0, 0, 0, 0.45)');
  expect(wordArtStyles(DEFAULT_COLOR_PALETTE.theme)).toHaveLength(8);
});

it('inserts WordArt from Insert ▸ Text ▸ WordArt as a styled text box', async () => {
  const doc = new Doc({ name: 'Art' }); const wb = doc.wb; const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush();
  [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === 'Insert').click(); await flush();
  const button = [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === 'WordArt');
  expect(button.disabled).toBe(false);
  button.click(); await flush();
  const tiles = [...document.querySelectorAll('.menu .wordart-tile')];
  expect(tiles).toHaveLength(8);
  tiles.find(t => t.getAttribute('aria-label') === 'Accent with outline').click(); await flush();
  const box = wb.sheet(id).charts.find(c => c.type === 'text');
  expect(box.text).toBe('Your text here');
  expect(box.style).toMatchObject({ size: 40, bold: true, border: false, color: '#4f81bd', effects: { outline: expect.any(String), outlineWidth: 1 } });
  // The text box dialog opens to type over the sample text; saving keeps the effects.
  const dialog = document.querySelector('[role="dialog"]');
  dialog.querySelector('textarea').value = 'Quarterly';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await flush();
  const saved = wb.sheet(id).charts.find(c => c.type === 'text');
  expect(saved.text).toBe('Quarterly');
  expect(saved.style.effects.outline).toBe(box.style.effects.outline);
});

