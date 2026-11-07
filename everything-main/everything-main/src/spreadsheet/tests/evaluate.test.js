import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { astToText, evaluateParts, describeValue } from '../src/core/formula/print.js';

describe('formula printing and step evaluation', () => {
  it('prints an AST back to text, keeping precedence honest', () => {
    for (const f of ['SUM(A1:A5)*2', 'IF(A1>0,"yes","no")', '(1+2)*3', '-A1^2', 'Sales[Amount]', '[@Qty]*[@Price]', 'A1#', '{1,2;3,4}', 'LAMBDA(X,X+1)(4)', '10%', 'Sheet2!A1&" "&B1']) {
      expect(astToText(parseFormula(f))).toBe(f);
    }
  });

  it('lists each part with its value, innermost first', () => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const put = (a1, t) => { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, t); };
    put('A1', '2'); put('A2', '3'); put('B1', '=SUM(A1:A2)*IF(A1>1,10,1)');
    const { error, parts } = evaluateParts(wb.getCell(id, 0, 1).f, wb.contextFor(id, 0, 1));
    expect(error).toBeNull();
    const byText = Object.fromEntries(parts.map((p) => [p.text, p.value]));
    expect(byText['A1:A2']).toMatchObject({ range: true });
    expect(byText['SUM(A1:A2)']).toBe(5);
    expect(byText['A1>1']).toBe(true);
    expect(byText['IF(A1>1,10,1)']).toBe(10);
    expect(parts.at(-1)).toMatchObject({ depth: 0, text: 'SUM(A1:A2)*IF(A1>1,10,1)', value: 50 });
    expect(describeValue(byText['A1:A2'])).toBe('2\n3');
    expect(describeValue('x')).toBe('"x"');
    expect(describeValue({ error: '#DIV/0!' })).toBe('#DIV/0!');
    expect(describeValue(null)).toBe('(blank)');
    expect(evaluateParts('SUM(', wb.contextFor(id, 0, 1)).error).toBeTruthy();
  });
});
