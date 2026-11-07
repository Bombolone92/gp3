import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { extractFormula, describeSheet, sampleRange, dataBounds, formulaPrompt, explainPrompt, describeRange, askPrompt } from '../src/core/aiformula.js';

describe('AI formula helper', () => {
  it('reads a formula out of a reply however it is dressed', () => {
    expect(extractFormula('=SUM(A1:A5)')).toBe('=SUM(A1:A5)');
    expect(extractFormula('Here you go:\n```\n=SUMIF(B2:B9,"Rent",C2:C9)\n```')).toBe('=SUMIF(B2:B9,"Rent",C2:C9)');
    expect(extractFormula('Use `=AVERAGE(Sales[Amount])` for that.')).toBe('=AVERAGE(Sales[Amount])');
    expect(extractFormula('=IF(A1>0,"yes","no"). This checks A1.')).toBe('=IF(A1>0,"yes","no")');
    expect(extractFormula('= SUM(A1:A3)')).toBe('=SUM(A1:A3)');
    expect(extractFormula('=A1+B1')).toBe('=A1+B1');
    expect(extractFormula('I cannot help with that.')).toBeNull();
    expect(extractFormula('')).toBeNull();
  });

  it('cuts prose after the first complete formula and joins a formula wrapped over lines', () => {
    // Two formulas offered in one sentence: the first is the answer.
    expect(extractFormula('Use =SUMIF(A:A,"Rent",B:B) or =SUMIFS(B:B,A:A,"Rent")')).toBe('=SUMIF(A:A,"Rent",B:B)');
    expect(extractFormula('=SUMIF(A:A,"Rent",B:B) or =SUMIFS(B:B,A:A,"Rent")')).toBe('=SUMIF(A:A,"Rent",B:B)');
    // Dashes open a comment; a single operator carries the formula on.
    expect(extractFormula('=SUM(A1:A5) -- adds the values')).toBe('=SUM(A1:A5)');
    expect(extractFormula('=SUM(A1:A5) — adds the values')).toBe('=SUM(A1:A5)');
    expect(extractFormula('=SUM(A1:A5) - SUM(B1:B5)')).toBe('=SUM(A1:A5) - SUM(B1:B5)');
    // A single hyphen followed by two words in a row is prose too: no formula puts two names side by side.
    expect(extractFormula('=IF(A1>0,"y","n") - returns y when A1 is positive')).toBe('=IF(A1>0,"y","n")');
    expect(extractFormula('=SUM(A1:A5) - tax * 2')).toBe('=SUM(A1:A5) - tax * 2');
    expect(extractFormula('=SUM(A1:A5) - tax')).toBe('=SUM(A1:A5) - tax');
    expect(extractFormula('=SUM(A1:A5) - B1 - B2')).toBe('=SUM(A1:A5) - B1 - B2');
    expect(extractFormula('=SUM(A1:A5) - 1')).toBe('=SUM(A1:A5) - 1');
    expect(extractFormula('=SUM(A1:A5) + SUM(B1:B5). Adds both.')).toBe('=SUM(A1:A5) + SUM(B1:B5)');
    expect(extractFormula('=SUM(A1:A5)=SUM(B1:B5), which compares them')).toBe('=SUM(A1:A5)=SUM(B1:B5)');
    expect(extractFormula('=INDEX(A:A,1):INDEX(A:A,5) is the range')).toBe('=INDEX(A:A,1):INDEX(A:A,5)');
    expect(extractFormula('=SUM(A1:A5): this adds the values')).toBe('=SUM(A1:A5)');
    // Wrapped over lines, with or without prose after it.
    expect(extractFormula('=IF(A1>0,\n"yes",\n"no")')).toBe('=IF(A1>0,"yes","no")');
    expect(extractFormula('Here:\n=IF(A1>0,\n  "yes",\n  "no")\nThis checks A1.')).toBe('=IF(A1>0,"yes","no")');
    expect(extractFormula('Try =IF(A1>0,\n"yes",\n"no") there.')).toBe('=IF(A1>0,"yes","no")');
    // A sentence's closing punctuation is not part of a formula without parentheses.
    expect(extractFormula('=A1+B1.')).toBe('=A1+B1');
    expect(extractFormula('=A1+1.5.')).toBe('=A1+1.5');
    expect(extractFormula('=A1&"."')).toBe('=A1&"."');
    // A formula the model cut off is returned as it stands.
    expect(extractFormula('=IF(A1>0,\n"yes",')).toBe('=IF(A1>0,"yes",');
  });

  it('describes the sheet with headers, tables, and names for the prompt', () => {
    const wb = new Workbook({ sheets: [{ name: 'Data' }, { name: 'Notes' }] });
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Item'); wb.setInput(id, 0, 1, 'Qty'); wb.setInput(id, 1, 0, 'Pens'); wb.setInput(id, 1, 1, '10');
    wb.addTable(id, parseRange('A1:B2'), { name: 'Sales' });
    wb.defineName('Total', 'Data!$B$2');
    const text = describeSheet(wb, id, { r: 4, c: 3 });
    expect(text).toContain('Active cell: D5');
    expect(text).toContain('A1="Item"');
    expect(text).toContain('Table "Sales" with columns [Item], [Qty]');
    expect(text).toContain('Total = Data!$B$2');
    expect(text).toContain('"Notes"');
    expect(formulaPrompt('sum of qty', text)).toContain('Request: sum of qty');
    expect(explainPrompt('SUM(B2:B9)', text)).toContain('Formula: =SUM(B2:B9)');
  });

  // The description quoted three rows of cell values without the dialog being able to say so.
  it('names the sample rows it quotes, so the dialog can say what is sent', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    // A header row and six rows of data, fourteen columns wide (A1:N7).
    for (let c = 0; c < 14; c++) wb.setInput(id, 0, c, `H${c}`);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 14; c++) wb.setInput(id, r + 1, c, `${r}-${c}`);
    expect(sampleRange(wb, id)).toEqual({ r1: 1, c1: 0, r2: 3, c2: 10 });
    const text = describeSheet(wb, id, { r: 0, c: 0 });
    expect(text).toContain('Row 2: 0-0 | 0-1 |');
    expect(text).toMatch(/^Row 4: 2-0 \| .* \| 2-10$/m);
    expect(text).not.toContain('0-11');
    expect(text).not.toContain('Row 5:');
    // Only a header row: nothing to sample, and nothing quoted.
    const one = new Workbook();
    one.setInput(one.sheets[0].id, 0, 0, 'Item');
    expect(sampleRange(one, one.sheets[0].id)).toBeNull();
    expect(describeSheet(one, one.sheets[0].id, { r: 0, c: 0 })).not.toContain('Row ');
  });

  // A table starting at C2 was described from A1: no headers, "Data occupies A1:D4",
  // and its header row quoted as the first sample row.
  it('describes the data from its first cell rather than from A1', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 1, 2, 'Item'); wb.setInput(id, 1, 3, 'Qty');
    wb.setInput(id, 2, 2, 'Pen'); wb.setInput(id, 2, 3, '3');
    wb.setInput(id, 3, 2, 'Ink'); wb.setInput(id, 3, 3, '5');
    expect(dataBounds(wb, id)).toEqual({ r1: 1, c1: 2, r2: 3, c2: 3 });
    expect(sampleRange(wb, id)).toEqual({ r1: 2, c1: 2, r2: 3, c2: 3 });
    const text = describeSheet(wb, id, { r: 5, c: 2 });
    expect(text).toContain('First row of the data (likely headers): C2="Item", D2="Qty".');
    expect(text).toContain('Data occupies C2:D4.');
    expect(text).toContain('Row 3: Pen | 3');
    expect(text).not.toContain('Row 2:');
    const empty = new Workbook();
    expect(dataBounds(empty, empty.sheets[0].id)).toBeNull();
  });
});

describe('asking about data', () => {
  it('describes the selected cells as shown, capped, and builds the question prompt', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'Item'); wb.setInput(id, 0, 1, 'Price');
    wb.setInput(id, 1, 0, 'Pen'); wb.setInput(id, 1, 1, '$2.50');
    wb.setInput(id, 2, 0, 'Book'); wb.setInput(id, 2, 1, '=B2*4');
    const text = describeRange(wb, id, parseRange('A1:B3'));
    expect(text).toContain('Cells A1:B3');
    expect(text).toContain('1\tItem\tPrice');
    expect(text).toContain('3\tBook\t$10.00');
    expect(text).not.toContain('=B2*4');
    const capped = describeRange(wb, id, parseRange('A1:Z200'), { maxRows: 2, maxCols: 2 });
    expect(capped).toContain('198 more rows and 24 more columns not shown');
    const prompt = askPrompt('Which is dearest?', 'ctx', text);
    expect(prompt).toContain('Question: Which is dearest?');
    expect(prompt.indexOf('ctx')).toBeLessThan(prompt.indexOf('Cells A1:B3'));
  });
});
