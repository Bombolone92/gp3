/**
 * Formula and computed-field fixes from review.
 */
import { describe, it, expect } from 'vitest';
import { prepare, parse, inferKind, toDisplay, fromDisplay, fieldRef } from '../src/data/formula.js';
import { toText } from '../src/data/fields.js';
import { sortRecords } from '../src/data/query.js';
import { baseWith, makeChoice } from './helpers/base.js';

const run = (src, fields = {}, record = { id: 'rec1', ct: 0, mt: 0 }) => {
  const p = prepare(src);
  if (p.error) throw new Error(p.error);
  return p.run({ get: (id) => fields[id], record, now: () => new Date(2026, 9, 12, 9, 30) });
};
const code = (src, fields) => {
  try {
    run(src, fields);
  } catch (err) {
    return err.code;
  }
  return null;
};

describe('WORKDAY', () => {
  it('gives #NUM for counts that are not numbers or too large instead of hanging', () => {
    for (const n of ['1e7', '-1e7', '"abc"', '{x}']) expect(code(`WORKDAY("2026-10-09", ${n})`, { x: 'abc' })).toBe('#NUM');
    expect(code('WORKDAY("2026-10-09", {xs})', { xs: [1, 2] })).toBe('#NUM');
    expect(run('WORKDAY("2026-10-09", 1)')).toBe('2026-10-12');
    expect(run('WORKDAY("2026-10-12", -1)')).toBe('2026-10-09');
    expect(run('WORKDAY("2026-10-12", 0)')).toBe('2026-10-12');
  });
});

/** Tasks linked to People; people get a lookup and a rollup of a task field. */
function linked(formula) {
  const { base, table } = baseWith();
  const people = base.addTable('People');
  const pt = base.table(people);
  const link = base.addField(table.id, { name: 'Owner', type: 'link', options: { tableId: people } });
  const inverse = table.field(link).options.inverseId;
  const calc = base.addField(table.id, { name: 'Calc', type: 'formula', options: { formula } });
  const [ada] = base.createRecords(people, [{ [pt.primary.id]: 'Ada' }]);
  base.createRecords(table.id, [{ [link]: [ada] }, { [link]: [ada] }]);
  const add = (field) => base.addField(people, field);
  const value = (fid) => base.compute.value(pt, pt.record(ada), pt.field(fid));
  return { base, people, pt, inverse, calc, ada, add, value };
}

describe('errors in linked records', () => {
  it('reach formulas over a lookup and rollups instead of vanishing or showing [object Object]', () => {
    const { inverse, calc, add, value } = linked('1/0');
    const lookup = add({ name: 'L', type: 'lookup', options: { linkFieldId: inverse, targetFieldId: calc } });
    const sum = add({ name: 'S', type: 'rollup', options: { linkFieldId: inverse, targetFieldId: calc, fn: 'sum' } });
    for (const src of [`"x" & {${lookup}}`, `ARRAYJOIN({${lookup}})`, `SUM({${lookup}})`]) {
      const f = add({ name: src, type: 'formula', options: { formula: src } });
      expect(value(f)?.error).toBe('#DIV/0');
    }
    expect(value(sum)?.error).toBe('#DIV/0');
    // IFERROR still catches it.
    const safe = add({ name: 'Safe', type: 'formula', options: { formula: `IFERROR(SUM({${lookup}}), -1)` } });
    expect(value(safe)).toBe(-1);
  });
});

describe('long chains of linked records', () => {
  it('compute a running balance over thousands of records', () => {
    const { base, table, f } = baseWith([{ name: 'Amount', type: 'number' }]);
    const prev = base.addField(table.id, { name: 'Prev', type: 'link', options: { tableId: table.id } });
    const n = 5000;
    const ids = base.createRecords(table.id, Array.from({ length: n }, () => ({ [f('Amount').id]: 2 })));
    base.transact(() => {
      for (let i = 1; i < n; i++) base.setCell(table.id, ids[i], prev, [ids[i - 1]]);
    });
    const balance = base.addField(table.id, { name: 'Balance', type: 'formula', options: { formula: '0' } });
    const before = base.addField(table.id, { name: 'Before', type: 'rollup', options: { linkFieldId: prev, targetFieldId: balance, fn: 'sum' } });
    base.updateField(table.id, balance, { options: { formula: `{${f('Amount').id}} + {${before}}` } });
    expect(base.compute.value(table, table.record(ids[n - 1]), table.field(balance))).toBe(2 * n);
    expect(base.compute.value(table, table.record(ids[10]), table.field(balance))).toBe(22);
  });
});

