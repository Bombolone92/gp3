import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const sources = ['INDIRECT("B2#")', 'INDIRECT("Sheet1!$B$2#")', 'INDIRECT("Spilled")', 'INDIRECT("Spilled",FALSE)'];
function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('Spilled', 'Sheet1!B2#');
  const calc = (formula) => { wb.setInput(id, 9, 9, `=${formula}`); return wb.getValue(id, 9, 9); };
  return { wb, id, calc };
}

it.each(sources)('reads the full spill and its address through %s', (source) => {
  const { wb, id, calc } = setup();
  wb.setInput(id, 1, 1, '=SEQUENCE(3,2)');
  expect(calc(`SUM(${source})`)).toBe(21);
  expect(calc(`ROWS(${source})`)).toBe(3);
  expect(calc(`COLUMNS(${source})`)).toBe(2);
  expect(calc(`ROW(INDEX(${source},3,2))`)).toBe(4);
  expect(calc(`COLUMN(INDEX(${source},3,2))`)).toBe(3);
  expect(calc(`ISREF(${source})`)).toBe(true);
});

it.each(sources)('follows spill growth, shrinking, and undo through %s', (source) => {
  const { wb, id, calc } = setup();
  wb.setInput(id, 1, 1, '=SEQUENCE(3)');
  expect(calc(`SUM(${source})`)).toBe(6);
  wb.setInput(id, 1, 1, '=SEQUENCE(5)');
  expect(wb.getValue(id, 9, 9)).toBe(15);
  wb.undo();
  expect(wb.getValue(id, 9, 9)).toBe(6);
  wb.setInput(id, 1, 1, '=SEQUENCE(2)');
  expect(wb.getValue(id, 9, 9)).toBe(3);
});

it.each(sources.flatMap((source) => ['empty', 'scalar', 'blocked'].map((kind) => ({ source, kind }))))
  ('rejects $source when the anchor is $kind', ({ source, kind }) => {
    const { wb, id, calc } = setup();
    if (kind === 'scalar') wb.setInput(id, 1, 1, '42');
    if (kind === 'blocked') {
      wb.setInput(id, 1, 1, '=SEQUENCE(3)');
      wb.setInput(id, 2, 1, 'occupied');
    }
    expect(calc(`SUM(${source})`)).toEqual({ error: '#REF!' });
  });

it.each(['B2:C3#', 'B:B#', '2:3#', 'Sheet1:Sheet2!B2#', 'B2##', 'Missing!B2#'])
  ('rejects malformed or unresolved spill text %s', (text) => {
    const { wb, id, calc } = setup();
    wb.setInput(id, 1, 1, '=SEQUENCE(3,2)');
    expect(calc(`SUM(INDIRECT("${text}"))`)).toEqual({ error: '#REF!' });
  });

it('discovers cross-sheet spills before reading their anchors, including escaped sheet names', () => {
  const { wb, id } = setup();
  const other = wb.addSheet("Source's Data").id;
  wb.setInput(other, 1, 1, '=SEQUENCE(3,2)');
  wb.setInput(id, 0, 0, '=INDIRECT("\'Source\'\'s Data\'!B2#")');
  expect(wb.getValue(id, 2, 1)).toBe(6);
  expect(wb.getValue(id, 0, 0)).toBe(1);
});

it('keeps spill-cell errors and blanks while retaining ordinary anchor references', () => {
  const { wb, id, calc } = setup();
  wb.setInput(id, 1, 1, '={1,#N/A;"",TRUE}');
  expect(calc('INDEX(INDIRECT("B2#"),1,2)')).toEqual({ error: '#N/A' });
  expect(calc('INDEX(INDIRECT("B2#"),2,1)')).toBe('');
  expect(calc('INDEX(INDIRECT("B2#"),2,2)')).toBe(true);
  expect(calc('INDIRECT("B2")')).toBe(1);
  expect(calc('SUM(INDIRECT("B2:C3"))')).toEqual({ error: '#N/A' });
});

it('retains indirect spill references after XLSX reopening', async () => {
  let { wb, id, calc } = setup();
  wb.setInput(id, 1, 1, '=SEQUENCE(3)');
  expect(calc('SUM(INDIRECT("B2#"))+SUM(INDIRECT("Spilled"))')).toBe(12);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'indirect-spill.xlsx');
  expect(wb.getValue(wb.sheets[0].id, 9, 9)).toBe(12);
});
