// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENCIES, LOCALES, parseInput, formatValue, setLocale, localeCurrency, cellCurrency, currencyDecimals } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { workbookFromFile, sheetToCsv } from '../src/core/io.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The Currency format's own display did not read back: parseInput knew seven currency signs and mapped each to
// one currency, so the default preset's US$1,234.50 (Britain), USD 1,234.50 (Australia), 1 234,50 $US (France)
// and 1 234,50 USD (Italy) came back from a CSV or a paste as text, en-AU's own $1,234.50 as US dollars and
// zh-CN's ¥1,234.50 as yen; and the preset was dollars in every regional format. Every label Intl writes in
// the regional format, and every ISO code, now reads back; a shared sign is the regional format's own currency
// first; and the Currency format takes that currency on a cell in none.
afterEach(() => setLocale('en-US'));

const codes = CURRENCIES.map(([cur]) => cur);
const A1 = parseRange('A1');

describe('the regional format\'s currency', () => {
  it('is one on offer in the picker for every regional format', () => {
    for (const [loc] of LOCALES) expect(codes, loc).toContain(localeCurrency(loc));
    expect(localeCurrency('en-GB')).toBe('GBP');
    expect(localeCurrency('en-AU')).toBe('AUD');
    expect(localeCurrency('de-DE')).toBe('EUR');
    expect(localeCurrency('da-DK')).toBe('DKK');
    expect(localeCurrency('zh-CN')).toBe('CNY');
    setLocale('ja-JP');
    expect(localeCurrency()).toBe('JPY');
  });

  it('is what a cell in no currency takes, while a cell keeps its own and a currency style without cur stays in dollars', () => {
    setLocale('de-DE');
    expect(cellCurrency({})).toBe('EUR');
    expect(cellCurrency(undefined)).toBe('EUR');
    expect(cellCurrency({ fmt: 'percent' })).toBe('EUR');
    expect(cellCurrency({ fmt: 'currency', cur: 'GBP' })).toBe('GBP');
    expect(cellCurrency({ fmt: 'custom', cur: 'CHF' })).toBe('CHF');
    expect(cellCurrency({ fmt: 'currency' })).toBe('USD');
    expect(cellCurrency({}, 'en-AU')).toBe('AUD');
  });
});

