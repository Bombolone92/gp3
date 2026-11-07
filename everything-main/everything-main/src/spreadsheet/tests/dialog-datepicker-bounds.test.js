// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDatePicker, partsToSerial } from '../src/ui/datepicker.js';
import { Workbook } from '../src/core/workbook.js';
import { formatDate, ymdToSerial } from '../src/core/format.js';
import { closeMenu } from '../src/ui/menu.js';

// The formatter shows ##### before the calendar's day zero and after 9999;
// the picker used to walk into those months and write such serials.
const FIRST = 0;
const LAST = ymdToSerial(9999, 12, 31);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-14T12:00:00Z')); });
afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

function open(serial) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: serial, s: { fmt: 'date' } } }]);
  wb.clearHistory();
  openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, 0, 0);
  vi.runAllTimers();
  const title = () => document.querySelector('.dp-title').textContent;
  const focused = () => Number(document.activeElement.dataset.serial);
  const day = (label) => document.querySelector(`[aria-label="${label}"]`);
  const key = (key, init = {}) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  return { wb, id, title, focused, day, key };
}

it('stays on the first displayable month and day', () => {
  expect(formatDate(FIRST - 1)).toBe('#####');
  const { wb, id, title, focused, day, key } = open(FIRST);
  expect(title()).toBe('January 1900');
  expect(focused()).toBe(FIRST);
  document.querySelector('[aria-label="Previous month"]').click();
  expect(title()).toBe('January 1900');
  key('PageUp');
  expect(title()).toBe('January 1900');
  key('PageUp', { shiftKey: true });
  expect(title()).toBe('January 1900');
  key('ArrowLeft');
  key('ArrowUp');
  key('Home');
  expect(focused()).toBe(FIRST);
  expect(day('30 December 1899').disabled).toBe(true);
  expect(day('0 January 1900').disabled).toBe(false);
  day('30 December 1899').click();
  expect(wb.getValue(id, 0, 0)).toBe(FIRST);
  expect(wb.canUndo()).toBe(false);
  day('1 January 1900').click();
  expect(wb.getValue(id, 0, 0)).toBe(FIRST + 1);
});

it('stays on the last displayable month and day', () => {
  expect(formatDate(LAST)).toBe('9999-12-31');
  expect(formatDate(LAST + 1)).toBe('#####');
  const { wb, id, title, focused, day, key } = open(LAST);
  expect(title()).toBe('December 9999');
  document.querySelector('[aria-label="Next month"]').click();
  expect(title()).toBe('December 9999');
  key('PageDown');
  key('PageDown', { shiftKey: true });
  expect(title()).toBe('December 9999');
  key('ArrowRight');
  key('ArrowDown');
  key('End');
  expect(focused()).toBe(LAST);
  expect(day('1 January 10000').disabled).toBe(true);
  day('1 January 10000').click();
  expect(wb.getValue(id, 0, 0)).toBe(LAST);
  expect(wb.canUndo()).toBe(false);
  day('30 December 9999').click();
  expect(wb.getValue(id, 0, 0)).toBe(LAST - 1);
  expect(wb.getDisplay(id, 0, 0)).toBe('9999-12-30');
});

it('clamps a move that would cross the edge to the edge day', () => {
  const { title, focused, key } = open(partsToSerial(9999, 11, 30));
  key('PageDown');
  expect(title()).toBe('December 9999');
  expect(focused()).toBe(partsToSerial(9999, 12, 30));
  key('ArrowDown');
  expect(focused()).toBe(LAST);
  expect(title()).toBe('December 9999');
});

it('opens a cell holding an undisplayable serial on the nearest displayable day', () => {
  const { title, focused } = open(-59);
  expect(title()).toBe('January 1900');
  expect(focused()).toBe(FIRST);
  closeMenu();
  const far = open(LAST + 40);
  expect(far.title()).toBe('December 9999');
  expect(far.focused()).toBe(LAST);
});


it('moves from January zero into the requested month rather than its previous month end', () => {
  const { title, focused, key } = open(FIRST);
  key('PageDown');
  expect(title()).toBe('February 1900');
  expect(focused()).toBe(32);
  key('PageUp');
  expect(title()).toBe('January 1900');
  expect(focused()).toBe(1);
});
