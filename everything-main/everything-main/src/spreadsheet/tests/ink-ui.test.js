// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { isInk } from '../src/core/ink.js';
import { RIBBON_TABS } from '../src/ui/ribbon.js';

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
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => vi.advanceTimersByTimeAsync(5);
async function mount() {
  const doc = new Doc({ name: 'Ink' }); const wb = doc.wb;
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await flush();
  [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(n => n.textContent === 'Draw').click(); await flush();
  return { wb, id: wb.activeSheetId };
}
const button = label => [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === label) || null;
const penButton = id => view.el.querySelector(`.ribbon [data-ink-pen="${id}"]`);
function pointer(type, x, y, extra = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 });
  Object.assign(e, { pointerId: 1, pointerType: 'mouse', pressure: 0.5, ...extra });
  for (const [k, v] of Object.entries({ pointerId: 1, pointerType: 'mouse', pressure: 0.5, ...extra })) Object.defineProperty(e, k, { value: v });
  return e;
}
function drag(points, extra) {
  const surface = view.el.querySelector('.ink-surface');
  surface.dispatchEvent(pointer('pointerdown', ...points[0], extra));
  for (const p of points.slice(1)) surface.dispatchEvent(pointer('pointermove', ...p, extra));
  surface.dispatchEvent(pointer('pointerup', ...points.at(-1), extra));
}
const wave = (x0, y0) => Array.from({ length: 30 }, (_, i) => [x0 + i * 5, y0 + Math.sin(i / 4) * 12]);

it('puts the Draw tab after Insert', () => {
  expect(RIBBON_TABS.slice(0, 4)).toEqual(['Home', 'Insert', 'Draw', 'Page Layout']);
});

it('draws with a pen as a selectable ink object, anchored to the cell under it, with undo and redo', async () => {
  const { wb, id } = await mount();
  for (const label of ['Select', 'Lasso Select', 'Eraser', 'Add Pen', 'Draw with Touch', 'Ink to Shape']) expect(button(label), label).not.toBeNull();
  expect(penButton('pen-1').getAttribute('aria-label')).toBe('Pen: Black, 0.5 mm');
  expect(penButton('pen-2').style.getPropertyValue('--pen-color')).toBe('#e71224');
  penButton('pen-2').click(); await flush();
  expect(penButton('pen-2').getAttribute('aria-pressed')).toBe('true');
  expect(button('Select').getAttribute('aria-pressed')).toBe('false');
  drag(wave(250, 120)); await flush();
  const [ink] = wb.sheet(id).charts;
  expect(isInk(ink)).toBe(true);
  expect(ink.title).toBe('Ink 1');
  expect(ink.anchor.c).toBeGreaterThanOrEqual(1);
  expect(ink.anchor.r).toBeGreaterThanOrEqual(4);
  expect(ink.nativeDrawing.node.children[0].children[3].attrs.w).toBe(18000);
  wb.undo(); await flush();
  expect(wb.sheet(id).charts).toHaveLength(0);
  wb.redo(); await flush();
  expect(wb.sheet(id).charts).toHaveLength(1);
  // Select leaves drawing: the layer goes and the ink can be picked like any picture.
  button('Select').click(); await flush();
  expect(view.el.querySelector('.ink-surface')).toBeNull();
  expect(view.el.querySelector('.chart-box.image-box')).not.toBeNull();
});

it('opens a chosen pen\'s thickness and colours on a second press, and remembers the change', async () => {
  await mount();
  penButton('pen-1').click(); await flush();
  penButton('pen-1').click(); await flush();
  const menu = document.querySelector('.menu');
  expect(menu).not.toBeNull();
  [...menu.querySelectorAll('.ink-width')].find(b => b.getAttribute('aria-label') === '2 mm').click(); await flush();
  expect(penButton('pen-1').getAttribute('aria-label')).toBe('Pen: Black, 2 mm');
  penButton('pen-1').click(); await flush();
  [...document.querySelectorAll('.menu .swatch')].find(b => b.getAttribute('aria-label') === 'Green').click(); await flush();
  expect(penButton('pen-1').getAttribute('aria-label')).toBe('Pen: Green, 2 mm');
  expect(JSON.parse(localStorage.getItem('spreadsheet:pens'))[0]).toMatchObject({ color: '#16a34a', width: 2 });
});

it('adds a pen from Add Pen and draws with the highlighter half transparent', async () => {
  const { wb, id } = await mount();
  button('Add Pen').click(); await flush();
  [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('Highlighter')).click(); await flush();
  expect(penButton('pen-5')).not.toBeNull();
  expect(penButton('pen-5').hidden).toBe(false);
  expect(penButton('pen-5').getAttribute('aria-pressed')).toBe('true');
  drag(wave(200, 100)); await flush();
  const ln = wb.sheet(id).charts[0].nativeDrawing.node.children[0].children[3];
  expect(ln.attrs.cap).toBe('sq');
  expect(ln.children[0].children[0].children[0].attrs.val).toBe(50000);
});

