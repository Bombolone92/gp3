import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { signatureFor } from '../src/core/formula/hints.js';

function setup() {
  const wb = new Workbook(), id = wb.activeSheetId;
  [[0, 0, 1], [0, 1, 2], [1, 0, 3], [1, 1, 4], [2, 2, 5], [3, 1, 7], [2, 3, 8]]
    .forEach(([r, c, value]) => wb.setInput(id, r, c, String(value)));
  const calc = (formula) => { wb.setInput(id, 3, 3, `=${formula}`); return wb.getValue(id, 3, 3); };
  return { wb, id, calc };
}

it.each([
  ['R2C2', 4], ['r2c2', 4], ['R[-2]C[-2]', 4], ['R2C[-2]', 4], ['R[-2]C2', 4],
  ['RC[-2]', 7], ['R[0]C[-2]', 7], ['R[-1]C', 8], ['R[-1]C[0]', 8],
])('reads %s using R1C1 coordinates relative to the formula cell', (ref, expected) => {
  const { calc } = setup();
  expect(calc(`INDIRECT("${ref}",FALSE)`)).toBe(expected);
  expect(calc(`ISREF(INDIRECT("${ref}",FALSE))`)).toBe(true);
});

it.each([['R1:R2', 10], ['R2:R1', 10], ['R[-3]:R[-2]', 10], ['C1:C2', 17], ['C2:C1', 17],
  ['C[-3]:C[-2]', 17], ['R1', 3], ['C1', 4], ['R1C1:R2C2', 10], ['R2C2:R1C1', 10]])
  ('reads the R1C1 range %s', (ref, expected) => {
    expect(setup().calc(`SUM(INDIRECT("${ref}",FALSE))`)).toBe(expected);
  });

it('spills a relative rectangle and preserves its address for nested reference functions', () => {
  const { wb, id, calc } = setup();
  calc('INDIRECT("R[-3]C[-3]:R[-2]C[-2]",FALSE)');
  expect(wb.rangeValues(id, { r1: 3, c1: 3, r2: 4, c2: 4 })).toEqual([[1, 2], [3, 4]]);
  expect(calc('ROW(INDIRECT("R2C2",FALSE))')).toBe(2);
  expect(calc('COLUMN(INDIRECT("R2C2",FALSE))')).toBe(2);
  expect(calc('OFFSET(INDIRECT("R2C2",FALSE),1,1)')).toBe(5);
});

it.each(['Data', 'Source Data', "Bob's!data"])('reads the quoted source sheet %s and follows edits and undo', (name) => {
  const { wb, id, calc } = setup();
  const source = wb.addSheet(name).id;
  wb.setInput(source, 1, 1, '42');
  const quoted = `'${name.replaceAll("'", "''")}'`;
  expect(calc(`INDIRECT("${quoted}!R[-2]C[-2]",FALSE)`)).toBe(42);
  wb.setInput(source, 1, 1, '11');
  expect(wb.getValue(id, 3, 3)).toBe(11);
  wb.undo();
  expect(wb.getValue(id, 3, 3)).toBe(42);
});

it.each(['A1', 'R0C1', 'R1C0', 'R1048577C1', 'R1C16385', 'R[-4]C1', 'R1C[-4]',
  'R[1048576]C1', 'R1C[16384]', 'R1C1:R1048577C1', 'R0:R1', 'C0:C1', 'R1:C1',
  'R1C1:R2', 'R[]C1', 'R[1.5]C1', 'R-1C1', 'R1C1 trailing', 'R1C1:R2C2:R3C3',
  'Missing!R1C1', 'Sheet1:Sheet2!R1C1'])('rejects invalid R1C1 text %s', (ref) => {
  expect(setup().calc(`INDIRECT("${ref}",FALSE)`)).toEqual({ error: '#REF!' });
});

it('honors mode coercion, retains A1 defaults and names, and exposes the mode in hints', () => {
  const { wb, calc } = setup();
  wb.defineName('Sales', 'Sheet1!$B$2');
  for (const mode of ['FALSE', '0', '"FALSE"']) expect(calc(`INDIRECT("R2C2",${mode})`)).toBe(4);
  for (const mode of ['TRUE', '1', '"TRUE"']) expect(calc(`INDIRECT("B2",${mode})`)).toBe(4);
  expect(calc('INDIRECT("B2")')).toBe(4);
  expect(calc('INDIRECT("Sales",FALSE)')).toBe(4);
  expect(calc('INDIRECT("B2","bad")')).toEqual({ error: '#VALUE!' });
  expect(calc('INDIRECT("B2",#N/A)')).toEqual({ error: '#N/A' });
  expect(signatureFor('INDIRECT').params).toBe('reference_text, [a1]');
});

it.each([[1, 1, 1], [2, 1, 5], [3, 5, 1], [4, 5, 5]])('reads ADDRESS-generated R1C1 mode %i', (mode, r, c) => {
  const { wb, id, calc } = setup();
  wb.setInput(id, r, c, '42');
  expect(calc(`INDIRECT(ADDRESS(2,2,${mode},FALSE),FALSE)`)).toBe(42);
});

it('accepts the last grid cell and rejects extremely large coordinates', () => {
  const { calc } = setup();
  expect(calc('ROW(INDIRECT("R1048576C16384",FALSE))')).toBe(1048576);
  expect(calc('COLUMN(INDIRECT("R1048576C16384",FALSE))')).toBe(16384);
  // Long enough to overflow any coordinate, short enough (under 8,192 characters) to still be typed as a formula.
  expect(calc(`INDIRECT("R[${'9'.repeat(5000)}]C1",FALSE)`)).toEqual({ error: '#REF!' });
});

it('resolves the same relative text separately at each formula location', () => {
  const { wb, id, calc } = setup();
  expect(calc('INDIRECT("R[-2]C[-2]",FALSE)')).toBe(4);
  wb.setInput(id, 4, 4, '=INDIRECT("R[-2]C[-2]",FALSE)');
  expect(wb.getValue(id, 4, 4)).toBe(5);
  wb.setInput(id, 1, 1, '42');
  expect(wb.getValue(id, 3, 3)).toBe(42);
  expect(wb.getValue(id, 4, 4)).toBe(5);
});
