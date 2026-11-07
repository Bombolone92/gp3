// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook, cellFromInput } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { cellsFromHtmlRows } from '../src/core/clipboard.js';
import { AUTOMATIC_FORMAT, FORMAT_DETAIL_KEYS, ymdToSerial } from '../src/core/format.js';
import { FORMATS, DURATION_CODE } from '../src/ui/toolbar.js';
import { numberPatch } from '../src/ui/formatcells.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The toolbar's Automatic entry (and a Percent or Currency button pressed off) removed the format but not
// its details: a Duration reset to Automatic kept code: '[h]:mm:ss', a time with seconds kept sec: true, a
// custom 0.0 kept its code. Nothing on screen showed them, yet the next entry that implied a format of its
// own took them for the cell's choice: "1 1/2" displayed 36:00:00, "Feb 2024" 1087752:00:00, "25:30" 1.1,
// "12:30" 12:30:00 and "1,000" 1000, whether typed, pasted, filled, pasted as HTML or converted from text.
const A1 = parseRange('A1');
const DURATION = { fmt: 'custom', code: DURATION_CODE, dec: null };
const automatic = FORMATS.find((f) => f.value === 'general').patch;
/** A leftover a file saved before the fix may still hold: the detail without any format. */
const LEFTOVERS = [
  [{ code: DURATION_CODE }, '1 1/2', { fmt: 'custom', code: '# ?/?' }, '1 1/2'],
  [{ code: DURATION_CODE }, 'Feb 2024', { fmt: 'custom', code: 'mmm-yy' }, 'Feb-24'],
  [{ code: '0.0' }, '25:30', { fmt: 'custom', code: DURATION_CODE }, '25:30:00'],
  [{ sec: true }, '12:30', { fmt: 'time' }, '12:30'],
  [{ group: false }, '1,000', { fmt: 'number', dec: 0 }, '1,000'],
  [{ dec: 1 }, '5%', { fmt: 'percent', dec: 0 }, '5%'],
  [{ dateStyle: 'long', cur: 'EUR' }, '2024-03-15', { fmt: 'date' }, '2024-03-15'],
];

function seeded(style) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 5, f: null, s: { bold: true, ...style } } }]);
  return { wb, id };
}

describe('the Automatic patch', () => {
  it('names every detail a number format carries, in the toolbar, the editor and Format cells alike', () => {
    expect(Object.keys(AUTOMATIC_FORMAT).sort()).toEqual(['fmt', ...FORMAT_DETAIL_KEYS].sort());
    expect(Object.values(AUTOMATIC_FORMAT).every((v) => v === null)).toBe(true);
    expect(automatic).toEqual(AUTOMATIC_FORMAT);
    expect(numberPatch({ category: 'general' })).toEqual(AUTOMATIC_FORMAT);
    expect(numberPatch({ category: 'text' })).toEqual({ ...AUTOMATIC_FORMAT, fmt: 'text' });
    expect(numberPatch({ category: 'number', dec: 2 })).toMatchObject({ fmt: 'number', sec: null, code: null });
    // Format cells has no seconds control: under Time and Date and time a cell keeps the seconds it shows.
    expect(numberPatch({ category: 'time' })).not.toHaveProperty('sec');
    expect(numberPatch({ category: 'datetime', dateStyle: 'long' })).not.toHaveProperty('sec');
  });

  it.each([
    ['a Duration', DURATION],
    ['a time with seconds', { fmt: 'time', sec: true }],
    ['a custom code', { fmt: 'custom', code: '0.0', dec: null }],
    ['an ungrouped currency', { fmt: 'currency', cur: 'EUR', dec: 1, group: false }],
    ['a written-out date', { fmt: 'date', dateStyle: 'long' }],
  ])('leaves nothing of %s behind but the cell\'s other styling', (_, style) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    wb.applyStyle(id, A1, { bold: true });
    wb.applyStyle(id, A1, style);
    wb.applyStyle(id, A1, automatic);
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
    wb.applyStyle(id, A1, style);
    wb.applyStyle(id, A1, numberPatch({ category: 'general' }));
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
  });

  it('lets the next typed entry take its own format: a fraction, a month and year, a duration, a time, a grouped number', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const reset = (style) => { wb.applyStyle(id, A1, style); wb.applyStyle(id, A1, automatic); };
    for (const [style, text, expected, display] of LEFTOVERS) {
      reset({ fmt: 'custom', code: '0.0', ...style });
      wb.setInput(id, 0, 0, text);
      expect(wb.getCell(id, 0, 0).s, text).toEqual(expected);
      expect(wb.getDisplay(id, 0, 0), text).toBe(display);
    }
  });
});

