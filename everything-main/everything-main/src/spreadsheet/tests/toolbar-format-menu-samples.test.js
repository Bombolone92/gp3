// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar, ACCOUNTING_CODE, accountingCode, isAccountingCode, formatEntry, FORMATS } from '../src/ui/toolbar.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { CURRENCIES, currencyDecimals, setLocale, formatValue } from '../src/core/format.js';

// The number-format menu's samples were fixed en-US strings: under Deutsch the rows read Number 1,234.50,
// Currency $1,234.50, Percent 12.35% and Date, written out Aug 27, 2026 while the sheet showed 1.234,50,
// 1.234,50 €, 12,35 % and 27.08.2026, and on a cell in euros the Currency row still promised dollars. The
// samples are now built when the menu opens, under the regional format and in the cell's currency (the
// regional format's own on a cell in none), and the Accounting preset takes that currency too, instead of a
// dollar sign whatever the regional format.
afterEach(() => { closeMenu(); document.body.replaceChildren(); setLocale('en-US'); });

function openMenuFor(style) {
  const wb = new Workbook();
  const toolbar = createToolbar({
    wb, run() {}, activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {},
  });
  document.body.append(toolbar.el);
  toolbar.el.querySelector('.tb-fmt').click();
  const items = [...document.querySelectorAll('.menu-item')];
  const samples = Object.fromEntries(items.filter((b) => b.getAttribute('role') === 'menuitemradio')
    .map((b) => [b.querySelector('.menu-label').textContent, b.querySelector('.menu-shortcut')?.textContent ?? '']));
  const picker = items.find((b) => b.querySelector('.menu-label')?.textContent.startsWith('Currency symbol'));
  return { samples, picker, toolbar };
}

describe('the number-format menu\'s samples', () => {
  it('read in the US format as they always did, the Accounting row as its cells show', () => {
    expect(openMenuFor({}).samples).toEqual({
      General: '1234.5', Number: '1,234.50', Currency: '$1,234.50', Accounting: '$1,234.50', Percentage: '12.35%',
      Fraction: '1234 1/2', Scientific: '1.23E+03', 'Short Date': '2026-08-27', 'Long Date': 'Aug 27, 2026', Time: '13:45',
      Duration: '25:30:00', 'Date and time': '2026-08-27 13:45', Text: 'as typed', 'Custom format…': '',
    });
  });

  it('follow the regional format and take its currency on a cell in none', () => {
    setLocale('de-DE');
    const { samples, picker } = openMenuFor({});
    expect(samples).toEqual({
      General: '1234,5', Number: '1.234,50', Currency: '1.234,50 €', Accounting: '€1.234,50', Percentage: '12,35 %',
      Fraction: '1234 1/2', Scientific: '1,23E+03', 'Short Date': '2026-08-27', 'Long Date': '27.08.2026', Time: '13:45',
      Duration: '25:30:00', 'Date and time': '2026-08-27 13:45', Text: 'as typed', 'Custom format…': '',
    });
    expect(picker.querySelector('.menu-label').textContent).toBe('Currency symbol (EUR)…');
    setLocale('ja-JP');
    // The yen has no minor unit, so both the Currency and the Accounting rows show it whole.
    expect(openMenuFor({}).samples).toMatchObject({ Currency: '￥1,235', Accounting: '¥1,235', 'Long Date': '2026/08/27' });
    setLocale('en-GB');
    expect(openMenuFor({}).samples).toMatchObject({ Currency: '£1,234.50', Accounting: '£1,234.50', 'Long Date': '27 Aug 2026' });
  });

  it('show the cell\'s own currency, in the Currency and Accounting rows and the picker', () => {
    const { samples, picker } = openMenuFor({ fmt: 'currency', cur: 'GBP', dec: 0 });
    expect(samples.Currency).toBe('£1,234.50');
    expect(samples.Accounting).toBe('£1,234.50');
    expect(picker.querySelector('.menu-label').textContent).toBe('Currency symbol (GBP)…');
    setLocale('de-DE');
    expect(openMenuFor({ fmt: 'currency' }).samples.Currency).toBe('1.234,50 $'); // a currency style without cur is dollars
    expect(openMenuFor({ fmt: 'custom', code: accountingCode('CHF'), cur: 'CHF' }).samples.Accounting).toBe('CHF 1.234,50');
  });

  it('check the picked currency in the symbol menu: the regional format\'s own on a cell in none', () => {
    setLocale('sv-SE');
    const { picker } = openMenuFor({});
    picker.click();
    const names = new Set(CURRENCIES.map(([, name]) => name));
    const checked = [...document.querySelectorAll('[role="menuitemradio"]')].filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.querySelector('.menu-label').textContent);
    expect(checked.filter((label) => names.has(label))).toEqual(['Swedish krona']);
  });
});

