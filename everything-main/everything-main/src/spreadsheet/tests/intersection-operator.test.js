import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Workbook } from '../src/core/workbook.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { evaluate, isVolatile, withArrayBudget } from '../src/core/formula/evaluator.js';
import { astToText, evaluateParts } from '../src/core/formula/print.js';
import { freeNameTokens } from '../src/core/formula/names.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { formulaReachesOut } from '../src/core/reaches-out.js';
import { calc } from './helpers/calc.js';

const data = { A1: '1', B1: '2', C1: '3', A2: '11', B2: '12', C2: '13', A3: '21', B3: '22', C3: '23', A4: '31', B4: '32', C4: '33' };
const error = code => ({ error: code });
const native = JSON.parse(readFileSync(new URL('./fixtures/reference-reference-intersection.json', import.meta.url), 'utf8'));

it.each(native.cases)('matches the native worksheet control $formula', ({ formula, sumOrErrorCode }) => {
  // Match the capture's cell-reference probe, including SUM ignoring a logical
  // cell. The direct ISREF result is covered separately below.
  expect(calc('IFERROR(SUM(AH1),-1000-ERROR.TYPE(AH1))', { ...native.data, AH1: `=${formula}` })).toBe(sumOrErrorCode);
});

it.each([
  ['A1 B2', error('#NULL!')], ['A1 A1', 1], ['SUM(A1:C4 B2:D5)', 135],
  ['SUM(A1:C4  B2:D5)', 135], ['SUM(A1:C4\nB2:D5)', 135], ['SUM(A1:C4 \n B2:D5)', 135],
  ['SUM(A:C 2:3)', 102], ['SUM(2:3 A:C)', 102], ['SUM(A1:C4 B2:D5 C3:E6)', 56],
  ['SUM((A1:A3,C1:C3) A2:C2)', 24], ['AREAS((A1:A3,C1:C3) A2:C2)', 2],
  ['SUM((A1:A3,A2:A4) A2:A3)', 64], ['AREAS((A1:A3,A2:A4) A2:A3)', 2],
  ['SUM(A1:C4 (B2:D5,C3:E6))', 191], ['AREAS(A1:C4 (B2:D5,C3:E6))', 2],
  ['SUM((A1:A3,A2:A4) (A2:A3,A3:A5))', 137], ['AREAS((A1:A3,A2:A4) (A2:A3,A3:A5))', 4],
  ['SUM((A1:C4) (B2:D5))', 135], ['SUM((A1:C4 B2:D5,C3))', 158],
  ['ISREF(A1:A3 A2)', true], ['ROW(A1:C4 B2:D2)', 2], ['COLUMN(A1:C4 B2:B4)', 2],
  ['ROWS(A1:C4 B2:D5)', 3], ['COLUMNS(A1:C4 B2:D5)', 2],
  ['SUMPRODUCT(ROW(A1:C4 B2:D5)*100+COLUMN(A1:C4 B2:D5))', 1815],
  ['SUM(A1:A4 B2:C5)+1', error('#NULL!')], ['IFERROR(A1 B2,99)', 99],
  ['SUM(A1 : C4 B2:D5)', 135], ['SUM(A1:C4 B2 : D5)', 135],
  ['SUM(A1:C4 B2:D5:E6)', 135], ['SUM(A1:C4 (B2:D5):E6)', 135],
  ['SUM((A1:A3,C1:C3) B1:B3)', error('#NULL!')], ['AREAS((A1:A3,C1:C3) B1:B3)', error('#NULL!')],
  ['INDEX((A1:A3,C1:C3) A2:C2,1,1,2)', 13],
])('evaluates the reference intersection %s', (formula, expected) => {
  expect(calc(formula, data)).toEqual(expected);
});

it.each([
  'A1:INDEX(A1:C5,4,3)', 'OFFSET(A1,0,0,4,3)', 'INDIRECT("A1:C4")',
  'IF(TRUE,A1:C4,D5)', 'CHOOSE(1,A1:C4,D5)',
])('intersects a reference returned by %s', reference => {
  expect(calc(`SUM(${reference} B2:D5)`, data)).toBe(135);
});

it('retains addresses through LET, LAMBDA and INDEX selection', () => {
  expect(calc('SUM(LET(block,A1:C4,block B2:D5))', data)).toBe(135);
  expect(calc('SUM(LAMBDA(block,block B2:D5)(A1:C4))', data)).toBe(135);
  expect(calc('SUM(INDEX(A1:C4,0,2) B2:D5)', data)).toBe(66);
  expect(calc('SUM((A1 A1,A1 A1))', data)).toBe(2);
  expect(calc('SUM((A1,A1) (A1,A1))', data)).toBe(4);
});

it('preserves operator precedence and grouping when printed and reparsed', () => {
  for (const formula of ['SUM(A1:C4 B2:D5)', '(A1:C4 B2:D5):E6', 'A1:(B2 C3)', 'A1 (B2 C3)', 'A1 B2%', '-A1 B2', 'A1 B2+3', 'SUM((A1 B2,C3))']) {
    const ast = parseFormula(formula);
    expect(parseFormula(astToText(ast))).toEqual(ast);
  }
  expect(parseFormula('A1 B2%')).toMatchObject({ type: 'percent', arg: { type: 'intersection' } });
  expect(parseFormula('A1 B2:C3')).toMatchObject({ type: 'intersection', right: { type: 'ref', ref: { kind: 'range' } } });
  for (const gap of ['\t', '\r', '\r\n', ' \t', '\u00a0']) expect(() => parseFormula(`A1:A3${gap}B2:B4`), JSON.stringify(gap)).toThrow();
  expect(astToText(parseFormula('SUM ( A1 , B2 )'))).toBe('SUM(A1,B2)');
});

