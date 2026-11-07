// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calendarDays, serialToParts, partsToSerial, openDatePicker } from '../src/ui/datepicker.js';
import { Workbook } from '../src/core/workbook.js';
import { todaySerial, setLocale } from '../src/core/format.js';
import { closeMenu } from '../src/ui/menu.js';

describe('date picker calendar', () => {
  it('lays out six Monday-first weeks around the month', () => {
    const days = calendarDays(2026, 8); // August 2026 starts on a Saturday
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ y: 2026, m: 7, d: 27, other: true });
    expect(days[5]).toEqual({ y: 2026, m: 8, d: 1, other: false });
    expect(days[35]).toEqual({ y: 2026, m: 8, d: 31, other: false });
    expect(days[36]).toEqual({ y: 2026, m: 9, d: 1, other: true });
    // A month starting on Monday has no leading days from the month before.
    expect(calendarDays(2026, 6)[0]).toEqual({ y: 2026, m: 6, d: 1, other: false });
  });

  it('converts between serials and calendar parts', () => {
    expect(serialToParts(25569)).toEqual({ y: 1970, m: 1, d: 1 });
    expect(partsToSerial(1970, 1, 1)).toBe(25569);
    expect(serialToParts(partsToSerial(2026, 8, 28))).toEqual({ y: 2026, m: 8, d: 28 });
    expect(partsToSerial(2024, 2, 29) - partsToSerial(2024, 2, 28)).toBe(1);
  });
});