describe('AND', () => {
  it('is false for an empty list', () => {
    expect(run('AND({t})', { t: [] })).toBe(false);
    expect(run('AND(1, {t})', { t: [] })).toBe(false);
    expect(run('AND({t})', { t: ['a', 'b'] })).toBe(true);
    expect(run('AND({t}, 1)', { t: ['a', ''] })).toBe(false);
  });
});

describe('IF with an empty text branch', () => {
  it('keeps the kind of the other branch', () => {
    const kind = (src, k = 'number') => inferKind(parse(src), () => k);
    expect(kind('IF({a} > 1, {a} * 2, "")')).toBe('number');
    expect(kind('IF({a} > 1, DATEADD({a}, 1, "days"), "")')).toBe('date');
    expect(kind('IFERROR({a} / 2, "")')).toBe('number');
    expect(kind('IF({a} > 1, "x", "")')).toBe('text');
    expect(kind('IF({a} > 1, "", "")')).toBe('text');
  });

  it('formats as currency and sorts empty values last', () => {
    const { base, table, f } = baseWith([{ name: 'N', type: 'number' }]);
    const n = f('N').id;
    const fid = base.addField(table.id, { name: 'Price', type: 'formula', options: { formula: `IF({${n}} > 0, {${n}} * 2, "")`, format: 'currency' } });
    const ids = base.createRecords(table.id, [{ [n]: 0 }, { [n]: 30 }, { [n]: 4 }]);
    const field = table.field(fid);
    const text = (id) => toText(field, base.compute.value(table, table.record(id), field), base.compute.ctx);
    expect(text(ids[1])).toBe('$60.00');
    expect(text(ids[0])).toBe('');
    const sorted = sortRecords(base, table, table.ordered().slice(), [{ fieldId: fid, dir: 'asc' }]);
    expect(sorted.map((r) => r.id)).toEqual([ids[2], ids[1], ids[0]]);
  });
});

describe('a cycle through IFERROR', () => {
  it('shows #CYCLE whichever field is computed first', () => {
    for (const first of ['a', 'b']) {
      const { base, table } = baseWith();
      const a = base.addField(table.id, { name: 'A', type: 'formula', options: { formula: '1' } });
      const b = base.addField(table.id, { name: 'B', type: 'formula', options: { formula: `IFERROR({${a}}, 5)` } });
      base.updateField(table.id, a, { options: { formula: `{${b}} + 1` } });
      const [id] = base.createRecords(table.id, [{}]);
      const value = (fid) => base.compute.value(table, table.record(id), table.field(fid));
      const ids = first === 'a' ? [a, b] : [b, a];
      for (const fid of ids) expect(value(fid)?.error).toBe('#CYCLE');
    }
  });
});

