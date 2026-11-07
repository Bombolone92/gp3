// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildPrintTable } from '../src/ui/print.js';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef, parseRange } from '../src/core/cell.js';

function book(cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  const cell = (a1) => {
    const { r, c } = parseCellRef(a1);
    return [...buildPrintTable(wb, id).querySelectorAll('tbody tr')][r].children[c];
  };
  return { wb, id, cell };
}

describe('print shows what the grid shows', () => {
  it('paints a rule fill on blank cells the rule covers', () => {
    const { wb, id, cell } = book({ A1: 'x', C3: 'y' });
    wb.addRule(id, { type: 'formula', value: '=TRUE', range: parseRange('A1:B2'), style: { bg: '#00ff00' } });
    expect(cell('B2').style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(cell('C2').style.backgroundColor).toBe('');
    expect(cell('B2').textContent).toBe('');
  });

  it('paints data bars to the value\'s share of the cell', () => {
    const { wb, id, cell } = book({ A1: '10', A2: '20', A3: '40' });
    wb.addRule(id, { type: 'databar', barColor: '#ff0000', range: parseRange('A1:A3') });
    expect(cell('A1').getAttribute('style')).toMatch(/linear-gradient\(to right, (?:#ff0000|rgb\(255, 0, 0\)) 25(?:\.0)?%, transparent 25(?:\.0)?%\)/);
    expect(cell('A3').getAttribute('style')).toMatch(/linear-gradient\(to right, (?:#ff0000|rgb\(255, 0, 0\)) 100(?:\.0)?%, transparent 100(?:\.0)?%\)/);
    expect(cell('A3').textContent).toBe('40');
  });

  it('draws a sparkline cell as its chart', () => {
    const { cell } = book({ B1: '1', B2: '3', B3: '2', B4: '5', A1: '=SPARKLINE(B1:B4)' });
    const td = cell('A1');
    expect(td.querySelector('svg')).not.toBeNull();
    expect(td.textContent).toBe('');
    expect(td.classList.contains('sparkline')).toBe(true);
  });

  it('paints a cell\'s own fill over its table\'s header, band and totals coat, and a rule\'s fill over both', () => {
    const { wb, id, cell } = book({ A1: 'Name', B1: 'Qty', A2: 'a', B2: '1', A3: 'b', B3: '2', A4: 'c', B4: '3' });
    wb.addTable(id, parseRange('A1:B4'), { name: 'T', style: 'blue', banded: true, totalsRow: true });
    wb.applyStyle(id, parseRange('A1:A4'), { bg: '#ff0000' });
    expect(cell('A1').style.backgroundColor).toBe('rgb(255, 0, 0)'); // header
    expect(cell('A2').style.backgroundColor).toBe('rgb(255, 0, 0)'); // banded data row
    expect(cell('A4').style.backgroundColor).toBe('rgb(255, 0, 0)'); // totals row
    expect(cell('B1').style.backgroundColor).toBe('rgb(68, 114, 196)'); // the coat where there is no own fill
    expect(cell('B2').style.backgroundColor).toBe('rgb(217, 225, 242)');
    wb.addRule(id, { type: 'formula', value: '=TRUE', range: parseRange('A2:B2'), style: { bg: '#00ff00' } });
    expect(cell('A2').style.backgroundColor).toBe('rgb(0, 255, 0)');
    expect(cell('B2').style.backgroundColor).toBe('rgb(0, 255, 0)');
  });

  it('leaves hidden zeros blank', () => {
    const { wb, id, cell } = book({ A1: '0', A2: '5', A3: '=A1*2' });
    expect(cell('A1').textContent).toBe('0');
    wb.setZeros(id, false);
    expect(cell('A1').textContent).toBe('');
    expect(cell('A3').textContent).toBe('');
    expect(cell('A2').textContent).toBe('5');
  });

  it('lets a left-aligned label run over the empty cells to its right', () => {
    const { wb, id, cell } = book({ A1: 'A very long label that will not fit its column', D1: 'x', A2: 'Short', B2: 'y', A3: '123456789012345678', A4: 'Right aligned', C4: 'z' });
    wb.setColWidth(id, 1, 60);
    wb.applyStyle(id, parseRange('A4:A4'), { align: 'right' });
    const a1 = cell('A1');
    expect(a1.classList.contains('spill')).toBe(true);
    const span = a1.querySelector('span');
    expect(span.textContent).toBe('A very long label that will not fit its column');
    // Its own 100px column plus the empty 60px and 100px ones beside it.
    expect(span.style.width).toBe('260%');
    expect(cell('A2').classList.contains('spill')).toBe(false); // the neighbour holds a value
    expect(cell('A3').classList.contains('spill')).toBe(false); // numbers never spill
    expect(cell('A4').classList.contains('spill')).toBe(false); // nor right-aligned text
  });

  it('does not spill over a merge, a spilled array, or a wrapped cell', () => {
    const { wb, id, cell } = book({ A1: 'A long label that could spill', A2: 'Another long label here', C2: '={1,2}', A3: 'Wrapped long label text here' });
    wb.mergeCells(id, parseRange('B1:C1'));
    wb.applyStyle(id, parseRange('A3:A3'), { wrap: true });
    expect(cell('A1').classList.contains('spill')).toBe(false);
    expect(cell('A2').classList.contains('spill')).toBe(true);
    expect(cell('A2').querySelector('span').style.width).toBe('200%'); // stops before the array's cells
    expect(cell('A3').classList.contains('spill')).toBe(false);
  });
});
