import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';

function setup(kind = 'named') {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10');
  wb.setInput(id, 2, 0, '=D2+10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Sales' });
  wb.defineName('Current', 'SUM(Sales[@Value])');
  wb.setInput(id, 1, 3, kind === 'named' ? '=Current' : '=LAMBDA(A2)()');
  wb.setInput(id, 2, 3, kind === 'named' ? '=Current' : '=LAMBDA(A3)()');
  return { wb, id };
}

it.each(['named', 'lambda'].flatMap((kind) => ['source', 'first', 'second', 'range', 'used'].map((read) => ({ kind, read }))))(
  'does not manufacture a cycle for $kind formulas when $read is read first', ({ kind, read }) => {
    const { wb, id } = setup(kind);
    if (read === 'source') expect(wb.getValue(id, 2, 0)).toBe(20);
    else if (read === 'first') expect(wb.getValue(id, 1, 3)).toBe(10);
    else if (read === 'second') expect(wb.getValue(id, 2, 3)).toBe(20);
    else if (read === 'range') expect(wb.rangeValues(id, { r1: 2, c1: 0, r2: 2, c2: 3 })[0]).toEqual([20, null, null, 20]);
    else wb.usedRange(id);
    expect(wb.getValue(id, 1, 3)).toBe(10);
    expect(wb.getValue(id, 2, 0)).toBe(20);
    expect(wb.getValue(id, 2, 3)).toBe(20);
    wb.setInput(id, 1, 0, '40');
    expect(wb.getValue(id, 2, 0)).toBe(50);
    expect(wb.getValue(id, 2, 3)).toBe(50);
    wb.undo();
    expect(wb.getValue(id, 2, 0)).toBe(20);
    expect(wb.getValue(id, 2, 3)).toBe(20);
  },
);

it.each([['xlsx', workbookToXlsx], ['ods', workbookToOds]])('exports correct cached results without warming the workbook first (%s)', async (format, write) => {
  const { wb, id } = setup();
  const opened = await workbookFromFile(await write(wb), `cycles.${format}`);
  expect(wb.getValue(id, 2, 3)).toBe(20);
  expect(opened.getValue(opened.activeSheetId, 2, 0)).toBe(20);
  expect(opened.getValue(opened.activeSheetId, 2, 3)).toBe(20);
});

it('retries an array and publishes its spill after the outer scalar calculation finishes', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=B1+10');
  wb.setInput(id, 0, 1, '=LAMBDA(2)()');
  wb.setInput(id, 0, 3, '=SEQUENCE(2,1,A1)');
  expect(wb.getValue(id, 0, 0)).toBe(12);
  expect(wb.getValue(id, 0, 3)).toBe(12);
  expect(wb.getValue(id, 1, 3)).toBe(13);
  expect(wb.spillRangeAt(id, 0, 3)).toMatchObject({ r1: 0, c1: 3, r2: 1, c2: 3 });
});

it('does not cache IFERROR fallback results from a temporary cycle', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=B1+10');
  wb.setInput(id, 0, 1, '=LAMBDA(2)()');
  wb.setInput(id, 0, 3, '=IFERROR(SEQUENCE(2,1,A1),99)');
  expect(wb.getValue(id, 0, 0)).toBe(12);
  expect(wb.getValue(id, 0, 3)).toBe(12);
  expect(wb.getValue(id, 1, 3)).toBe(13);
});

it('settles a cross-sheet spill without caching the cycle caused by prefetching its dependent', () => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Other').id;
  wb.setInput(id, 0, 0, '=Other!A1+10');
  wb.setInput(other, 0, 0, '=LAMBDA(2)()');
  wb.setInput(other, 0, 2, '=SEQUENCE(2,1,Sheet1!A1)');
  expect(wb.getValue(id, 0, 0)).toBe(12);
  expect(wb.getValue(other, 0, 2)).toBe(12);
  expect(wb.getValue(other, 1, 2)).toBe(13);
});

it.each([false, true])('still detects real circular references (cross-sheet=%s)', (crossSheet) => {
  const wb = new Workbook(), id = wb.activeSheetId;
  const other = crossSheet ? wb.addSheet('Other').id : id;
  wb.setInput(id, 0, 0, crossSheet ? '=Other!B1+1' : '=B1+1');
  wb.setInput(other, 0, 1, '=LAMBDA(Sheet1!A1)()');
  expect(wb.getValue(id, 0, 0)).toEqual({ error: '#CYCLE!' });
  expect(wb.getValue(other, 0, 1)).toEqual({ error: '#CYCLE!' });
  wb.setInput(other, 0, 1, '5');
  expect(wb.getValue(id, 0, 0)).toBe(6);
});

it('settles deferred spill dependencies across a chain of sheets', () => {
  const wb = new Workbook(), sheets = [wb.activeSheet];
  for (let i = 1; i < 8; i++) sheets.push(wb.addSheet(`Chain${i + 1}`));
  for (let i = 0; i < sheets.length; i++) {
    const next = sheets[i + 1];
    wb.setInput(sheets[i].id, 0, 0, next ? `=LAMBDA('${next.name}'!A1+1)()` : '=LAMBDA(1)()');
    wb.setInput(sheets[i].id, 0, 2, `=SEQUENCE(2,1,Sheet1!A1+${i})`);
  }
  expect(wb.getValue(sheets[0].id, 0, 0)).toBe(8);
  for (let i = 0; i < sheets.length; i++) {
    expect(wb.getValue(sheets[i].id, 0, 0)).toBe(8 - i);
    expect(wb.getValue(sheets[i].id, 0, 2)).toBe(8 + i);
    expect(wb.getValue(sheets[i].id, 1, 2)).toBe(9 + i);
  }
});

it('discards temporary fallback spill extents when retrying', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=B1+10');
  wb.setInput(id, 0, 1, '=LAMBDA(2)()');
  wb.setInput(id, 0, 3, '=IFERROR(SEQUENCE(2,1,A1),SEQUENCE(4,1,99))');
  expect(wb.getValue(id, 0, 0)).toBe(12);
  expect(wb.getValue(id, 0, 3)).toBe(12);
  expect(wb.getValue(id, 1, 3)).toBe(13);
  expect(wb.getValue(id, 2, 3)).toBeNull();
  expect(wb.getValue(id, 3, 3)).toBeNull();
  expect(wb.usedRange(id).r2).toBe(1);
});
