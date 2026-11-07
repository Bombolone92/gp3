// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { expandPrintText, marginBoxContent, printTextParts, splitPrintSections, buildPrintRoot } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { getLocale } from '../src/core/format.js';

describe('ampersands in print headers and footers', () => {
  it('prints && as one ampersand', () => {
    expect(expandPrintText('Profit && Loss', {})).toBe('Profit & Loss');
    expect(printTextParts('A && &[Tab]')).toEqual([{ text: 'A & ' }, { token: 'Tab' }]);
    expect(marginBoxContent('Profit && Loss', {})).toBe('"Profit & Loss"');
    expect(expandPrintText('&&P is not a page number', {})).toBe('&P is not a page number');
    expect(expandPrintText('Q&&A &[Tab]', { tab: 'Q1' })).toBe('Q&A Q1');
    expect(expandPrintText('A&B', {})).toBe('A&B'); // a lone & that is not a code stays
  });

  it('does not read && followed by a section letter as a section code', () => {
    expect(splitPrintSections('&&C literal&RRight')).toEqual({ left: '', center: '&&C literal', right: 'Right' });
    expect(expandPrintText('&&C literal', {})).toBe('&C literal');
    expect(splitPrintSections('&LP && L&RRight')).toEqual({ left: 'P && L', center: '', right: 'Right' });
  });
});

describe('page numbers that cannot be shown', () => {
  const now = new Date(2026, 7, 28, 14, 5);

  it('drops the whole page phrase rather than printing "Page of"', () => {
    expect(expandPrintText('Page &[Page] of &[Pages]', { file: 'x' })).toBe('');
    expect(expandPrintText('Printed &[Date] page &[Page]', { now })).toBe(`Printed ${now.toLocaleDateString(getLocale())}`);
    expect(expandPrintText('&[File] — &[Tab], p. &[Page]/&[Pages]', { file: 'Budget', tab: 'Q1' })).toBe('Budget — Q1');
    expect(expandPrintText('&[Tab] - &P', { tab: 'Q1' })).toBe('Q1');
    expect(expandPrintText('&P/&N &[Tab]', { tab: 'Q1' })).toBe('Q1');
    expect(expandPrintText('Page &[Page] of &[Pages]', { page: 2, pages: 5 })).toBe('Page 2 of 5');
    expect(expandPrintText('Page &[Page]', { page: 3 })).toBe('Page 3');
  });

  it('leaves the in-flow footer empty for the default page text', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'x');
    const root = buildPrintRoot(wb, id, 'Budget', { footer: 'Page &[Page] of &[Pages]', marginBoxes: false });
    expect(root.querySelector('.print-foot').textContent).toBe('');
    const dated = buildPrintRoot(wb, id, 'Budget', { footer: '&[Date] — Page &[Page] of &[Pages]', marginBoxes: false });
    expect(dated.querySelector('.print-foot').textContent).toBe(new Date().toLocaleDateString(getLocale()));
  });
});