it('propagates bad references and rejects scalar or cross-sheet operands', () => {
  expect(calc('SUM(#REF! B2:D5)', data)).toEqual(error('#REF!'));
  expect(calc('SUM(SEQUENCE(3) A1:A3)', data)).toEqual(error('#VALUE!'));
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.addSheet('Other');
  for (const formula of ['Sheet1!A1 Other!A1', 'Sheet1:Other!A1 A1']) {
    wb.setInput(id, 5, 5, `=SUM(${formula})`);
    expect(wb.getValue(id, 5, 5)).toEqual(error('#VALUE!'));
  }
});

it('reads only intersecting cells and lets address-only consumers avoid all value reads', () => {
  const reads = [], ctx = { currentSheet: 'Data', sheetExists: () => true,
    getValue: (sheet, r, c) => { reads.push([sheet, r, c]); return 42; },
    getRangeValues: () => { throw new Error('Read a larger reference'); } };
  expect(evaluate(parseFormula('SUM(A1:XFD1048576 B7)'), ctx)).toBe(42);
  expect(reads).toEqual([['Data', 6, 1]]);
  reads.length = 0;
  for (const formula of ['ROWS(A:A A2:A3000)', 'ROW(A1:XFD1048576 B7)', 'AREAS((A1:A3,C1:C3) A2:C2)', 'ISREF(A1:XFD1048576 B7)', 'ROWS(INDEX(A1:XFD1048576,0,2) B7:B20)']) {
    expect(evaluate(parseFormula(formula), ctx)?.error, formula).toBeUndefined();
  }
  expect(reads).toEqual([]);
});

it('does not introduce false cycles through excluded cells', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7');
  for (const formula of ['SUM(A1:A2 A1)', 'SUM((A1:A2,A2:A3) A1)', 'SUM(INDEX(A1:A2,0) A1)', 'SUM(OFFSET(A1,0,0,2,1) A1)']) {
    wb.setInput(id, 1, 0, `=${formula}`);
    expect(wb.getValue(id, 1, 0), formula).toBe(7);
  }
});

it('tracks names, volatility and external calls inside intersecting operands', () => {
  const formula = 'LET(x,LeftBlock,SUM(x RightBlock))';
  expect(freeNameTokens(formula, tokenize(formula)).map(t => t.value)).toEqual(['LEFTBLOCK', 'RIGHTBLOCK']);
  expect(isVolatile(parseFormula('A1 INDEX(A1:A2,RANDBETWEEN(1,2))'))).toBe(true);
  expect(isVolatile(parseFormula('A1 INDEX(A1:A2,1)'))).toBe(false);
  expect(formulaReachesOut('A1 IMPORTDATA')).toBe(true);
  expect(formulaReachesOut('A1 INDIRECT(IMPORTDATA("https://example.test"))')).toBe(true);
  expect(evaluateParts('A1 A1', { currentSheet: 'Data', sheetExists: () => true, getValue: () => 3 }).parts.at(-1)).toMatchObject({ text: 'A1 A1', value: { range: true, ref: { r1: 0, c1: 0 } } });
});

it('bounds combinatorial area growth before reading any of the cells', () => {
  const ctx = { currentSheet: 'Data', sheetExists: () => true, getValue: () => { throw new Error('Read cell during address combination'); } };
  const formula = Array(18).fill('(A1,A1)').join(' ');
  expect(withArrayBudget(() => evaluate(parseFormula(formula), ctx))).toEqual(error('#NUM!'));
});

it('bounds repeated cell materialization while preserving address-only union queries', () => {
  let reads = 0;
  const grid = Array.from({ length: 1000 }, () => [1]);
  const ctx = { currentSheet: 'Data', sheetExists: () => true, getRangeValues: () => { reads++; return grid; } };
  const formula = Array(12).fill('(A1:A1000,A1:A1000)').join(' ');
  expect(withArrayBudget(() => evaluate(parseFormula(`AREAS(${formula})`), ctx))).toBe(4096);
  expect(reads).toBe(0);
  const value = withArrayBudget(() => {
    const result = evaluate(parseFormula(formula), ctx);
    // Exercise individual-area consumers too, rather than only the union's
    // flattened values, which SUM consumes.
    expect(result.areas.some(area => area.values[0][0]?.error === '#NUM!')).toBe(true);
    return result.values;
  });
  expect(value).toEqual([[error('#NUM!')]]);
  expect(reads).toBeLessThan(4096);
});

it('handles long intersection chains without recursive evaluation or name scanning', () => {
  const formula = Array(2000).fill('A1').join(' '), ast = parseFormula(formula);
  expect(calc(`SUM(${formula})`, { A1: '7' })).toBe(7);
  expect(astToText(ast)).toBe(formula);
  expect(isVolatile(ast)).toBe(false);
  const scoped = `LET(x,A1,SUM(${Array(4000).fill('x').join(' ')}))`;
  expect(freeNameTokens(scoped, tokenize(scoped))).toEqual([]);
  expect(astToText(parseFormula(scoped))).toBe(scoped.toUpperCase());
  expect(isVolatile(parseFormula(scoped))).toBe(false);
});
