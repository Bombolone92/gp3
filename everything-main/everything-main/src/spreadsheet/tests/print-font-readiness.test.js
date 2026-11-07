// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { printSheet } from '../src/ui/print.js';

let loaded, finish, fail, fonts;
beforeEach(() => {
  vi.useFakeTimers();
  loaded = false;
  const pending = new Promise((resolve, reject) => { finish = () => { loaded = true; resolve([]); }; fail = reject; });
  fonts = { check: vi.fn(font => !font.includes('Open Sans') || loaded), load: vi.fn(() => pending) };
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  vi.spyOn(window, 'print').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    font: '', measureText(text) { return { width: [...text].length * (this.font.includes('Open Sans') && loaded ? 10 : 5) }; },
  }));
  // jsdom does not inherit font longhands; reproduce the browser's inheritance.
  const computed = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
    const css = computed(node);
    let family = css.fontFamily, size = css.fontSize, weight = css.fontWeight, style = css.fontStyle;
    for (let p = node.parentElement; p && (!family || !size); p = p.parentElement) {
      const inherited = computed(p);
      family ||= inherited.fontFamily; size ||= inherited.fontSize;
      weight ||= inherited.fontWeight; style ||= inherited.fontStyle;
    }
    return new Proxy(css, { get(target, key) {
      return ({ fontFamily: family, fontSize: size, fontWeight: weight, fontStyle: style })[key] || target[key];
    } });
  });
});
afterEach(() => {
  document.body.replaceChildren(); document.body.className = '';
  delete document.fonts;
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers();
});
function book() {
  return new Workbook({ sheets: [
    { name: 'Active', cells: { '0,0': { v: 'Ready', s: { font: 'arial' } } } },
    { name: 'Unvisited', defaultColWidth: 100, rowHeightModes: { 2: 'auto' }, cells: {
      '0,0': { v: 12, s: { font: 'Open Sans', size: 13, fmt: 'custom', code: '_W0*-' } },
      '1,0': { v: 'Bold Ω', s: { font: 'Open Sans', size: 13, bold: true } },
      '2,0': { v: 'one two three four five six seven eight nine', s: { font: 'Open Sans', size: 13, wrap: true } },
    } },
    { name: 'Hidden', hidden: true, cells: { '0,0': { v: 'Excluded', s: { font: 'Caladea' } } } },
  ] });
}
const filled = () => document.querySelector('.print-root .number-format-layout');
it('waits for inactive-sheet fonts and rebuilds canvas-based padding and fill before printing', async () => {
  const wb = book();
  const result = printSheet(wb, wb.activeSheetId, 'Book', { area: 'workbook', fit: 'actual', title: false });
  expect(window.print).not.toHaveBeenCalled();
  expect(filled().querySelector('[aria-hidden]').style.inlineSize).toBe('5px');
  const before = filled().textContent;
  const oldHeight = wb.rowHeight(wb.sheets[1].id, 2);
  expect(fonts.load).toHaveBeenCalled();
  expect(fonts.load.mock.calls.every(([font]) => font.includes('Open Sans'))).toBe(true);
  expect(fonts.load.mock.calls.some(([font, text]) => font.includes('600') && text.includes('Ω'))).toBe(true);
  finish();
  expect(await result).toBe(true);
  expect(window.print).toHaveBeenCalledOnce();
  expect(filled().querySelector('[aria-hidden]').style.inlineSize).toBe('10px');
  expect(filled().textContent.length).toBeLessThan(before.length);
  expect(wb.rowHeight(wb.sheets[1].id, 2)).toBeGreaterThan(oldHeight);
  expect(document.querySelector('.print-measuring')).toBeNull();
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.print-root')).toBeNull();
  expect(document.body.classList.contains('printing')).toBe(false);
});
it('does not load fonts from sheets outside the print area', async () => {
  const wb = book();
  expect(await printSheet(wb, wb.activeSheetId, 'Active', { title: false })).toBe(true);
  expect(fonts.load).not.toHaveBeenCalled();
});
it('cancels while a font is pending without a delayed print dialog', async () => {
  const wb = book(), controller = new AbortController();
  const result = printSheet(wb, wb.activeSheetId, 'Book', { area: 'workbook', signal: controller.signal });
  controller.abort();
  expect(await result).toBe(false);
  expect(document.querySelector('.print-root')).toBeNull();
  finish(); await Promise.resolve();
  expect(window.print).not.toHaveBeenCalled();
});
it('prints with measured fallback fonts when a download fails', async () => {
  const wb = book();
  const result = printSheet(wb, wb.activeSheetId, 'Book', { area: 'workbook' });
  fail(new Error('Offline'));
  expect(await result).toBe(true);
  expect(window.print).toHaveBeenCalledOnce();
  expect(filled().querySelector('[aria-hidden]').style.inlineSize).toBe('5px');
  expect(document.querySelector('.print-measuring')).toBeNull();
});
it('does not open a superseded print request after its fonts arrive', async () => {
  const wb = book();
  const first = printSheet(wb, wb.activeSheetId, 'Book', { area: 'workbook' });
  const second = printSheet(wb, wb.activeSheetId, 'Active');
  expect(await second).toBe(true);
  finish();
  expect(await first).toBe(false);
  expect(window.print).toHaveBeenCalledOnce();
  expect(document.querySelector('.print-title').textContent).toBe('Active');
});

it('does not let an older cleanup timer hide a later print document', async () => {
  const wb = book();
  await printSheet(wb, wb.activeSheetId, 'First');
  vi.advanceTimersByTime(30000);
  await printSheet(wb, wb.activeSheetId, 'Second');
  vi.advanceTimersByTime(30000);
  expect(document.body.classList.contains('printing')).toBe(true);
  expect(document.querySelector('.print-title').textContent).toBe('Second');
  window.dispatchEvent(new Event('afterprint'));
  expect(document.body.classList.contains('printing')).toBe(false);
  expect(document.querySelector('.print-root')).toBeNull();
});

it('waits for a Normal font used only by indentation, then rebuilds its measured offset', async () => {
  const wb = new Workbook({ normalFont: { name: 'Open Sans Control', sz: 12 }, sheets: [{ cells: {
    '0,0': { v: 'Arial content', s: { font: 'arial', indent: 1, wrap: true } },
  } }] });
  const result = printSheet(wb, wb.activeSheetId, 'Indent', { fit: 'actual', title: false });
  expect(window.print).not.toHaveBeenCalled();
  expect(document.querySelector('.print-cell').style.paddingLeft).toBe('18px');
  expect(fonts.load).toHaveBeenCalledWith(expect.stringContaining('Open Sans Control'), ' ');
  finish();
  expect(await result).toBe(true);
  expect(document.querySelector('.print-cell').style.paddingLeft).toBe('34px');
  window.dispatchEvent(new Event('afterprint'));
});