describe('the Accounting preset', () => {
  it('has a code per currency, the US dollar\'s being the one it always had, and every one is recognized as Accounting', () => {
    expect(accountingCode('USD')).toBe(ACCOUNTING_CODE);
    expect(ACCOUNTING_CODE).toBe('_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)');
    expect(accountingCode('EUR')).toBe('_("€"* #,##0.00_);_("€"* (#,##0.00);_("€"* "-"??_);_(@_)');
    expect(accountingCode('CHF')).toBe('_("CHF "* #,##0.00_);_("CHF "* (#,##0.00);_("CHF "* "-"??_);_(@_)');
    // A currency without a minor unit shows none here too, as the Currency preset and the exported code do.
    expect(accountingCode('JPY')).toBe('_("¥"* #,##0_);_("¥"* (#,##0);_("¥"* "-"_);_(@_)');
    for (const [cur] of CURRENCIES) {
      expect(isAccountingCode(accountingCode(cur)), cur).toBe(true);
      // A cell saved with the two decimals every currency used to take is still shown as Accounting.
      expect(isAccountingCode(accountingCode(cur, 2)), cur).toBe(true);
      expect(formatEntry({ fmt: 'custom', code: accountingCode(cur) }).value, cur).toBe('accounting');
      expect(formatValue(-1234.5, { fmt: 'custom', code: accountingCode(cur) }), cur).toContain(currencyDecimals(cur) ? '(1,234.50)' : '(1,235)');
    }
    expect(isAccountingCode('0.0')).toBe(false);
    expect(FORMATS.find((f) => f.value === 'accounting').patch.code).toBe(ACCOUNTING_CODE);
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

  async function mount(loc, style = null) {
    setLocale(loc);
    const doc = new Doc({ name: 'Ledger', path: 'Spreadsheets/Ledger.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    if (style) wb.applyStyle(id, parseRange('A1'), style);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    return { wb, id };
  }
  const pick = async (label) => {
    view.el.querySelector('.tb-fmt').click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label).click();
    await vi.advanceTimersByTimeAsync(1);
  };

  it('applies Accounting in the regional format\'s currency, keeps it on a second press, and hands it on to Currency', async () => {
    const { wb, id } = await mount('de-DE');
    await pick('Accounting');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'custom', code: accountingCode('EUR'), cur: 'EUR' });
    expect(wb.getDisplay(id, 0, 0).trim()).toBe('€5,00');
    await pick('Accounting');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'custom', code: accountingCode('EUR'), cur: 'EUR' });
    await pick('Currency');
    expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'currency', cur: 'EUR' });
    expect(wb.getDisplay(id, 0, 0)).toBe('5,00 €');
  });

  it('applies Accounting in the cell\'s own currency, and the plain dollar code in the US format', async () => {
    let { wb, id } = await mount('en-US', { fmt: 'currency', cur: 'GBP' });
    await pick('Accounting');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'custom', code: accountingCode('GBP'), cur: 'GBP' });
    expect(wb.getDisplay(id, 0, 0).trim()).toBe('£5.00');
    view.destroy();
    view = null;
    document.body.innerHTML = '<div id="app"></div>';
    ({ wb, id } = await mount('en-US'));
    await pick('Accounting');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'custom', code: ACCOUNTING_CODE });
    expect(wb.getDisplay(id, 0, 0).trim()).toBe('$5.00');
  });
});
