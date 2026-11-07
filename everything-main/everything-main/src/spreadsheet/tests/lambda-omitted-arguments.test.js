import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each(['local', 'named'].flatMap((kind) => [
  [',1,2', 1], ['1,,2', 2], [',,', 7],
  ['A1,1,2', 0], ['"",1,2', 0], ['0,1,2', 0], ['FALSE,1,2', 0],
].map(([args, expected]) => ({ kind, args, expected }))))('detects omissions in $kind call ($args)', ({ kind, args, expected }) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const lambda = 'LAMBDA(x,y,z,ISOMITTED(x)+2*ISOMITTED(y)+4*ISOMITTED(z))';
  if (kind === 'named') wb.defineName('Flags', `=${lambda}`);
  const formula = kind === 'local' ? `LET(fn,${lambda},fn(${args}))` : `Flags(${args})`;
  wb.setInput(id, 5, 5, `=${formula}`);
  expect(wb.getValue(id, 5, 5)).toBe(expected);
});

it('keeps native-function defaults when calling built-ins through a local binding', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=LET(fn,ADDRESS,fn(2,3,,FALSE))');
  expect(wb.getValue(id, 0, 0)).toBe('R2C3');
});

it('retains defaults through a captured local lambda and XLSX reopening of a named lambda', async () => {
  let wb = new Workbook();
  const id = wb.activeSheetId;
  const lambda = 'LAMBDA(x,y,IF(ISOMITTED(x),y+10,x+y))';
  wb.defineName('WithDefault', `=${lambda}`);
  wb.setInput(id, 0, 0, '=WithDefault(,2)');
  wb.setInput(id, 0, 1, `=LET(fn,${lambda},wrapper,LAMBDA(fn(,2)),wrapper())`);
  expect(wb.getValue(id, 0, 0)).toBe(12);
  expect(wb.getValue(id, 0, 1)).toBe(12);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'optional.xlsx');
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe(12);
  expect(wb.getValue(wb.activeSheetId, 0, 1)).toBe(12);
});
