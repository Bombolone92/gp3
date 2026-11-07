import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds, workbookToXlsx } from '../src/core/io.js';
import { fromFileFormula } from '../src/core/xlfn.js';

const writers = { ods: workbookToOds, xlsx: workbookToXlsx };
function setup(ref = 'SUM(Sales[@Value])', sheetName = 'Data') {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.renameSheet(id, sheetName);
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 0, 1, 'Price');
  wb.setInput(id, 1, 0, '10'); wb.setInput(id, 2, 0, '20');
  wb.setInput(id, 1, 1, '2'); wb.setInput(id, 2, 1, '3');
  const tid = wb.addTable(id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Sales' });
  expect(wb.defineName('Current', ref)).toBeNull();
  wb.setInput(id, 1, 3, '=Current'); wb.setInput(id, 2, 3, '=Current');
  return { wb, id, tid };
}

it.each(Object.keys(writers).flatMap((format) => [
  ['SUM(Sales[@Value])', [10, 20]],
  ['SUM(Sales[@])', [12, 23]],
  ['ROW(Sales[@Value])+COLUMN(Sales[@Value])', [3, 4]],
  ['SUM((Sales[@Value],Sales[@Price]))', [12, 23]],
  ['LET(ROW,LAMBDA(99),OFFSET,LAMBDA(99),SUM(Sales[@Value]))', [10, 20]],
  ['LET(_puter_rowref_1,5,_puter_rowref_1+SUM(Sales[@Value]))', [15, 25]],
  ['LAMBDA(ROW,SUM(Sales[@Value]))(99)', [10, 20]],
].map(([ref, expected]) => ({ format, ref, expected }))))(
  'exports $ref with the calling row intact in $format', async ({ format, ref, expected }) => {
    const { wb, id } = setup(ref), before = wb.toJSON();
    expect([wb.getValue(id, 1, 3), wb.getValue(id, 2, 3)]).toEqual(expected);
    const blob = await writers[format](wb), raw = X.read(await blob.arrayBuffer(), { type: 'array' });
    const exported = raw.Workbook.Names.find((n) => n.Name === 'Current').Ref;
    expect(exported).not.toContain('Sales[');
    expect(exported).toContain('OFFSET(');
    const reopened = await workbookFromFile(blob, `rows.${format}`), target = reopened.sheetByName('Data').id;
    expect([reopened.getValue(target, 1, 3), reopened.getValue(target, 2, 3)]).toEqual(expected);
    expect(wb.toJSON()).toEqual(before);
    expect(reopened.names).toHaveLength(1);
    if (format === 'xlsx') expect(reopened.names[0].ref).toBe(ref);
    reopened.setInput(target, 1, 3, '=IFERROR(Current,99)');
    reopened.setInput(target, 0, 3, '=Current');
    reopened.setInput(target, 3, 3, '=Current');
    expect(reopened.getValue(target, 0, 3)).toEqual({ error: '#VALUE!' });
    expect(reopened.getValue(target, 3, 3)).toEqual({ error: '#VALUE!' });
    const other = reopened.addSheet('Summary').id;
    reopened.setInput(other, 1, 3, '=Current');
    expect(reopened.getValue(other, 1, 3)).toEqual(expected[0]);
    // Evaluate the actual exported expression, without its original formula
    // from private metadata, on both the source sheet and a different sheet.
    reopened.defineName('NativeCurrent', fromFileFormula(exported));
    for (const sheetId of [target, other]) {
      for (let r = 0; r < 4; r++) reopened.setInput(sheetId, r, 4, '=NativeCurrent');
      expect([1, 2].map(r => reopened.getValue(sheetId, r, 4))).toEqual(expected);
      for (const r of [0, 3]) expect(reopened.getValue(sheetId, r, 4)).toEqual({ error: '#VALUE!' });
    }
  },
);

it.each(['Plan\'s data', 'A "B"', 'A & B'])('preserves source sheet identity for %s', async (name) => {
  const { wb } = setup(undefined, name);
  const reopened = await workbookFromFile(await workbookToOds(wb), 'quoted.ods');
  expect(reopened.getValue(reopened.sheetByName(name).id, 2, 3)).toBe(20);
});

it('does not read other data rows while resolving the current row', async () => {
  const { wb, id } = setup();
  wb.setInput(id, 2, 0, '=D2+10');
  expect(wb.getValue(id, 1, 3)).toBe(10);
  expect(wb.getValue(id, 2, 3)).toBe(20);
  const reopened = await workbookFromFile(await workbookToOds(wb), 'dependencies.ods');
  const target = reopened.sheetByName('Data').id;
  expect(reopened.getValue(target, 1, 3)).toBe(10);
  expect(reopened.getValue(target, 2, 0)).toBe(20);
  expect(reopened.getValue(target, 2, 3)).toBe(20);
  reopened.setInput(target, 1, 0, '40');
  expect(reopened.getValue(target, 1, 3)).toBe(40);
  expect(reopened.getValue(target, 2, 3)).toBe(50);
  reopened.undo();
  expect(reopened.getValue(target, 2, 3)).toBe(20);
});

it('does not evaluate an unused reference and introduce a circular dependency', async () => {
  const { wb, id } = setup('IF(FALSE,SUM(Sales[@Value]),7)');
  wb.setInput(id, 1, 0, '=A3+1'); wb.setInput(id, 2, 0, '=D2+1');
  const reopened = await workbookFromFile(await workbookToOds(wb), 'unused.ods'), target = reopened.sheetByName('Data').id;
  expect(reopened.getValue(target, 1, 3)).toBe(7);
  expect(reopened.getValue(target, 1, 0)).toBe(9);
  expect(reopened.getValue(target, 2, 0)).toBe(8);
});

it('retains totals-row references and restores table growth in XLSX', async () => {
  const { wb, id, tid } = setup();
  wb.setTableTotals(id, tid, true);
  wb.setInput(id, 3, 3, '=Current');
  const total = wb.getValue(id, 3, 3);
  const raw = X.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array' });
  wb.defineName('NativeCurrent', fromFileFormula(raw.Workbook.Names.find(n => n.Name === 'Current').Ref));
  wb.setInput(id, 3, 4, '=NativeCurrent');
  expect(wb.getValue(id, 3, 4)).toEqual(total);
  const ods = await workbookFromFile(await workbookToOds(wb), 'totals.ods');
  expect(ods.getValue(ods.sheetByName('Data').id, 3, 3)).toEqual(total);
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'growth.xlsx'), data = reopened.sheetByName('Data');
  reopened.addTableRow(data.id, data.tables[0].id);
  reopened.setInput(data.id, 3, 0, '50'); reopened.setInput(data.id, 3, 3, '=Current');
  expect(reopened.getValue(data.id, 3, 3)).toBe(50);
});

it('emits Excel function prefixes for the generated reference expression', async () => {
  const { wb } = setup();
  const raw = X.read(await (await workbookToXlsx(wb)).arrayBuffer(), { type: 'array' });
  const formula = raw.Workbook.Names.find((n) => n.Name === 'Current').Ref;
  expect(formula).toContain('_xlfn.LET(');
  expect(formula).toContain('_xlfn.LAMBDA(');
});

it('keeps ordinary value-producing calls invalid in a union', () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10'); wb.setInput(id, 0, 1, '20');
  wb.setInput(id, 0, 3, '=SUM((SUM(A1),B1))');
  expect(wb.getValue(id, 0, 3)).toEqual({ error: '#VALUE!' });
  wb.setInput(id, 0, 3, '=SUM((LAMBDA(A1)(),B1))');
  expect(wb.getValue(id, 0, 3)).toBe(30);
});