describe('rollups of currency, percent and duration', () => {
  it('show totals like the summarized field, counts as plain numbers', () => {
    const { base, table, f } = baseWith([
      { name: 'Pct', type: 'percent', options: { precision: 0 } },
      { name: 'Cost', type: 'currency', options: { symbol: '€', precision: 2 } },
      { name: 'Time', type: 'duration', options: { format: 'h:mm' } },
    ]);
    const people = base.addTable('People');
    const pt = base.table(people);
    const link = base.addField(table.id, { name: 'Owner', type: 'link', options: { tableId: people } });
    const inverse = table.field(link).options.inverseId;
    const [ada] = base.createRecords(people, [{ [pt.primary.id]: 'Ada' }]);
    base.createRecords(table.id, [
      { [link]: [ada], [f('Pct').id]: 0.25, [f('Cost').id]: 1200, [f('Time').id]: 2700 },
      { [link]: [ada], [f('Pct').id]: 0.25, [f('Cost').id]: 3.5, [f('Time').id]: 2700 },
    ]);
    const text = (target, fn, options = {}) => {
      const id = base.addField(people, { name: `${fn} ${target}`, type: 'rollup', options: { linkFieldId: inverse, targetFieldId: f(target).id, fn, ...options } });
      return toText(pt.field(id), base.compute.value(pt, pt.record(ada), pt.field(id)), base.compute.ctx);
    };
    expect(text('Pct', 'sum')).toBe('50%');
    expect(text('Pct', 'avg', { precision: 1 })).toBe('25.0%');
    // The rollup's own precision (0 by default) applies.
    expect(text('Cost', 'sum')).toBe('€1,204');
    expect(text('Cost', 'sum', { precision: 2 })).toBe('€1,203.50');
    expect(text('Cost', 'max', { precision: 0 })).toBe('€1,200');
    expect(text('Time', 'sum')).toBe('1:30');
    expect(text('Time', 'min')).toBe('0:45');
    expect(text('Pct', 'count')).toBe('2');
    expect(text('Cost', 'countAll')).toBe('2');
  });
});

describe('rollups over a lookup', () => {
  it('use option and record names, not ids', () => {
    const red = makeChoice('Red');
    const blue = makeChoice('Blue');
    const { base, table } = baseWith();
    const tasks = base.addTable('Tasks');
    const tt = base.table(tasks);
    const color = base.addField(tasks, { name: 'Color', type: 'singleSelect', options: { choices: [red, blue] } });
    const owner = base.addField(tasks, { name: 'Owner', type: 'link', options: { tableId: table.id } });
    const link = base.addField(table.id, { name: 'Tasks', type: 'link', options: { tableId: tasks } });
    const [ada] = base.createRecords(table.id, [{ [table.primary.id]: 'Ada' }]);
    const [t1, t2] = base.createRecords(tasks, [{ [color]: red.id, [owner]: [ada] }, { [color]: blue.id, [owner]: [ada] }]);
    base.createRecords(table.id, [{ [link]: [t1, t2] }]);
    const p1 = table.ordered()[1].id;
    const colors = base.addField(table.id, { name: 'Colors', type: 'lookup', options: { linkFieldId: link, targetFieldId: color } });
    const owners = base.addField(table.id, { name: 'Owners', type: 'lookup', options: { linkFieldId: link, targetFieldId: owner } });
    const inverse = table.field(link).options.inverseId;
    const roll = (target, fn) => {
      const id = base.addField(tasks, { name: `${fn} ${target}`, type: 'rollup', options: { linkFieldId: inverse, targetFieldId: target, fn } });
      return base.compute.value(tt, tt.record(t1), tt.field(id));
    };
    expect(table.record(p1).c[link]).toEqual([t1, t2]);
    expect(roll(colors, 'concat')).toBe('Red, Blue');
    expect(roll(colors, 'unique')).toEqual(['Red', 'Blue']);
    expect(roll(colors, 'countUnique')).toBe(2);
    expect(roll(owners, 'concat')).toBe('Ada, Ada');
    expect(roll(owners, 'unique')).toEqual(['Ada']);
  });
});

describe('arithmetic that is not a number', () => {
  it('is #NUM, also inside text and comparisons', () => {
    expect(code('"v: " & ({x} * 2)', { x: 'abc' })).toBe('#NUM');
    expect(code('"a" & LOG(0)')).toBe('#NUM');
    expect(code('"a" & -{x}', { x: 'abc' })).toBe('#NUM');
    expect(code('IF({x} + 1 > 3, "big", "small")', { x: 'abc' })).toBe('#NUM');
    expect(code('POWER(10, 1000) & ""')).toBe('#NUM');
    expect(run('IFERROR("v: " & ({x} * 2), "bad")', { x: 'abc' })).toBe('bad');
    expect(run('ISERROR(LN(0))')).toBe(true);
    // Blanks still count as zero; text still joins with +.
    expect(run('{x} * 2 + 1', { x: null })).toBe(1);
    expect(run('-{x}', { x: '' })).toBe(-0);
    expect(run('"a" + "b"')).toBe('ab');
    expect(run('SUM({xs})', { xs: ['a', 2] })).toBe(2);
  });
});

