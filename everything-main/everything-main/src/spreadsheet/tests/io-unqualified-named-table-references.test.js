import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookToOds, workbookToXlsx, workbookFromFile } from '../src/core/io.js';

const writers = { ods: workbookToOds, xlsx: workbookToXlsx };
function setup(formula) {
  const wb = new Workbook(), first = wb.activeSheetId, other = wb.addSheet('Other').id;
  const cases = [
    { id: first, r: 0, c: 0, values: [10, 20], name: 'Sales' },
    { id: first, r: 4, c: 3, values: [100, 200], name: 'Orders' },
    { id: other, r: 0, c: 0, values: [7, 8], name: 'Remote' },
  ];
  wb.defineName('Current', formula);
  for (const item of cases) {
    const { id, r, c, values, name } = item;
    wb.setInput(id, r, c, 'Value'); wb.setInput(id, r, c + 1, 'Result');
    for (let i = 0; i < values.length; i++) wb.setInput(id, r + 1 + i, c, String(values[i]));
    item.tid = wb.addTable(id, { r1: r, c1: c, r2: r + 2, c2: c + 1 }, { name });
    wb.setInput(id, r + 1, c + 1, '=Current');
  }
  return { wb, first, other, cases };
}

it.each(Object.keys(writers).flatMap((format) => [
  ['SUM([Value])', [[30, 30], [300, 300], [15, 15]]],
  ['SUM([@Value])', [[10, 20], [100, 200], [7, 8]]],
  ['COUNTA([#Headers])', [[2, 2], [2, 2], [2, 2]]],
  ['COLUMN([[#Headers],[Value]])', [[1, 1], [4, 4], [1, 1]]],
  ['LAMBDA([Value],IF(ISOMITTED(Value),SUM([@Value]),Value))()', [[10, 20], [100, 200], [7, 8]]],
  ['LAMBDA([_puter_rowref_1],SUM([@Value]))()', [[10, 20], [100, 200], [7, 8]]],
  ['LET(LAMBDA,LAMBDA(x,SUM(x)),LAMBDA([Value]))', [[30, 30], [300, 300], [15, 15]]],
].map(([formula, expected]) => ({ format, formula, expected }))))(
  'preserves calling-table selection for $formula in $format', async ({ format, formula, expected }) => {
    const { wb, cases } = setup(formula), before = wb.toJSON();
    for (const [i, item] of cases.entries()) {
      expect([1, 2].map((dr) => wb.getValue(item.id, item.r + dr, item.c + 1))).toEqual(expected[i]);
    }
    const blob = await writers[format](wb), raw = X.read(await blob.arrayBuffer(), { type: 'array' });
    const ref = raw.Workbook.Names.find((n) => n.Name === 'Current').Ref;
    expect(ref).not.toContain('SUM([Value])');
    expect(ref).not.toContain('SUM([@Value])');
    const reopened = await workbookFromFile(blob, `unqualified.${format}`);
    for (const [i, item] of cases.entries()) {
      const id = reopened.sheetByName(wb.sheet(item.id).name).id;
      expect([1, 2].map((dr) => reopened.getValue(id, item.r + dr, item.c + 1))).toEqual(expected[i]);
    }
    const id = reopened.sheets[0].id;
    reopened.setInput(id, 9, 9, '=Current');
    // Outside any table the unqualified reference is #REF!; COUNTA counts that error as a value, as it does for =COUNTA(#REF!).
    expect(reopened.getValue(id, 9, 9)).toEqual(formula.startsWith('COUNTA') ? 1 : { error: '#REF!' });
    expect(wb.toJSON()).toEqual(before);
    expect(reopened.names).toHaveLength(1);
    if (format === 'xlsx') expect(reopened.names[0].ref).toBe(formula);
  },
);

it('preserves optional parameters even when no table reference is evaluated', async () => {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.defineName('DefaultValue', 'LAMBDA([Value],IF(ISOMITTED(Value),7,Value))');
  wb.setInput(id, 0, 0, '=DefaultValue()');
  const reopened = await workbookFromFile(await workbookToOds(wb), 'optional.ods');
  expect(reopened.names[0].ref).toBe('LAMBDA([Value],IF(ISOMITTED(Value),7,Value))');
  expect(reopened.getValue(reopened.activeSheetId, 0, 0)).toBe(7);
});

it('does not evaluate unselected table branches that contain dependencies on the caller', async () => {
  const { wb, first } = setup('SUM([@Value])');
  wb.setInput(first, 5, 3, '=B2+100');
  const reopened = await workbookFromFile(await workbookToOds(wb), 'branches.ods'), id = reopened.sheets[0].id;
  expect(reopened.getValue(id, 1, 1)).toBe(10);
  expect(reopened.getValue(id, 5, 4)).toBe(110);
  reopened.setInput(id, 1, 0, '40');
  expect(reopened.getValue(id, 1, 1)).toBe(40);
  expect(reopened.getValue(id, 5, 4)).toBe(140);
  reopened.undo();
  expect(reopened.getValue(id, 5, 4)).toBe(110);
});

it('restores calling-table lookup for newly added tables after XLSX reopening', async () => {
  const { wb } = setup('SUM([Value])');
  const reopened = await workbookFromFile(await workbookToXlsx(wb), 'growing.xlsx'), id = reopened.sheets[0].id;
  reopened.setInput(id, 9, 0, 'Value'); reopened.setInput(id, 9, 1, 'Result');
  reopened.setInput(id, 10, 0, '50');
  reopened.addTable(id, { r1: 9, c1: 0, r2: 10, c2: 1 }, { name: 'Added' });
  reopened.setInput(id, 10, 1, '=Current');
  expect(reopened.getValue(id, 10, 1)).toBe(50);
});
