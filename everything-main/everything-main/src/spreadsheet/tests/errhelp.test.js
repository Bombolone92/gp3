import { describe, it, expect } from 'vitest';
import { editDistance, closestName, explainError } from '../src/core/errhelp.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

describe('name suggestions', () => {
  it('measures edit distance and finds the closest name', () => {
    expect(editDistance('SUMM', 'SUM')).toBe(1);
    expect(editDistance('vlokup', 'VLOOKUP')).toBe(1);
    expect(closestName('SUMM', ['SUM', 'SUMIF'])).toBe('SUM');
    expect(closestName('VLOKUP', ['VLOOKUP', 'HLOOKUP'])).toBe('VLOOKUP');
    expect(closestName('AVG', ['AVERAGE', 'AVEDEV'])).toBe('AVERAGE'); // an alias
    expect(closestName('SUMPROD', ['SUMPRODUCT', 'SUM'])).toBe('SUMPRODUCT'); // a prefix
    expect(closestName('totl', ['Total', 'Tax'])).toBe('Total');
    expect(closestName('XYZZY', ['SUM', 'MAX'])).toBeNull();
    expect(closestName('IF', ['IFS', 'IFERROR'])).toBe('IFS');
  });

  it('explains a #NAME? with the misspelled function or name and a suggestion', () => {
    const lookup = { names: ['Total', 'Rate'], tables: ['Sales'], hasSheet: () => true };
    expect(explainError('#NAME?', 'SUMM(A1:A3)', lookup)).toBe('#NAME?: There is no function called SUMM. Did you mean SUM?');
    expect(explainError('#NAME?', 'Sum(A1)+Vlokup(1,A1:B2,2)', lookup)).toBe('#NAME?: There is no function called Vlokup. Did you mean VLOOKUP?');
    expect(explainError('#NAME?', 'A1*Totl', lookup)).toBe('#NAME?: Totl is not a named range, table, or function. Did you mean Total?');
    expect(explainError('#NAME?', 'SUM(Sale[Amount])+Hello', lookup)).toMatch(/Hello is not a named range/);
    expect(explainError('#NAME?', 'Hello', lookup)).toBe('#NAME?: Hello is not a named range, table, or function. Text needs quotes: "…".');
    expect(explainError('#NAME?', 'Sumx', lookup)).toBe('#NAME?: Sumx is not a named range. Did you mean the function SUM()?');
    expect(explainError('#CALC!', 'sum', lookup)).toBe('#CALC!: sum is a function: call it with parentheses, as in SUM(…).');
    expect(explainError('#CALC!', 'LAMBDA(x, x)', lookup)).toMatch(/^#CALC!: The calculation produced/);
    expect(explainError('#NAME?', 'XYZZY(1)', lookup)).toBe('#NAME?: There is no function called XYZZY.');
    // LET and LAMBDA bindings are not unknown names.
    expect(explainError('#NAME?', 'LET(x, 1, y, 2, x+y+SUMM(x))', lookup)).toBe('#NAME?: There is no function called SUMM. Did you mean SUM?');
    expect(explainError('#NAME?', 'LAMBDA(a, b, a+b+Totl)(1, 2)', lookup)).toMatch(/Totl is not a named range/);
    // Nothing specific to say: the generic text.
    expect(explainError('#NAME?', 'SUM(Total)', lookup)).toMatch(/^#NAME\?: Unknown function or name/);
    expect(explainError('#NAME?', null, lookup)).toMatch(/^#NAME\?: Unknown/);
    expect(explainError('#DIV/0!', 'SUMM(1)', lookup)).toMatch(/^#DIV\/0!: Division by zero/);
  });

  it('names the missing sheet behind a #REF!', () => {
    const lookup = { names: [], tables: [], hasSheet: (n) => n === 'Data' };
    expect(explainError('#REF!', 'Nope!A1+Data!A1', lookup)).toBe('#REF!: There is no sheet named "Nope". It may have been renamed or deleted.');
    expect(explainError('#REF!', 'SUM(Data:Gone!A1)', lookup)).toMatch(/no sheet named "Gone"/);
    expect(explainError('#REF!', 'Data!A1', lookup)).toMatch(/^#REF!: A reference points/);
  });

  it('is read from the cell by the workbook, spilled cells included', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.defineName('Total', 'Sheet1!$B$1');
    wb.setInput(id, 0, 0, '=SUMM(1,2)');
    wb.setInput(id, 1, 0, '=Totl*2');
    wb.setInput(id, 2, 0, '=Nope!A1');
    wb.setInput(id, 3, 0, '=1/0');
    wb.setInput(id, 4, 0, '7');
    wb.setInput(id, 5, 0, '=SEQUENCE(2)+SUMM(1)');
    wb.addTable(id, parseRange('D1:D2'), { name: 'Sales' });
    expect(wb.errorHelpAt(id, 0, 0)).toBe('#NAME?: There is no function called SUMM. Did you mean SUM?');
    expect(wb.errorHelpAt(id, 1, 0)).toBe('#NAME?: Totl is not a named range, table, or function. Did you mean Total?');
    expect(wb.errorHelpAt(id, 2, 0)).toMatch(/no sheet named "Nope"/);
    expect(wb.errorHelpAt(id, 3, 0)).toMatch(/^#DIV\/0!/);
    expect(wb.errorHelpAt(id, 4, 0)).toBeNull();
    expect(wb.errorHelpAt(id, 5, 0)).toMatch(/SUMM/);
  });
});
