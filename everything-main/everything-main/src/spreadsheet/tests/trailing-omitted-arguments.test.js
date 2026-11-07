import { expect, it } from 'vitest';
import { parseFormula } from '../src/core/formula/parser.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['call', 'apply'].flatMap((kind) => [['', []], [',', ['empty', 'empty']],
  ['1,', ['num', 'empty']], [',,', ['empty', 'empty', 'empty']], ['1,,', ['num', 'empty', 'empty']],
  [',1,', ['empty', 'num', 'empty']], ['1;2;', ['num', 'num', 'empty']]]
  .map(([args, types]) => ({ kind, args, types }))))('parses $kind argument slots ($args)', ({ kind, args, types }) => {
    const prefix = kind === 'call' ? 'Example' : 'LAMBDA(x,x)';
    const ast = parseFormula(`${prefix}(${args})`);
    expect(ast.type).toBe(kind);
    expect(ast.args.map((arg) => arg.type)).toEqual(types);
  });

it.each([
  ['SUM(1,)', 1], ['SUM(,)', 0], ['ROUND(1.75,)', 2], ['ADDRESS(2,3,,)', '$C$2'],
  ['LAMBDA(x,y,ISOMITTED(y))(1,)', true],
  ['LET(fn,LAMBDA(x,y,z,ISOMITTED(z)),fn(1,2,))', true],
  ['LET(fn,LAMBDA(x,y,z,ISOMITTED(x)+2*ISOMITTED(y)+4*ISOMITTED(z)),fn(,,))', 7],
  // An empty range_lookup is FALSE: the match is exact, so 2.5 is not found.
  ['LET(fn,VLOOKUP,fn(2.5,{1,10;2,20;3,30},2,))', { error: '#N/A' }],
  ['LET(fn,VLOOKUP,fn(2,{1,10;2,20;3,30},2,))', 20],
  ['SUM(ROUND(1.75,),ROUND(2.25,),)', 4],
])('evaluates %s with trailing omissions', (formula, expected) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, `=${formula}`);
  expect(wb.getValue(id, 0, 0)).toEqual(expected);
});

it('keeps named lambda defaults after XLSX reopening', async () => {
  let wb = new Workbook();
  wb.defineName('WithDefault', '=LAMBDA(x,y,IF(ISOMITTED(y),x+10,x+y))');
  wb.setInput(wb.activeSheetId, 0, 0, '=WithDefault(2,)');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(12);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'omitted.xlsx');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(12);
});

it.each(['SUM(1,', 'SUM(1,,', 'SUM(1,,+)', 'LAMBDA(x,x)(1,', 'SUM(1,)2', 'SUM(1 2,)'])
  ('still rejects malformed syntax %s', (formula) => {
    expect(() => parseFormula(formula)).toThrow();
  });