describe('date picker keyboard navigation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { closeMenu(); vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

  function setup(style = { fmt: 'datetime' }) {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: partsToSerial(2024, 1, 31) + 0.5, s: style } }]);
    wb.clearHistory();
    const focus = vi.fn();
    openDatePicker({ wb, sheetId: () => id, grid: { focus, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, 0, 0);
    vi.runAllTimers();
    return { wb, id, focus };
  }

  function key(key) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    document.activeElement.dispatchEvent(event);
    return event;
  }

  it.each(['dd/mm/yyyy', 'dd/mm/yyyy h:mm AM/PM'])('preserves imported code %s when choosing another day', (code) => {
    const { wb, id } = setup({ fmt: 'custom', code });
    key('ArrowRight');
    document.activeElement.click();
    expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 2, 1) + 0.5);
    expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'custom', code });
    expect(wb.getDisplay(id, 0, 0)).toBe(code.includes('h:') ? '01/02/2024 12:00 PM' : '01/02/2024');
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 1, 31) + 0.5);
  });

  it.each(['dismiss', 'pick'])('opens on a formula date and preserves its time when replacing it (%s)', (action) => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00Z'));
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const formula = 'DATE(2024,1,31)+TIME(12,0,0)';
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: formula, s: { fmt: 'datetime', bold: true } } }]);
    wb.clearHistory();
    openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, 0, 0);
    vi.runAllTimers();
    expect(document.querySelector('.dp-title').textContent).toBe('January 2024');
    expect(document.activeElement.getAttribute('aria-label')).toBe('31 January 2024');
    expect(document.activeElement.getAttribute('aria-pressed')).toBe('true');
    expect(wb.getCell(id, 0, 0).f).toBe(formula);
    expect(wb.canUndo()).toBe(false);
    if (action === 'dismiss') {
      key('Escape');
      expect(wb.getCell(id, 0, 0).f).toBe(formula);
      expect(wb.canUndo()).toBe(false);
    } else {
      key('ArrowRight');
      document.activeElement.click();
      expect(wb.getCell(id, 0, 0)).toEqual({ v: partsToSerial(2024, 2, 1) + 0.5, f: null, s: { fmt: 'datetime', bold: true } });
      expect(wb.undoLabels()).toEqual(['Pick date']);
      wb.undo();
      expect(wb.getCell(id, 0, 0).f).toBe(formula);
      wb.redo();
      expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 2, 1) + 0.5);
    }
  });

  it.each(['1/0', '"Not a date"'])('uses today when a formula has no usable date (%s)', (formula) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: null, f: formula, s: { fmt: 'date' } } }]);
    wb.clearHistory();
    openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, 0, 0);
    vi.runAllTimers();
    expect(document.activeElement.dataset.serial).toBe(String(todaySerial()));
    expect(wb.getCell(id, 0, 0).f).toBe(formula);
    expect(wb.canUndo()).toBe(false);
  });

  it.each(['header', 'new row', 'new column'])('updates table references and bounds when a date is picked in its %s', (target) => {
    vi.setSystemTime(new Date('2024-01-31T12:00:00Z'));
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const date = partsToSerial(2024, 1, 30);
    wb.setInput(id, 0, 0, 'Date');
    wb.setInput(id, 0, 1, 'Next');
    wb.setInput(id, 1, 0, date, { literal: true });
    const table = wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
    wb.setInput(id, 1, 1, '=[@Date]+1');
    wb.setInput(id, 0, 4, '=SUM(Table1[Date])');
    const r = target === 'header' ? 0 : target === 'new row' ? 2 : 1;
    const c = target === 'new column' ? 2 : 0;
    wb.clearHistory();
    const before = wb.toJSON();
    openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, r, c);
    vi.runAllTimers();
    document.querySelector('[aria-label="1 February 2024"]').click();
    if (target === 'header') {
      // A table header holds its name as text, so the picked date lands as the text it shows.
      expect(wb.getValue(id, r, c)).toBe('2024-02-01');
      expect(wb.getValue(id, 0, 4)).toBe(date);
      expect(wb.getValue(id, 1, 1)).toBe(date + 1);
      const name = wb.tableColumns(id, wb.tableById(id, table))[0];
      expect(wb.getCell(id, 0, 4).f).toContain(`[${name}]`);
    } else if (target === 'new row') {
      expect(wb.getValue(id, r, c)).toBe(partsToSerial(2024, 2, 1));
      expect(wb.getCell(id, r, c).s.fmt).toBe('date');
      expect(wb.tableById(id, table).range.r2).toBe(2);
      expect(wb.getValue(id, 2, 1)).toBe(partsToSerial(2024, 2, 2));
    } else {
      expect(wb.getValue(id, r, c)).toBe(partsToSerial(2024, 2, 1));
      expect(wb.getCell(id, r, c).s.fmt).toBe('date');
      expect(wb.tableById(id, table).range.c2).toBe(2);
      expect(wb.getValue(id, 0, 2)).toBe('Column3');
    }
    expect(wb.undoLabels()).toEqual(['Pick date']);
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    wb.redo();
    expect(wb.getValue(id, r, c)).toBe(target === 'header' ? '2024-02-01' : partsToSerial(2024, 2, 1));
  });

  it.each(['en-US', 'de-DE'].flatMap((locale) => [true, false].flatMap((strict) => ['day', 'today', 'clear'].map((action) => [locale, strict, action]))))('checks calendar %s input against validation (strict=%s, action=%s)', (locale, strict, action) => {
    vi.setSystemTime(new Date('2024-02-02T12:00:00Z'));
    const { wb, id } = setup();
    const original = wb.getValue(id, 0, 0);
    wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'date', max: original, strict, allowBlank: false, message: 'Choose an allowed date' });
    wb.clearHistory();
    setLocale(locale);
    try {
      const button = action === 'day' ? document.querySelector('[aria-label="1 February 2024"]')
        : [...document.querySelectorAll('.dp-foot button')].find((node) => node.textContent === (action === 'today' ? 'Today' : 'Clear'));
      button.focus();
      button.click();
      if (strict) {
        expect(wb.getValue(id, 0, 0)).toBe(original);
        expect(wb.canUndo()).toBe(false);
        expect(document.querySelector('.datepicker')).not.toBeNull();
        expect(document.activeElement).toBe(button);
        expect(document.querySelector('.datepicker [role="alert"]').textContent).toBe('Choose an allowed date');
        document.querySelector('[aria-label="30 January 2024"]').click();
        expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 1, 30) + 0.5);
      } else {
        expect(wb.getValue(id, 0, 0)).toBe(action === 'clear' ? null : (action === 'today' ? todaySerial() : partsToSerial(2024, 2, 1)) + 0.5);
      }
      expect(document.querySelector('.datepicker')).toBeNull();
      expect(wb.getCell(id, 0, 0).s.fmt).toBe('datetime');
      wb.undo();
      expect(wb.getValue(id, 0, 0)).toBe(original);
    } finally { setLocale('en-US'); }
  });

  it('checks a custom validation formula against the proposed date', () => {
    const { wb, id } = setup();
    const original = wb.getValue(id, 0, 0);
    wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'formula', source: '=DAY(A1)>=30', strict: true });
    wb.clearHistory();
    document.querySelector('[aria-label="1 February 2024"]').click();
    expect(wb.getValue(id, 0, 0)).toBe(original);
    expect(wb.canUndo()).toBe(false);
    document.querySelector('[aria-label="30 January 2024"]').click();
    expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 1, 30) + 0.5);
  });

  it.each([1e300, -1e300])('opens on today for a number outside the calendar range (%s)', (value) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setCells(id, [{ r: 0, c: 0, cell: { v: value, s: { fmt: 'date' } } }]);
    wb.clearHistory();
    openDatePicker({ wb, sheetId: () => id, grid: { focus() {}, cellRect: () => ({ left: 0, right: 100, top: 0, bottom: 26, width: 100, height: 26 }) } }, 0, 0);
    vi.runAllTimers();
    expect(document.querySelector('.dp-title').textContent).not.toMatch(/NaN|undefined/);
    expect(document.activeElement.dataset.serial).toBe(String(todaySerial()));
    expect(wb.getValue(id, 0, 0)).toBe(value);
    expect(wb.canUndo()).toBe(false);
    key('ArrowRight');
    document.activeElement.click();
    expect(wb.getValue(id, 0, 0)).toBe(todaySerial() + 1);
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBe(value);
  });

  it('moves by day and week across months without changing the cell until a day is chosen', () => {
    const { wb, id } = setup();
    for (const [press, label] of [['ArrowRight', '1 February 2024'], ['ArrowDown', '8 February 2024'], ['ArrowLeft', '7 February 2024'], ['ArrowUp', '31 January 2024'], ['Home', '29 January 2024'], ['End', '4 February 2024']]) {
      expect(key(press).defaultPrevented).toBe(true);
      expect(document.activeElement.getAttribute('aria-label')).toBe(label);
    }
    expect(wb.canUndo()).toBe(false);
    document.activeElement.click();
    expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 2, 4) + 0.5);
    expect(wb.getCell(id, 0, 0).s.fmt).toBe('datetime');
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBe(partsToSerial(2024, 1, 31) + 0.5);
  });

  it('keeps focus on a valid day when paging to shorter months', () => {
    setup();
    expect(key('PageDown').defaultPrevented).toBe(true);
    expect(document.activeElement.getAttribute('aria-label')).toBe('29 February 2024');
    key('PageUp');
    expect(document.activeElement.getAttribute('aria-label')).toBe('29 January 2024');
  });

  it('keeps month buttons focused after rebuilding the calendar', () => {
    setup();
    const next = document.querySelector('[aria-label="Next month"]');
    next.focus();
    next.click();
    expect(document.querySelector('.dp-title').textContent).toBe('February 2024');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Next month');
  });

  it.each(['Escape', 'Tab'])('still dismisses with %s without editing', (press) => {
    const { wb, focus } = setup();
    key(press);
    expect(document.querySelector('.datepicker')).toBeNull();
    expect(wb.canUndo()).toBe(false);
    expect(focus).toHaveBeenCalled();
  });
});
