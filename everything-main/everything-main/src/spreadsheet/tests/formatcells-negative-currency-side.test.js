// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { CURRENCIES, LOCALES, setLocale, formatValue, styleToNumFmt } from '../src/core/format.js';
import { negativeCode, negativeStyleFor, openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeAll(() => {
  if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { closeAllModals(); document.body.replaceChildren(); setLocale('en-US'); });

// Format cells' Negative numbers choice wrote the currency label in front of the digits whatever the
// regional format, while the plain Currency format puts it where that format does. So asking for
// parentheses on negatives under Deutsch turned a cell reading 1.234,50 € into €1.234,50: the user
// changed one thing and the symbol moved. Both codes now come from the same affixes.
const NEGATIVES = ['minus', 'red', 'paren', 'redparen'];
const positiveSection = (code) => code.slice(0, code.indexOf(';'));

describe('the code a negative style writes', () => {
  // The exact invariant: two codes for one cell can never disagree.
  it.each([['en-US'], ['de-DE'], ['en-GB'], ['fr-FR'], ['nl-NL'], ['sv-SE'], ['ja-JP'], ['tr-TR']])(
    'opens with the same positive section as the plain Currency format under %s', (loc) => {
      setLocale(loc);
      for (const [cur] of CURRENCIES) {
        for (const dec of [0, 2, 3]) {
          for (const group of [true, false]) {
            const plain = styleToNumFmt({ fmt: 'currency', cur, dec, group });
            for (const neg of NEGATIVES) {
              expect(positiveSection(negativeCode({ category: 'currency', dec, group, cur, neg })), `${loc} ${cur} ${dec} ${group} ${neg}`).toBe(plain);
            }
          }
        }
      }
    });

  it('agrees with the plain Currency format in every regional format the app offers', () => {
    for (const [loc] of LOCALES) {
      setLocale(loc);
      for (const cur of ['USD', 'EUR', 'GBP', 'JPY', 'SEK', 'NOK', 'CHF', 'TRY']) {
        expect(positiveSection(negativeCode({ category: 'currency', dec: 2, group: true, cur, neg: 'paren' })), `${loc} ${cur}`)
          .toBe(styleToNumFmt({ fmt: 'currency', cur, dec: 2, group: true }));
      }
    }
  });

  // The gap is the regional format's own no-break space (U+00A0), never an ordinary one.
  it('puts a German label after the digits and an American one in front', () => {
    setLocale('de-DE');
    expect(negativeCode({ category: 'currency', dec: 2, group: true, cur: 'EUR', neg: 'paren' })).toBe('#,##0.00" €";(#,##0.00" €")');
    setLocale('en-US');
    expect(negativeCode({ category: 'currency', dec: 2, group: true, cur: 'EUR', neg: 'paren' })).toBe('"€"#,##0.00;("€"#,##0.00)');
  });

  it('leaves a plain number format alone', () => {
    setLocale('de-DE');
    expect(negativeCode({ category: 'number', dec: 2, group: true, neg: 'red' })).toBe('#,##0.00;[Red]-#,##0.00');
    expect(negativeCode({ category: 'number', dec: 0, group: false, neg: 'paren' })).toBe('0;(0)');
  });
});

describe('reading such a code back', () => {
  it.each([['en-US'], ['de-DE'], ['en-GB'], ['fr-FR'], ['nl-NL'], ['sv-SE'], ['ja-JP']])('round-trips every negative style under %s', (loc) => {
    setLocale(loc);
    for (const [cur] of CURRENCIES) {
      for (const neg of NEGATIVES) {
        for (const group of [true, false]) {
          const options = { category: 'currency', dec: 2, group, cur, neg };
          expect(negativeStyleFor(negativeCode(options)), `${loc} ${cur} ${neg}`).toEqual(options);
        }
      }
    }
  });

  it('reads a code written under another regional format, the label on either side', () => {
    // Saved under Deutsch, opened under American English: still a euro cell in parentheses.
    setLocale('en-US');
    expect(negativeStyleFor('#,##0.00" €";(#,##0.00" €")')).toEqual({ category: 'currency', dec: 2, group: true, cur: 'EUR', neg: 'paren' });
    // Another producer's ordinary space is read as the same currency: only the label is matched.
    expect(negativeStyleFor('#,##0.00" €";(#,##0.00" €")')).toEqual({ category: 'currency', dec: 2, group: true, cur: 'EUR', neg: 'paren' });
    expect(negativeStyleFor('#,##0.00" €";[Red]-#,##0.00" €"')).toEqual({ category: 'currency', dec: 2, group: true, cur: 'EUR', neg: 'red' });
    expect(negativeStyleFor('"€"#,##0.00;("€"#,##0.00)')).toEqual({ category: 'currency', dec: 2, group: true, cur: 'EUR', neg: 'paren' });
  });

  it('refuses a code that puts a label on both sides, or that disagrees between its sections', () => {
    expect(negativeStyleFor('"$"#,##0.00" x";("$"#,##0.00" x")')).toBeNull();
    expect(negativeStyleFor('#,##0.00" €";(#,##0.00" $")')).toBeNull();
    expect(negativeStyleFor('"€"#,##0.00;(#,##0.00" €")')).toBeNull();
    expect(negativeStyleFor('#,##0.00" zz";(#,##0.00" zz")')).toBeNull();
  });
});

describe('the dialog', () => {
  function open(wb) {
    const id = wb.activeSheetId;
    const range = parseRange('A1');
    const modal = openFormatCellsDialog({
      wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }), range: () => range,
      style: () => wb.getCell(id, 0, 0)?.s || {}, run: (cmd, arg) => wb.applyStyle(id, range, arg.patch),
      grid: { editing: false, focus() {}, commitEdit() {} },
    });
    const field = (label) => modal.panel.querySelector(`[aria-label="${label}"]`);
    const pick = (label, v) => { field(label).value = v; field(label).dispatchEvent(new Event('change')); };
    const apply = () => modal.panel.querySelector('form.fc-form').dispatchEvent(new Event('submit', { cancelable: true }));
    return { modal, field, pick, apply };
  }
  const euroCell = () => {
    const wb = new Workbook();
    wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 1234.5, s: { fmt: 'currency', cur: 'EUR', dec: 2 } } }]);
    return wb;
  };

  it('leaves the symbol where it was when only the negative style is asked for', () => {
    setLocale('de-DE');
    const wb = euroCell();
    const id = wb.activeSheetId;
    const before = wb.getDisplay(id, 0, 0);
    expect(before).toBe(formatValue(1234.5, { fmt: 'currency', cur: 'EUR', dec: 2 }));
    const { modal, pick, apply } = open(wb);
    pick('Negative numbers', 'paren');
    expect(modal.panel.querySelector('.numfmt-preview').textContent).toBe(`Preview: ${before}`);
    apply();
    // The positive amount is untouched; only negatives changed, and they keep the same layout.
    expect(wb.getDisplay(id, 0, 0)).toBe(before);
    expect(formatValue(-1234.5, wb.getCell(id, 0, 0).s)).toBe(`(${before})`);
  });

  it('reopens on Currency with the negative style it was given', () => {
    setLocale('de-DE');
    const wb = euroCell();
    const first = open(wb);
    first.pick('Negative numbers', 'redparen');
    first.apply();
    closeAllModals();
    const { field } = open(wb);
    expect(field('Category').value).toBe('currency');
    expect(field('Currency').value).toBe('EUR');
    expect(field('Negative numbers').value).toBe('redparen');
    expect(field('Decimal places').value).toBe('2');
  });

  it('opens a code saved under another regional format as Currency, not as Custom', () => {
    setLocale('en-US');
    const wb = new Workbook();
    wb.setCells(wb.activeSheetId, [{ r: 0, c: 0, cell: { v: 1234.5, s: { fmt: 'custom', code: '#,##0.00" €";(#,##0.00" €")' } } }]);
    const { field } = open(wb);
    expect(field('Category').value).toBe('currency');
    expect(field('Currency').value).toBe('EUR');
    expect(field('Negative numbers').value).toBe('paren');
  });

  it('applies nothing when such a cell is opened and applied untouched', () => {
    setLocale('de-DE');
    const wb = euroCell();
    const id = wb.activeSheetId;
    const first = open(wb);
    first.pick('Negative numbers', 'paren');
    first.apply();
    closeAllModals();
    const stored = JSON.stringify(wb.getCell(id, 0, 0).s);
    const second = open(wb);
    second.apply();
    expect(JSON.stringify(wb.getCell(id, 0, 0).s)).toBe(stored);
  });
});