describe('field names in formulas', () => {
  const fields = [
    { id: 'fldAAAAAAAAAAAAAA', name: 'Cost {USD}' },
    { id: 'fldBBBBBBBBBBBBBB', name: 'Name' },
    { id: 'fldCCCCCCCCCCCCCC', name: 'C:\\temp' },
  ];
  it('can contain } and \\', () => {
    expect(fieldRef('Cost {USD}')).toBe('{Cost {USD\\}}');
    const shown = toDisplay('{fldAAAAAAAAAAAAAA} * 2 & {fldCCCCCCCCCCCCCC}', fields);
    expect(shown).toBe('{Cost {USD\\}} * 2 & {C:\\\\temp}');
    expect(fromDisplay(shown, fields)).toBe('{fldAAAAAAAAAAAAAA} * 2 & {fldCCCCCCCCCCCCCC}');
    // A backslash typed as is still finds its field.
    expect(fromDisplay('{C:\\temp}', fields)).toBe('{fldCCCCCCCCCCCCCC}');
    expect(() => fromDisplay('{Cost {USD}', fields)).toThrow(/Unknown field/);
  });
  it('show names after a brace inside a text value', () => {
    const stored = fromDisplay('"{" & {Name} & "}"', fields);
    expect(stored).toBe('"{" & {fldBBBBBBBBBBBBBB} & "}"');
    expect(toDisplay(stored, fields)).toBe('"{" & {Name} & "}"');
  });
});

describe('rounding', () => {
  it('rounds the value as written, not off by a fixed margin', () => {
    expect(run('ROUND(2.4999999995, 0)')).toBe(2);
    expect(run('ROUNDUP(1.0000000001, 0)')).toBe(2);
    expect(run('ROUNDDOWN(1.9999999999, 0)')).toBe(1);
    expect(run('FLOOR(0.3, 0.1)')).toBe(0.3);
    expect(run('FLOOR(4.35, 0.05)')).toBe(4.35);
    expect(run('CEILING(0.3, 0.1)')).toBe(0.3);
    expect(run('CEILING(0.31, 0.1)')).toBe(0.4);
    // Decimal values that are a hair off in binary still round as written.
    expect(run('ROUND(1.005, 2)')).toBe(1.01);
    expect(run('ROUND(-2.5, 0)')).toBe(-3);
    expect(run('ROUND(1234, -2)')).toBe(1200);
    // Large values keep every digit they have.
    expect(run('ROUND(123456789012.34567, 4)')).toBe(123456789012.3457);
    expect(run('ROUND(9007199254740991)')).toBe(9007199254740991);
    expect(run('ROUNDUP(2.301, 1)')).toBe(2.4);
    expect(run('ROUNDDOWN(-2.39, 1)')).toBe(-2.3);
  });
});

describe('computed values', () => {
  it('are kept through view changes and comments, and recomputed after data changes', () => {
    const { base, table, f } = baseWith([{ name: 'N', type: 'number' }]);
    const n = f('N').id;
    const fid = base.addField(table.id, { name: 'Double', type: 'formula', options: { formula: `{${n}} * 2` } });
    const [id] = base.createRecords(table.id, [{ [n]: 2 }]);
    const value = () => base.compute.value(table, table.record(id), table.field(fid));
    let computed = 0;
    const orig = base.compute.computeValue.bind(base.compute);
    base.compute.computeValue = (...args) => (computed++, orig(...args));
    expect(value()).toBe(4);
    const view = table.views[0];
    base.updateView(table.id, view.id, { collapsed: ['x'] }, { undoable: false });
    base.apply({ t: 'rec.meta', table: table.id, id, patch: { cm: [{ id: 'c1', text: 'hi' }] } }, { undoable: false });
    base.apply({ t: 'rec.order', table: table.id, orders: [{ id, o: 5 }] });
    base.undo();
    expect(value()).toBe(4);
    expect(computed).toBe(1);
    base.setCell(table.id, id, n, 5);
    expect(value()).toBe(10);
    base.undo();
    expect(value()).toBe(4);
    expect(computed).toBe(3);
  });
});

