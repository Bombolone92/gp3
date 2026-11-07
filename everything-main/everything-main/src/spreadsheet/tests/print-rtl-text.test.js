// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildPrintTable } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';
import { readsRightToLeft } from '../src/core/bidi.js';

// Text that reads right to left printed left-aligned in left-to-right direction, unlike the grid, which
// right-aligns it by default and gives its box dir="rtl" so numbers, punctuation and a trailing Latin
// word sit where they belong. On paper a Hebrew or Arabic sheet had every label on the wrong side of its
// cell and a label such as "שלום world" rendered with its parts swapped.
function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  const cell = (a1) => {
    const { r, c } = parseCellRef(a1);
    return [...buildPrintTable(wb, id).querySelectorAll('tbody tr')][r].children[c];
  };
  return { wb, id, cell };
}

describe('right-to-left text in print', () => {
  it('prints right-aligned in right-to-left direction, as the grid shows it', () => {
    const { cell } = book({ A1: 'שלום עולם', A2: 'مرحبا', A3: '123 שלום', A4: 'שלום world' });
    for (const a1 of ['A1', 'A2', 'A3', 'A4']) {
      expect(cell(a1).getAttribute('dir'), a1).toBe('rtl');
      expect(cell(a1).style.textAlign, a1).toBe('right');
    }
  });

  it('leaves left-to-right text, numbers and text that only ends in a right-to-left word as they were', () => {
    const { cell } = book({ A1: 'hello שלום', A2: '1500', A3: 'plain', A4: 'TRUE' });
    for (const a1 of ['A1', 'A2', 'A3', 'A4']) expect(cell(a1).getAttribute('dir'), a1).toBeNull();
    expect(cell('A1').style.textAlign).toBe('left');
    expect(cell('A2').style.textAlign).toBe('right');
    expect(cell('A4').style.textAlign).toBe('center');
  });

  it('keeps an alignment the cell was given, in the direction the text reads', () => {
    const { wb, id, cell } = book({ A1: 'שלום עולם', A2: 'שלום עולם' });
    wb.applyStyle(id, parseRange('A1:A1'), { align: 'left' });
    wb.applyStyle(id, parseRange('A2:A2'), { align: 'center' });
    expect(cell('A1').style.textAlign).toBe('left');
    expect(cell('A1').getAttribute('dir')).toBe('rtl');
    expect(cell('A2').style.textAlign).toBe('center');
    expect(cell('A2').getAttribute('dir')).toBe('rtl');
  });

  it('runs right-to-left labels into empty cells on their left', () => {
    const { cell } = book({ C1: 'שלום עולם ארוך מאוד שנמשך הלאה', A2: 'A long left-to-right label that spills' });
    expect(cell('C1').classList.contains('spill')).toBe(true);
    expect(cell('C1').querySelector('.print-cell').style.left).toBe('-200%');
    expect(cell('C1').querySelector('.print-cell').style.width).toBe('300%');
    expect(cell('A2').classList.contains('spill')).toBe(true);
  });

  it('shares the grid\'s rule for what reads right to left', () => {
    expect(readsRightToLeft('שלום')).toBe(true);
    expect(readsRightToLeft('  (12) مرحبا')).toBe(true);
    expect(readsRightToLeft('abc שלום')).toBe(false);
    expect(readsRightToLeft('123')).toBe(false);
    expect(readsRightToLeft(12)).toBe(false);
  });
});
