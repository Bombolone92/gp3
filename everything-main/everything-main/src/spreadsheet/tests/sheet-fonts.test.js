// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { installSheetFontLoading } from '../src/ui/sheet-fonts.js';

let stop, fonts;
beforeEach(() => {
  vi.useFakeTimers();
  fonts = { check: vi.fn(() => false), load: vi.fn(() => Promise.resolve([])) };
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
});
afterEach(() => {
  stop?.(); stop = null;
  delete document.fonts;
  vi.restoreAllMocks(); vi.useRealTimers();
});
const start = wb => { stop = installSheetFontLoading(wb, () => wb.activeSheetId); };

it('requests offscreen inherited faces without evaluating formulas or changing the workbook', async () => {
  const wb = new Workbook({ normalFont: { name: 'Arial', sz: 10 }, sheets: [{
    colStyles: { 2: { font: 'Open Sans' } }, rowStyles: { 30000: { italic: true } },
    cells: { '0,0': { v: 'Visible', s: { font: 'arial' } }, '30000,2': { f: 'RAND()', s: { bold: true } } },
  }, { name: 'Unvisited', cells: { '0,0': { v: 'Other', s: { font: 'Caladea' } } } },
  { name: 'Hidden', hidden: true, cells: { '0,0': { v: 'Hidden', s: { font: 'Carlito' } } } }] });
  const before = wb.toJSON();
  const value = vi.spyOn(wb, 'getValue');
  start(wb);
  expect(fonts.load).not.toHaveBeenCalled();
  await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.some(([font]) => font.includes('italic 600') && font.includes('Open Sans'))).toBe(true);
  expect(fonts.load.mock.calls.some(([font]) => /Caladea|Carlito/.test(font))).toBe(false);
  expect(value).not.toHaveBeenCalled();
  expect(wb.toJSON()).toEqual(before);
});

it('uses bounded batches and reads only the changed box after a small edit', async () => {
  const wb = new Workbook({ sheets: [{ cells: Object.fromEntries(Array.from({ length: 4096 }, (_, r) =>
    [`${r},0`, { v: 'Same', s: { font: 'Open Sans' } }])) }] });
  const read = vi.spyOn(wb, 'styleAt');
  start(wb);
  vi.advanceTimersToNextTimer();
  expect(read.mock.calls.length).toBeGreaterThan(0);
  expect(read.mock.calls.length).toBeLessThanOrEqual(256);
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(4096);
  expect(fonts.load).toHaveBeenCalledTimes(1);
  read.mockClear();
  wb.setInput(wb.activeSheetId, 2000, 0, 'Ω');
  read.mockClear();
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(1);
  expect(fonts.load).toHaveBeenLastCalledWith(expect.stringContaining('Open Sans'), 'Ω');
});

it('cancels obsolete sheet scans, follows sheet switches and stops when uninstalled', async () => {
  const wb = new Workbook({ sheets: [
    { name: 'First', cells: { '500,0': { v: 'A', s: { font: 'Open Sans' } } } },
    { name: 'Second', cells: { '700,0': { v: 'B', s: { font: 'Caladea', italic: true } } } },
  ] });
  start(wb);
  wb.setActiveSheet(wb.sheets[1].id);
  await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.every(([font]) => font.includes('Caladea'))).toBe(true);
  fonts.load.mockClear();
  wb.setActiveSheet(wb.sheets[0].id);
  stop(); stop = null;
  await vi.runAllTimersAsync();
  expect(fonts.load).not.toHaveBeenCalled();
});

it('prepares possible conditional bold faces without evaluating their condition', async () => {
  const wb = new Workbook({ sheets: [{ cells: {
    '40,0': { v: 'Conditional', s: { font: 'Open Sans', italic: true } },
    '60,0': { v: 'Plain', s: { font: 'Caladea' } },
  }, rules: [{ type: 'formula', formula: 'RAND()>0.5', range: { r1: 40, c1: 0, r2: 40, c2: 0 }, style: { bold: true } }] }] });
  const conditional = vi.spyOn(wb, 'conditionalStyle');
  start(wb); await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.some(([font]) => font.includes('italic 600') && font.includes('Open Sans'))).toBe(true);
  expect(fonts.load.mock.calls.some(([font]) => font.includes('600') && font.includes('Caladea'))).toBe(false);
  expect(conditional).not.toHaveBeenCalled();
});