describe('WEEKNUM', () => {
  it('counts an afternoon in the week of its day', () => {
    // 2026-01-03 is a Saturday, in week 1 (weeks start on Sunday).
    expect(run('WEEKNUM({d})', { d: new Date(2026, 0, 3, 15).toISOString() })).toBe(1);
    expect(run('WEEKNUM({d})', { d: new Date(2026, 0, 4, 9).toISOString() })).toBe(2);
    expect(run('WEEKNUM({d}, "Monday")', { d: new Date(2026, 0, 4, 23, 59).toISOString() })).toBe(1);
  });
});

describe('time units', () => {
  it('accept common short names and reject unknown ones', () => {
    const at = (h, m = 0) => new Date(2026, 0, 1, h, m).toISOString();
    expect(run('DATEADD({d}, 30, "min")', { d: at(9) })).toBe(at(9, 30));
    expect(run('DATEADD({d}, 2, "hrs")', { d: at(9) })).toBe(at(11));
    expect(run('DATEADD({d}, 90, "sec")', { d: at(9) })).toBe(at(9, 1).replace(':00.000Z', ':30.000Z'));
    expect(run('DATEADD("2026-01-01", 1, "yr")')).toBe('2027-01-01');
    expect(run('DATEADD("2026-01-01", 1, "Weeks")')).toBe('2026-01-08');
    expect(run('DATETIME_DIFF({a}, {b}, "mins")', { a: at(10), b: at(9) })).toBe(60);
    expect(run('DATETIME_DIFF({a}, {b}, "m")', { a: at(10), b: at(9) })).toBe(60);
    expect(run('DATETIME_DIFF("2026-03-01", "2026-01-01", "M")')).toBe(2);
    expect(run('IS_SAME({a}, {b}, "hr")', { a: at(9, 5), b: at(9, 50) })).toBe(true);
    expect(code('DATEADD("2026-01-01", 30, "fortnights")')).toBe('#VALUE');
    expect(code('DATETIME_DIFF("2026-01-02", "2026-01-01", "decades")')).toBe('#VALUE');
    expect(run('DATEADD("2026-01-01", 3, "")')).toBe('2026-01-04');
  });
});

describe('text read as a number', () => {
  it('takes commas only as digit grouping, and only decimal numbers', () => {
    expect(code('VALUE("1,5")')).toBe('#VALUE');
    expect(code('VALUE("0x10")')).toBe('#VALUE');
    expect(code('VALUE("1.234,56")')).toBe('#VALUE');
    expect(code('VALUE("Infinity")')).toBe('#VALUE');
    expect(code('{x} * 2', { x: '1,5' })).toBe('#NUM');
    expect(run('COUNT({xs})', { xs: ['0x10', '1,5', '12', 3] })).toBe(2);
    expect(run('VALUE("1,234.5")')).toBe(1234.5);
    expect(run('VALUE("12,34,567")')).toBe(1234567);
    expect(run('VALUE(" $1,200 ")')).toBe(1200);
    expect(run('VALUE("-$5")')).toBe(-5);
    expect(run('VALUE("1e3")')).toBe(1000);
    expect(run('VALUE(".5")')).toBe(0.5);
    expect(run('{x} + 1', { x: '41' })).toBe(42);
  });
});