it('erases whole strokes the eraser touches, as one undo step', async () => {
  const { wb, id } = await mount();
  penButton('pen-1').click(); await flush();
  drag(wave(200, 100)); drag(wave(200, 250)); await flush();
  expect(wb.sheet(id).charts).toHaveLength(2);
  button('Eraser').click(); await flush();
  const first = wb.sheet(id).charts[0];
  drag([[260, 60], [262, 140]]); await flush();
  expect(wb.sheet(id).charts.map(c => c.id)).not.toContain(first.id);
  expect(wb.sheet(id).charts).toHaveLength(1);
  drag([[700, 60], [700, 300]]); await flush();
  expect(wb.sheet(id).charts).toHaveLength(1);
  wb.undo(); await flush();
  expect(wb.sheet(id).charts).toHaveLength(2);
});

it('selects strokes with the lasso, moves them together and deletes them with Delete', async () => {
  const { wb, id } = await mount();
  penButton('pen-1').click(); await flush();
  drag(wave(200, 100)); drag(wave(200, 160)); drag(wave(200, 320)); await flush();
  button('Lasso Select').click(); await flush();
  drag([[180, 70], [400, 70], [400, 200], [180, 200], [181, 71]]); await flush();
  expect(view.el.querySelector('.ink-lasso-box')).not.toBeNull();
  const before = wb.sheet(id).charts.map(c => ({ ...c }));
  drag([[250, 120], [290, 160]]); await flush();
  const after = wb.sheet(id).charts;
  const moved = (a, b) => a.anchor.c !== b.anchor.c || a.anchor.r !== b.anchor.r || a.dx !== b.dx || a.dy !== b.dy;
  expect([0, 1, 2].map(i => moved(before[i], after[i]))).toEqual([true, true, false]);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await flush();
  expect(wb.sheet(id).charts).toHaveLength(1);
  wb.undo(); await flush();
  expect(wb.sheet(id).charts).toHaveLength(3);
  // Escape leaves the Draw tool for Select.
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await flush();
  expect(button('Select').getAttribute('aria-pressed')).toBe('true');
});

it('turns a roughly drawn rectangle into a clean shape with Ink to Shape on', async () => {
  const { wb, id } = await mount();
  button('Ink to Shape').click(); await flush();
  expect(button('Ink to Shape').getAttribute('aria-pressed')).toBe('true');
  const rect = [];
  for (const [a, b] of [[[150, 80], [400, 80]], [[400, 80], [400, 220]], [[400, 220], [150, 220]], [[150, 220], [150, 84]]]) for (let k = 0; k < 12; k++) rect.push([a[0] + (b[0] - a[0]) * k / 12 + Math.sin(k), a[1] + (b[1] - a[1]) * k / 12 + Math.cos(k)]);
  drag(rect); await flush();
  const [shape] = wb.sheet(id).charts;
  expect(shape.title).toBe('Rectangle 1');
  expect(shape.nativeDrawing.node.children[0].children[1].attrs.prst).toBe('rect');
  expect(isInk(shape)).toBe(false);
});

it('lets a finger scroll unless Draw with Touch is on, and a pen stroke follows its pressure', async () => {
  const { wb, id } = await mount();
  penButton('pen-1').click(); await flush();
  drag(wave(200, 100), { pointerType: 'touch' }); await flush();
  expect(wb.sheet(id).charts).toHaveLength(0);
  button('Draw with Touch').click(); await flush();
  drag(wave(200, 100), { pointerType: 'touch' }); await flush();
  expect(wb.sheet(id).charts).toHaveLength(1);
  const pressed = wave(200, 250).map(([x, y]) => [x, y]);
  const surface = view.el.querySelector('.ink-surface');
  surface.dispatchEvent(pointer('pointerdown', ...pressed[0], { pointerType: 'pen', pressure: 0.2 }));
  pressed.slice(1).forEach((p, i) => surface.dispatchEvent(pointer('pointermove', ...p, { pointerType: 'pen', pressure: 0.2 + i / 40 })));
  surface.dispatchEvent(pointer('pointerup', ...pressed.at(-1), { pointerType: 'pen', pressure: 0.9 }));
  await flush();
  const spPr = wb.sheet(id).charts[1].nativeDrawing.node.children[0];
  expect(spPr.children[2].name).toBe('solidFill');
});

it('refuses to ink a protected sheet', async () => {
  const { wb, id } = await mount();
  wb.setSheetProtected(id, true);
  expect(wb.isProtected(id)).toBe(true);
  penButton('pen-1').click(); await flush();
  expect(view.el.querySelector('.ink-surface')).toBeNull();
});
