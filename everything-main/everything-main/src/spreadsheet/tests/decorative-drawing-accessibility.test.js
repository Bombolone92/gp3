// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { pictureNode } from '../src/ui/picture.js';
import { buildPrintSheet } from '../src/ui/print.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
});
afterEach(() => document.body.replaceChildren());
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const src = 'data:image/png;base64,AA==';

it.each([{}, { srcRect: { l: .15 } }, { drawingShape: true,
  src: `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0L100 100"/></svg>')}` }])('gives decorative picture content an empty accessible alternative: %j', options => {
  const obj = { src, title: 'Artwork description', ...options };
  const informative = pictureNode(obj), decorative = pictureNode({ ...obj, decorative: true });
  expect(informative.getAttribute('alt') || informative.getAttribute('aria-label')).toBe('Artwork description');
  if (decorative.tagName === 'IMG') expect(decorative.alt).toBe('');
  else {
    expect(decorative.getAttribute('role')).toBe('presentation');
    expect(decorative.getAttribute('aria-hidden')).toBe('true');
    expect(decorative.hasAttribute('aria-label')).toBe(false);
  }
});
it.each(['image', 'text', 'column'])('keeps decorative %s controls accessible while updating content and print semantics', async type => {
  const wb = new Workbook(), s = wb.activeSheet;
  wb.setInput(s.id, 0, 0, '4'); wb.setInput(s.id, 1, 0, '8');
  const id = wb.addChart(s.id, { type, src, text: 'Caption', title: 'Description',
    range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 3, c: 2 } });
  const grid = createGrid({ wb, sheetId: s.id }); document.body.append(grid.el);
  await flush();
  const box = grid.el.querySelector('.chart-box'), body = box.querySelector('.chart-body');
  expect(body.hasAttribute('aria-hidden')).toBe(false);
  const originalLabel = box.getAttribute('aria-label');
  wb.updateChart(s.id, id, { decorative: true }); await flush();
  expect(body.getAttribute('aria-hidden')).toBe('true');
  expect(box.getAttribute('aria-label')).toMatch(/^Decorative /);
  expect(box.hasAttribute('aria-hidden')).toBe(false);
  expect(box.querySelector('button[aria-label^="Delete"]')).not.toBeNull();
  expect(buildPrintSheet(wb, s.id).querySelector('.print-object').getAttribute('aria-hidden')).toBe('true');
  wb.undo(); await flush();
  expect(body.hasAttribute('aria-hidden')).toBe(false);
  expect(box.getAttribute('aria-label')).toBe(originalLabel);
  expect(buildPrintSheet(wb, s.id).querySelector('.print-object').hasAttribute('aria-hidden')).toBe(false);
  grid.destroy();
});

it.each([false, true])('updates chart alternative text in the grid and print (linked source: %s)', async linked => {
  const wb = new Workbook(), s = wb.activeSheet;
  wb.setInput(s.id, 0, 0, '4'); wb.setInput(s.id, 1, 0, '8');
  const id = wb.addChart(s.id, { type: 'column', title: 'Visible title', description: 'Accessible alternative',
    range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 3, c: 2 },
    ...(linked ? { sourceRefs: [{ name: 'Series', values: "'Sheet1'!A1:A2" }] } : {}) });
  const grid = createGrid({ wb, sheetId: s.id }); document.body.append(grid.el); await flush();
  const box = grid.el.querySelector('.chart-box');
  expect(box.getAttribute('aria-label')).toBe('Accessible alternative');
  expect(box.querySelector('svg[role="img"]').getAttribute('aria-label')).toBe('Accessible alternative');
  expect(buildPrintSheet(wb, s.id).querySelector('svg[role="img"]').getAttribute('aria-label')).toBe('Accessible alternative');
  wb.updateChart(s.id, id, { description: 'Changed alternative' }); await flush();
  expect(box.getAttribute('aria-label')).toBe('Changed alternative');
  wb.undo(); await flush(); expect(box.getAttribute('aria-label')).toBe('Accessible alternative');
  wb.updateChart(s.id, id, { decorative: true }); await flush();
  expect(box.getAttribute('aria-label')).toBe('Decorative chart');
  expect(box.querySelector('.chart-body').getAttribute('aria-hidden')).toBe('true');
  grid.destroy();
});