describe('text read as a date', () => {
  it('must look like a date', () => {
    expect(run('YEAR("Room 12")')).toBe(null);
    expect(run('IS_BEFORE("Suite 4", "2030-01-01")')).toBe(false);
    expect(run('YEAR("Jan 5, 2024")')).toBe(2024);
    expect(run('DAY("5 January 2024")')).toBe(5);
    expect(run('MONTH("1/5/2024")')).toBe(1);
    expect(run('YEAR("2024/01/05")')).toBe(2024);
    expect(run('DAY("Fri, Jan 5, 2024")')).toBe(5);
    expect(run('HOUR("January 5, 2024 3:30 pm")')).toBe(15);
    expect(run('HOUR("2024-01-05 15:30")')).toBe(15);
    expect(run('YEAR({d})', { d: '2024-01-05T10:00:00.000Z' })).toBe(2024);
    expect(run('DATETIME_FORMAT({d}, "YYYY-MM-DD")', { d: [new Date(2024, 0, 5)] })).toBe('2024-01-05');
  });

  it('still reads dates written other ways, with their seconds', () => {
    expect(run('HOUR("2026-10-12 3pm")')).toBe(15);
    expect(run('DAY("12-Oct-2026")')).toBe(12);
    expect(run('MONTH("2026-Oct-12")')).toBe(10);
    expect(run('MONTH("October 2026")')).toBe(10);
    expect(run('HOUR("10/12/2026, 3:00:00 PM")')).toBe(15);
    expect(run('SECOND("10/12/2026 3:00:15 PM")')).toBe(15);
    expect(run('YEAR("Mon, 12 Oct 2026 15:00:00 +0200")')).toBe(2026);
    expect(run('YEAR("Martin 2026")')).toBe(null);
    expect(run('YEAR("Room 2026")')).toBe(null);
  });
});

describe('comparing dates', () => {
  it('agrees between = and <= / >=', () => {
    expect(run('"2026-10-12" = DATETIME_PARSE("2026-10-12")')).toBe(true);
    expect(run('"2026-10-12" != DATETIME_PARSE("2026-10-12")')).toBe(false);
    expect(run('"2026-10-12" = DATETIME_PARSE("2026-10-12 3pm")')).toBe(false);
    // Text that only starts with a date is compared as text.
    expect(run('"2026-10-12 (v1)" = "2026-10-12 (v2)"')).toBe(false);
    expect(run('"2026-10-12" = "2026-10-12"')).toBe(true);
    expect(run('"2026-10-12x" = "2026-10-12"')).toBe(false);
  });
});

describe('converting a formula field to text', () => {
  it('leaves cells with errors empty instead of storing the error code', () => {
    const { base, table, f } = baseWith([{ name: 'N', type: 'number' }]);
    const n = f('N').id;
    const fid = base.addField(table.id, { name: 'Ratio', type: 'formula', options: { formula: `10 / {${n}}` } });
    const [zero, two] = base.createRecords(table.id, [{ [n]: 0 }, { [n]: 2 }]);
    base.updateField(table.id, fid, { type: 'text', options: {} });
    expect(table.record(zero).c[fid]).toBeUndefined();
    expect(table.record(two).c[fid]).toBe('5');
  });
});

describe('a count field whose linked field is gone', () => {
  it('shows #CONFIG like lookups and rollups, not 0', () => {
    for (const change of ['delete', 'retype']) {
      const { inverse, people, pt, ada, add, base } = linked('1');
      const count = add({ name: 'Count', type: 'count', options: { linkFieldId: inverse } });
      expect(base.compute.value(pt, pt.record(ada), pt.field(count))).toBe(2);
      if (change === 'delete') base.deleteField(people, inverse);
      else base.updateField(people, inverse, { type: 'text', options: {} });
      expect(base.compute.value(pt, pt.record(ada), pt.field(count))?.error).toBe('#CONFIG');
    }
  });
});

describe('TRIM', () => {
  it('keeps line breaks in long text', () => {
    expect(run('TRIM({t})', { t: '  Line one   here\nLine two \n\nEnd  ' })).toBe('Line one here\nLine two \n\nEnd');
    expect(run('TRIM("  a   b ")')).toBe('a b');
  });
});