describe('a detail left in a cell without a format', () => {
  it.each(LEFTOVERS)('%j does not shape %s when it is typed', (style, text, expected, display) => {
    expect(cellFromInput(text, { bold: true, ...style }).s).toEqual({ bold: true, ...expected });
    const { wb, id } = seeded(style);
    wb.setInput(id, 0, 0, text);
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true, ...expected });
    expect(wb.getDisplay(id, 0, 0)).toBe(display);
  });

  it.each(LEFTOVERS)('%j does not shape %s when it is pasted, filled, pasted as HTML or converted from text', (style, text, expected, display) => {
    let { wb, id } = seeded(style);
    wb.pasteValues(id, [[text]], 0, 0);
    expect(wb.getCell(id, 0, 0).s, 'pasted').toEqual({ bold: true, ...expected });
    expect(wb.getDisplay(id, 0, 0), 'pasted').toBe(display);

    ({ wb, id } = seeded(style));
    wb.fillInput(id, A1, text, { r: 0, c: 0 });
    expect(wb.getCell(id, 0, 0).s, 'filled').toEqual({ bold: true, ...expected });
    expect(wb.getDisplay(id, 0, 0), 'filled').toBe(display);

    ({ wb, id } = seeded(style));
    const cells = cellsFromHtmlRows([[{ text }]], (i, j) => wb.getCell(id, i, j)?.s);
    wb.setCells(id, cells.map(({ i, j, cell }) => ({ r: i, c: j, cell })));
    expect(wb.getCell(id, 0, 0).s, 'html').toEqual({ bold: true, ...expected });
    expect(wb.getDisplay(id, 0, 0), 'html').toBe(display);

    ({ wb, id } = seeded(style));
    wb.setInput(id, 0, 0, `'${text}`);
    expect(wb.getValue(id, 0, 0)).toBe(text);
    wb.transformText(id, A1, 'number');
    expect(wb.getCell(id, 0, 0).s, 'converted').toEqual({ bold: true, ...expected });
    expect(wb.getDisplay(id, 0, 0), 'converted').toBe(display);
  });

  it('still yields to a format the cell does have', () => {
    expect(cellFromInput('1 1/2', { fmt: 'custom', code: DURATION_CODE }).s).toEqual({ fmt: 'custom', code: DURATION_CODE });
    expect(cellFromInput('12:30', { fmt: 'time', sec: true }).s).toEqual({ fmt: 'time', sec: true });
    expect(cellFromInput('1,000', { fmt: 'number', group: false, dec: 1 }).s).toEqual({ fmt: 'number', group: false, dec: 1 });
    expect(cellFromInput('$5', { fmt: 'currency', cur: 'EUR' }).s).toEqual({ fmt: 'currency', cur: 'EUR' });
  });

  it('is dropped by a plain number too, since nothing shows it', () => {
    expect(cellFromInput('5', { bold: true, code: DURATION_CODE })).toEqual({ v: 5, f: null, s: { bold: true, code: DURATION_CODE } });
    expect(cellFromInput('Feb 2024', { bold: true, code: DURATION_CODE }).s).toEqual({ bold: true, fmt: 'custom', code: 'mmm-yy' });
    expect(cellFromInput('2024-03-15', { dateStyle: 'medium' }).s).toEqual({ fmt: 'date' });
    expect(cellFromInput('2024-03-15', { dateStyle: 'medium' }).v).toBe(ymdToSerial(2024, 3, 15));
  });
});

describe('in the editor', () => {
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
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  async function mount(style) {
    const doc = new Doc({ name: 'Formats', path: 'Spreadsheets/Formats.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    wb.applyStyle(id, A1, { bold: true, ...style });
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    return { wb, id };
  }
  const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);

  it('clears a time\'s seconds when the Percent button is pressed off again', async () => {
    const { wb, id } = await mount({ fmt: 'time', sec: true });
    const press = async () => { view.el.querySelector('[data-cmd="fmt"][data-arg="percent"]').click(); await vi.advanceTimersByTimeAsync(1); };
    await press();
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true, fmt: 'percent', sec: true, dec: 0 });
    await press();
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
    wb.setInput(id, 0, 0, '12:30');
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true, fmt: 'time' });
    expect(wb.getDisplay(id, 0, 0)).toBe('12:30');
  });

  it('clears a currency\'s decimals, grouping and currency when General is chosen for it', async () => {
    const { wb, id } = await mount({ fmt: 'currency', cur: 'EUR', dec: 0, group: false });
    view.el.querySelector('.tb-fmt').click();
    menuItem('General').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
    wb.setInput(id, 0, 0, '1,000');
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true, fmt: 'number', dec: 0 });
    expect(wb.getDisplay(id, 0, 0)).toBe('1,000');
  });

  it('clears a duration\'s code from the number-format list\'s General entry', async () => {
    const { wb, id } = await mount(DURATION);
    view.el.querySelector('.tb-fmt').click();
    menuItem('General').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getCell(id, 0, 0).s).toEqual({ bold: true });
    wb.setInput(id, 0, 0, '1 1/2');
    expect(wb.getDisplay(id, 0, 0)).toBe('1 1/2');
  });
});