describe('the Currency format\'s own display', () => {
  it.each(LOCALES.map(([loc]) => loc))('reads back as the amount and the currency under %s, for the default and every currency on offer', (loc) => {
    setLocale(loc);
    for (const cur of [undefined, ...codes]) {
      for (const [value, dec] of [[1234.5, 2], [-1234.5, 2], [1235, 0], [-1235, 0], [0.5, 2]]) {
        const style = { fmt: 'currency', ...(cur ? { cur } : {}), dec };
        const shown = formatValue(value, style);
        expect(parseInput(shown), `${loc} ${cur || 'default'}: ${JSON.stringify(shown)}`).toEqual({ v: value, f: null, fmt: 'currency', cur: cur || 'USD' });
      }
    }
  });

  it.each([
    ['en-US', '$', 'USD'], ['en-AU', '$', 'AUD'], ['de-DE', '$', 'USD'], ['fr-FR', '$', 'USD'], ['pt-BR', '$', 'USD'],
    ['en-US', '¥', 'JPY'], ['ja-JP', '¥', 'JPY'], ['zh-CN', '¥', 'CNY'], ['en-US', '￥', 'JPY'], ['ja-JP', '￥', 'JPY'], ['zh-CN', '￥', 'CNY'],
    ['en-US', 'kr', 'SEK'], ['sv-SE', 'kr', 'SEK'], ['nb-NO', 'kr', 'NOK'], ['da-DK', 'kr', 'DKK'], ['da-DK', 'kr.', 'DKK'], ['fi-FI', 'kr', 'SEK'],
    ['en-US', '£', 'GBP'], ['en-GB', '£', 'GBP'], ['en-IN', '₹', 'INR'], ['pl-PL', 'zł', 'PLN'], ['cs-CZ', 'Kč', 'CZK'], ['ru-RU', '₽', 'RUB'],
    ['tr-TR', '₺', 'TRY'], ['ko-KR', '₩', 'KRW'], ['pt-BR', 'R$', 'BRL'], ['de-DE', 'CHF', 'CHF'], ['en-US', 'CHF', 'CHF'],
  ])('under %s reads a bare %s as the regional format\'s own currency first, then the first on offer', (loc, sign, cur) => {
    setLocale(loc);
    for (const text of [`${sign}5`, `${sign} 5`, `5 ${sign}`, `5${sign}`, `-${sign}5`, `${sign}-5`, `(${sign}5)`, `(${sign} 5)`]) {
      const negative = text.startsWith('-') || text.startsWith('(') || text.includes('-5');
      expect(parseInput(text), text).toEqual({ v: negative ? -5 : 5, f: null, fmt: 'currency', cur });
    }
  });

  it('reads the label as each regional format lays it out, with the minus before or after it, and the ISO code anywhere', () => {
    const read = (text) => parseInput(text);
    expect(read('USD 1,234.50')).toEqual({ v: 1234.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('1,234.50 USD')).toEqual({ v: 1234.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('CA$5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'CAD' });
    expect(read('A$5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'AUD' });
    expect(read('MX$5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'MXN' });
    expect(read('CN¥5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'CNY' });
    expect(read('5 EUR')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'EUR' });
    expect(read('GBP 5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'GBP' });
    // A label is read in the regional format that writes it: US$ is Britain's, not America's, where the label is $.
    expect(read('US$5')).toEqual({ v: 'US$5', f: null, fmt: null });
    setLocale('en-GB');
    expect(read('US$1,234.50')).toEqual({ v: 1234.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('-US$ 5')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('US$ -5')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('(US$ 5)')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('JP¥5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'JPY' });
    setLocale('nl-NL');
    expect(read('US$ -1.234,50')).toEqual({ v: -1234.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('C$ 5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'CAD' });
    expect(read('€ -5')).toEqual({ v: -5, f: null, fmt: 'currency', cur: 'EUR' });
    setLocale('fr-FR');
    expect(read('1 234,50 $US')).toEqual({ v: 1234.5, f: null, fmt: 'currency', cur: 'USD' });
    expect(read('5 $CA')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'CAD' });
    expect(read('5 £GB')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'GBP' });
    setLocale('sv-SE');
    expect(read('−1 234,50 kr')).toEqual({ v: -1234.5, f: null, fmt: 'currency', cur: 'SEK' });
    expect(read('5 Nkr')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'NOK' });
    expect(read('5 Dkr')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'DKK' });
    setLocale('ja-JP');
    expect(read('元 5')).toEqual({ v: 5, f: null, fmt: 'currency', cur: 'CNY' });
    expect(read('￥1,235')).toEqual({ v: 1235, f: null, fmt: 'currency', cur: 'JPY' });
    setLocale('de-DE');
    expect(read('1.234,50 €')).toEqual({ v: 1234.5, f: null, fmt: 'currency', cur: 'EUR' });
    expect(read('(1.234,50 €)')).toEqual({ v: -1234.5, f: null, fmt: 'currency', cur: 'EUR' });
    expect(read('1.234,50 AU$')).toEqual({ v: 1234.5, f: null, fmt: 'currency', cur: 'AUD' });
  });

  it('keeps as text what names no amount, or more than a label and an amount', () => {
    for (const text of ['$', 'kr', 'USD', 'CHF', '5 kroner', 'kr 5 kr', '$5 USD', '1-2 kr', 'US$', 'krona 5', '5 $ 5']) {
      expect(parseInput(text), text).toEqual({ v: text, f: null, fmt: null });
    }
    // The shapes that were numbers, dates and times before are still what they were.
    expect(parseInput('5%')).toEqual({ v: 0.05, f: null, fmt: 'percent' });
    expect(parseInput('1,000')).toEqual({ v: 1000, f: null, fmt: 'number' });
    expect(parseInput('1/2').fmt).toBe('date');
    expect(parseInput('12:30').fmt).toBe('time');
    expect(parseInput('1 1/2')).toEqual({ v: 1.5, f: null, fmt: 'custom', code: '# ?/?' });
  });

  it.each(['en-GB', 'en-AU', 'de-DE', 'fr-FR', 'sv-SE', 'nl-NL', 'pt-BR', 'ja-JP', 'zh-CN', 'da-DK', 'fi-FI', 'it-IT'])('survives a CSV export and import under %s, in the default currency and the regional format\'s own', async (loc) => {
    setLocale(loc);
    const wb = new Workbook();
    const id = wb.activeSheetId;
    // The numbers are stored as such; "1234.5" typed under a comma-decimal regional format would be text.
    // A currency without a minor unit (the yen) is written whole, so a whole amount is what survives the trip.
    const ownValue = currencyDecimals(localeCurrency()) ? -1234.5 : -1235;
    wb.setCells(id, [
      { r: 0, c: 0, cell: { v: 1234.5, f: null, s: { fmt: 'currency' } } },
      { r: 1, c: 0, cell: { v: ownValue, f: null, s: { fmt: 'currency', cur: localeCurrency() } } },
      { r: 0, c: 1, cell: { v: 'note', f: null } }, // a second column, so the file carries its separator
      { r: 1, c: 1, cell: { v: 'note', f: null } },
    ]);
    const csv = sheetToCsv(wb, id);
    const back = await workbookFromFile(new TextEncoder().encode(csv), 'amounts.csv');
    const bid = back.activeSheetId;
    expect(back.getValue(bid, 0, 0), csv).toBe(1234.5);
    expect(back.getCell(bid, 0, 0).s, csv).toMatchObject({ fmt: 'currency', cur: 'USD' });
    expect(back.getValue(bid, 1, 0), csv).toBe(ownValue);
    expect(back.getCell(bid, 1, 0).s, csv).toMatchObject({ fmt: 'currency', cur: localeCurrency() });
    expect(back.getDisplay(bid, 1, 0)).toBe(wb.getDisplay(id, 1, 0));
  });

  it('is read the same way when typed into a cell, pasted and converted from text', () => {
    setLocale('en-AU');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '$1,234.50');
    expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'currency', cur: 'AUD' });
    expect(wb.getDisplay(id, 0, 0)).toBe('$1,234.50');
    wb.pasteValues(id, [['USD 5.00']], 1, 0);
    expect(wb.getCell(id, 1, 0).s).toMatchObject({ fmt: 'currency', cur: 'USD' });
    expect(wb.getDisplay(id, 1, 0)).toBe('USD 5.00');
    wb.setInput(id, 2, 0, "'$5");
    wb.transformText(id, parseRange('A3'), 'number');
    expect(wb.getValue(id, 2, 0)).toBe(5);
    expect(wb.getCell(id, 2, 0).s.fmt).toBe('currency');
  });
});

describe('the Currency format applied from the toolbar, the Format menu and the chord', () => {
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
    const doc = new Doc({ name: 'Money', path: 'Spreadsheets/Money.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '5');
    if (style) wb.applyStyle(id, A1, style);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    return { wb, id };
  }
  const tick = () => vi.advanceTimersByTimeAsync(1);
  // The Number group has no currency toggle: Currency and General are picked from the number-format list.
  const pick = async (label) => { view.el.querySelector('.tb-fmt').click(); menuItem(label).click(); await tick(); };
  const menuItem = (label) => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === label);
  const chord = () => view.el.querySelector('.grid-viewport').dispatchEvent(new KeyboardEvent('keydown', { key: '$', code: 'Digit4', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

  it('takes pounds in British English from the number-format list, and General takes them away', async () => {
    const { wb, id } = await mount('en-GB');
    await pick('Currency');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'GBP' });
    expect(wb.getDisplay(id, 0, 0)).toBe('£5.00');
    await pick('General');
    expect(wb.getCell(id, 0, 0).s).toBeUndefined();
  });

  it('takes euros in German from the Format menu and the chord', async () => {
    const { wb, id } = await mount('de-DE');
    view.el.querySelector('.tb-fmt').click();
    menuItem('Currency').click();
    await tick();
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'EUR' });
    expect(wb.getDisplay(id, 0, 0)).toBe('5,00 €');
    wb.applyStyle(id, A1, { fmt: null, cur: null });
    chord();
    await tick();
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'EUR' });
  });

  it('stamps nothing in the US format, where a currency style without cur is dollars already', async () => {
    const { wb, id } = await mount('en-US');
    await pick('Currency');
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency' });
    expect(wb.getDisplay(id, 0, 0)).toBe('$5.00');
  });

  it('leaves the currency of a cell that has one, and keeps a picked currency over the regional format\'s', async () => {
    const { wb, id } = await mount('en-GB', { fmt: 'currency', cur: 'EUR', dec: 0 });
    view.el.querySelector('.tb-fmt').click();
    menuItem('Currency').click();
    await tick();
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 0 });
    // A percent cell that once was in Swiss francs goes back to francs, not pounds.
    wb.applyStyle(id, A1, { fmt: 'percent', cur: 'CHF' });
    chord();
    await tick();
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'CHF', dec: 0 });
  });
});
