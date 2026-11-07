import { describe, expect, it } from 'vitest';
import { matchesRule } from '../src/core/condformat.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

// matchesRule opened by passing every error cell over, so a cell holding #DIV/0! was neither empty nor
// not empty: "Is not empty" skipped it in the conditional-format dialog and hid it in the column filter,
// where "Is empty" hid it too, and the negative text rules (does not contain, is not equal to) left it
// unpainted. An error cell holds something, so it answers those rules from the code it shows.
const ERR = { error: '#DIV/0!' };

describe('rules that read no number see an error cell', () => {
  it('counts an error as not empty, and not as empty', () => {
    expect(matchesRule({ type: 'notEmpty' }, ERR)).toBe(true);
    expect(matchesRule({ type: 'empty' }, ERR)).toBe(false);
    expect(matchesRule({ type: 'notEmpty' }, null)).toBe(false);
    expect(matchesRule({ type: 'empty' }, '')).toBe(true);
  });

  it('matches the text rules against the code the cell shows', () => {
    expect(matchesRule({ type: 'contains', value: 'div' }, ERR)).toBe(true);
    expect(matchesRule({ type: 'notContains', value: 'zz' }, ERR)).toBe(true);
    expect(matchesRule({ type: 'notContains', value: 'div' }, ERR)).toBe(false);
    expect(matchesRule({ type: 'beginsWith', value: '#' }, ERR)).toBe(true);
    expect(matchesRule({ type: 'endsWith', value: '0!' }, ERR)).toBe(true);
    expect(matchesRule({ type: 'eq', value: '#DIV/0!' }, ERR)).toBe(true);
    expect(matchesRule({ type: 'eq', value: '#N/A' }, ERR)).toBe(false);
    expect(matchesRule({ type: 'neq', value: 'zz' }, ERR)).toBe(true);
  });

  it('still passes an error over where a rule reads a number, a date or an identity', () => {
    for (const rule of [{ type: 'gt', value: 10 }, { type: 'lt', value: 10 }, { type: 'between', value: 1, value2: 5 },
      { type: 'date', value: 'today' }, { type: 'dup' }, { type: 'unique' }, { type: 'top', value: 1 }, { type: 'bottom', value: 1 }]) {
      expect(matchesRule(rule, ERR, { counts: new Map(), numbers: [5, 1] })).toBe(false);
    }
  });
});

describe('the rules an error cell answers, through the sheet', () => {
  function sheet() {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'H');
    wb.setInput(id, 1, 0, 'a');
    wb.setInput(id, 2, 0, '=1/0');
    return { wb, id };
  }

  it('paints an error cell with Is not empty, Does not contain and Is not equal to', () => {
    const { wb, id } = sheet();
    const paint = (rule) => {
      const rid = wb.addRule(id, { ...rule, range: parseRange('A1:A3'), style: { bg: '#ff0000' } });
      const out = [0, 1, 2].map((r) => wb.conditionalStyle(id, r, 0, wb.getValue(id, r, 0))?.bg ?? null);
      wb.deleteRule(id, rid);
      return out;
    };
    const red = ['#ff0000', '#ff0000', '#ff0000'];
    expect(paint({ type: 'notEmpty' })).toEqual(red);
    expect(paint({ type: 'notContains', value: 'zz' })).toEqual(red);
    expect(paint({ type: 'neq', value: 'zz' })).toEqual(red);
    expect(paint({ type: 'contains', value: 'div' })).toEqual([null, null, '#ff0000']);
    expect(paint({ type: 'empty' })).toEqual([null, null, null]);
  });

  it('leaves an error row in view under Is not empty and hides it under Is empty, never both', () => {
    const { wb, id } = sheet();
    wb.setInput(id, 3, 0, '=1/0');
    wb.setCells(id, [{ r: 2, c: 0, cell: null }], 'Clear'); // A1 H, A2 a, A3 empty, A4 #DIV/0!
    wb.setFilterRange(id, parseRange('A1:A4'));
    wb.setFilterCriteria(id, 0, { op: 'notEmpty' });
    expect([...wb.sheet(id).filterHidden]).toEqual([2]);
    wb.setFilterCriteria(id, 0, { op: 'empty' });
    expect([...wb.sheet(id).filterHidden]).toEqual([1, 3]);
  });
});

it('lets custom formulas decide whether an error cell matches', () => {
  expect(matchesRule({ type: 'formula' }, ERR, { formulaResult: true })).toBe(true);
  expect(matchesRule({ type: 'formula' }, ERR, { formulaResult: ERR })).toBe(false);
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 1, 1, '=1/0');
  wb.addRule(id, { type: 'formula', range: parseRange('B2:B3'), value: 'ISERROR(B2)', style: { bg: '#ff0000' } });
  expect(wb.conditionalStyle(id, 1, 1, wb.getValue(id, 1, 1))).toEqual({ bg: '#ff0000' });
  wb.setInput(id, 1, 1, '1');
  expect(wb.conditionalStyle(id, 1, 1, 1)).toBeNull();
});