it('loads newly assigned styles and retries failed downloads when connectivity returns', async () => {
  fonts.load.mockRejectedValue(new Error('Offline'));
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Text', s: { font: 'Open Sans' } } } }] });
  start(wb); await vi.runAllTimersAsync();
  const before = fonts.load.mock.calls.length;
  window.dispatchEvent(new Event('online'));
  await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.length).toBeGreaterThan(before);
  wb.applyStyle(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 0 }, { font: 'Caladea', bold: true });
  await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.some(([font]) => font.includes('600') && font.includes('Caladea'))).toBe(true);
});

it('does not redownload ready faces or scan cells for view-only changes', async () => {
  fonts.check.mockReturnValue(true);
  const wb = new Workbook({ sheets: [{ cells: { '0,0': { v: 'Ready', s: { font: 'Open Sans' } } } }] });
  start(wb); await vi.runAllTimersAsync();
  expect(fonts.load).not.toHaveBeenCalled();
  const read = vi.spyOn(wb, 'styleAt');
  wb._changed('view', wb.activeSheetId);
  await vi.runAllTimersAsync();
  expect(read).not.toHaveBeenCalled();
});

it('prepares chart and text-box faces with their renderer weights', async () => {
  const wb = new Workbook({ sheets: [{ charts: [
    { type: 'text', anchor: { r: 500, c: 0 }, text: 'Note', style: { font: 'Open Sans', bold: true, italic: true } },
    { type: 'column', anchor: { r: 600, c: 0 }, range: { r1: 0, c1: 0, r2: 2, c2: 1 },
      appearance: { titleStyle: { font: 'Caladea', bold: true }, legendStyle: { font: 'Carlito', italic: true } } },
  ] }] });
  start(wb); await vi.runAllTimersAsync();
  const used = fonts.load.mock.calls.map(([font]) => font);
  expect(used.some(font => font.includes('italic 600') && font.includes('Open Sans'))).toBe(true);
  expect(used.some(font => font.includes('normal 700') && font.includes('Caladea'))).toBe(true);
  expect(used.some(font => font.includes('italic 400') && font.includes('Carlito'))).toBe(true);
});

it('uses table bold only where the table actually applies it', async () => {
  const wb = new Workbook({ sheets: [{ cells: {
    '0,0': { v: 'Header', s: { font: 'Open Sans' } },
    '1,0': { v: 'Body', s: { font: 'Carlito' } },
    '20,0': { v: 'Outside', s: { font: 'Caladea' } },
  }, tables: [{ name: 'Data', range: { r1: 0, c1: 0, r2: 2, c2: 0 }, style: 'blue', headerRow: true, columns: ['Header'] }] }] });
  start(wb); await vi.runAllTimersAsync();
  const bold = fonts.load.mock.calls.filter(([font]) => font.includes('600')).map(([font]) => font);
  expect(bold.some(font => font.includes('Open Sans'))).toBe(true);
  expect(bold.some(font => /Carlito|Caladea/.test(font))).toBe(false);
});

it('follows workbook replacement and undo without leaking old preparation', async () => {
  const wb = new Workbook();
  start(wb);
  wb.replaceWith({ sheets: [{ cells: { '0,0': { v: 'New', s: { font: 'Open Sans' } } } }] });
  await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.some(([font]) => font.includes('Open Sans'))).toBe(true);
  wb.applyStyle(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 0 }, { font: 'Carlito' });
  wb.undo();
  fonts.load.mockClear();
  await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.some(([font]) => font.includes('Carlito'))).toBe(false);
});

it('prepares filtered table stripe faces without enumerating the table rows', async () => {
  const wb = new Workbook({ sheets: [{ rows: 100001, hiddenRows: [1], cells: {
    '50000,0': { v: 'Striped', s: { font: 'Open Sans' } },
    '50000,1': { v: 'Explicit regular', s: { font: 'Caladea', bold: false } },
  }, tables: [{ name: 'Large', range: { r1: 0, c1: 0, r2: 100000, c2: 1 }, style: 'blue', banded: true,
    customStyle: { firstRowStripe: { bold: true }, secondRowStripe: { bold: false } }, columns: ['A','B'] }] }] });
  vi.spyOn(wb, '_visibleOrdinal').mockImplementation(() => { throw new Error('A resource scan must not build row layout caches'); });
  start(wb); await vi.runAllTimersAsync();
  expect(fonts.load.mock.calls.some(([font]) => font.includes('600') && font.includes('Open Sans'))).toBe(true);
  expect(fonts.load.mock.calls.some(([font]) => font.includes('600') && font.includes('Caladea'))).toBe(false);
});
