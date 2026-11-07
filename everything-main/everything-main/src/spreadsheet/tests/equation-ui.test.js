// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import { builtinEquation } from '../src/core/equation.js';

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
  const doc = new Doc({ name: 'Math' }); const wb = doc.wb; const id = wb.activeSheetId;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush();
  return { wb, id };
}
const tab = async name => { [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === name).click(); await flush(); };
const ribbonButton = label => [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === label) || null;

it('types an equation in the Equation editor, with structures and symbols, and puts it on the sheet built up', async () => {
  const { wb, id } = await mount();
  view.goTo('C3'); await flush();
  await tab('Insert');
  const button = ribbonButton('Equation');
  expect(button.disabled).toBe(false);
  expect(button.closest('.ribbon-split')).not.toBeNull();
  button.click(); await flush();
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog.textContent).toContain('Equation');
  const structures = [...dialog.querySelectorAll('.equation-structure')].map(b => b.getAttribute('aria-label'));
  expect(structures).toEqual(['Fraction', 'Script', 'Radical', 'Integral', 'Large Operator', 'Bracket', 'Function', 'Accent', 'Limit and Log', 'Operator', 'Matrix']);
  const input = dialog.querySelector('textarea');
  input.value = 'x='; input.setSelectionRange(2, 2); input.dispatchEvent(new Event('input'));
  // Radical ▸ Square Root, then type into its box.
  dialog.querySelector('.equation-structure[aria-label="Radical"]').click();
  dialog.querySelector('.equation-template-btn[aria-label="Square Root"]').click();
  expect(input.value).toBe('x=\\sqrt{⬚}');
  expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('⬚');
  input.setRangeText('a', input.selectionStart, input.selectionEnd, 'end');
  // A Greek letter from the symbol palette.
  dialog.querySelector('.equation-symbols-head select').value = 'Greek Letters';
  dialog.querySelector('.equation-symbols-head select').dispatchEvent(new Event('change'));
  input.setSelectionRange(input.value.length, input.value.length);
  dialog.querySelector('.equation-symbol[aria-label="Insert π"]').click();
  expect(input.value).toBe('x=\\sqrt{a}π');
  expect(dialog.querySelector('.equation-preview math msqrt')).not.toBeNull();
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await flush();

  const box = wb.sheet(id).charts.find(c => c.type === 'text');
  expect(box).toMatchObject({ equation: 'x=\\sqrt{a}π', text: 'x=√aπ', anchor: { r: 2, c: 2 }, style: { align: 'center', border: false } });
  const node = view.el.querySelector(`.chart-box[data-chart="${box.id}"]`);
  expect(node.querySelector('.equation-body math msqrt mi').textContent).toBe('a');
  expect(node.getAttribute('aria-label')).toBe('Equation: x=√aπ');

  // Edit opens the editor on the equation; saving replaces it in one undoable step.
  node.querySelector('.chart-tool[aria-label="Edit equation"]').click(); await flush();
  const edit = [...document.querySelectorAll('[role="dialog"]')].at(-1);
  expect(edit.textContent).toContain('Edit Equation');
  expect(edit.querySelector('textarea').value).toBe('x=\\sqrt{a}π');
  edit.querySelector('textarea').value = 'x^2';
  edit.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await flush();
  expect(wb.sheet(id).charts[0].equation).toBe('x^2');
  expect(view.el.querySelector('.equation-body math msup')).not.toBeNull();
  wb.undo(); await flush();
  expect(wb.sheet(id).charts[0].equation).toBe('x=\\sqrt{a}π');
});

it('inserts a built-in equation from the arrow beside Equation', async () => {
  const { wb, id } = await mount();
  await tab('Insert');
  ribbonButton('Equation options').click(); await flush();
  const items = [...document.querySelectorAll('.menu .equation-builtin')];
  expect(items.map(i => i.getAttribute('aria-label'))).toEqual(['Area of Circle', 'Binomial Theorem', 'Expansion of a Sum', 'Fourier Series', 'Pythagorean Theorem',
    'Quadratic Formula', 'Taylor Expansion', 'Trig Identity 1', 'Trig Identity 2']);
  expect(items[5].querySelector('math mfrac')).not.toBeNull();
  items.find(i => i.getAttribute('aria-label') === 'Quadratic Formula').click(); await flush();
  const box = wb.sheet(id).charts.find(c => c.type === 'text');
  expect(box.equation).toBe(builtinEquation('quadratic').source);
  expect(box.w).toBeGreaterThan(80);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('applies a theme effect scheme from Page Layout ▸ Effects to text boxes that use theme effects, and undoes it', async () => {
  const { wb, id } = await mount();
  await tab('Insert');
  ribbonButton('Text Box').click(); await flush();
  const dialog = document.querySelector('[role="dialog"]');
  dialog.querySelector('textarea').value = 'Shadowed';
  const effect = dialog.querySelector('select[aria-label="Theme effect"]');
  expect([...effect.options].map(o => o.textContent)).toEqual(['None', 'Subtle Effect', 'Moderate Effect', 'Intense Effect']);
  effect.value = '2';
  dialog.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true })); await flush();
  const box = wb.sheet(id).charts.find(c => c.type === 'text');
  expect(box.style.effectRef).toBe(2);
  const body = () => view.el.querySelector(`.chart-box[data-chart="${box.id}"] .text-body`);
  expect(body().style.filter).toContain('drop-shadow');

  await tab('Page Layout');
  const effects = ribbonButton('Effects');
  expect(effects.disabled).toBe(false);
  effects.click(); await flush();
  const tiles = [...document.querySelectorAll('.menu .effects-tile')];
  expect(tiles.map(t => t.getAttribute('aria-label'))).toEqual(['Default effects', 'Flat effects', 'Soft Shadow effects', 'Lifted effects', 'Halo effects', 'Chiselled effects']);
  expect(tiles[0].getAttribute('aria-checked')).toBe('true');
  tiles.find(t => t.getAttribute('aria-label') === 'Flat effects').click(); await flush();
  expect(wb.themeInfo).toEqual({ effects: 'Flat' });
  expect(body().style.filter).toBe('');
  effects.click(); await flush();
  expect(document.querySelector('.menu .effects-tile[aria-checked="true"]').getAttribute('aria-label')).toBe('Flat effects');
  closeMenu();
  wb.undo(); await flush();
  expect(wb.themeInfo).toBeNull();
  expect(body().style.filter).toContain('drop-shadow');
});
