import { describe, it, expect } from 'vitest';
import { inferType, planFromRows, baseFromPlan, addTableFromPlan, appendPlan } from '../src/ui/importer.js';
import { parseCSV } from '../src/lib/csv.js';
import { Base } from '../src/data/base.js';

describe('import', () => {
  it('guesses field types', () => {
    expect(inferType(['1', '2.5', '-3']).type).toBe('number');
    expect(inferType(['$1.50', '$20']).type).toBe('currency');
    expect(inferType(['10%', '12.5%']).type).toBe('percent');
    expect(inferType(['yes', 'no', '']).type).toBe('checkbox');
    expect(inferType(['a@b.co', 'c@d.org']).type).toBe('email');
    expect(inferType(['https://a.com', 'http://b.org/x']).type).toBe('url');
    expect(inferType(['2026-01-02', '2026-03-04']).type).toBe('date');
    expect(inferType(['red', 'blue', 'red', 'blue', 'red', 'green']).type).toBe('singleSelect');
    expect(inferType(['Alice', 'Bob', 'Carol', 'Dan']).type).toBe('text');
  });

  it('reads commas only as thousands separators', () => {
    expect(inferType(['1,234', '5,678.5', '1,234,567']).type).toBe('number');
    expect(inferType(['1,5', '2,25', '10,75']).type).toBe('text');
  });

  it('keeps codes with leading zeros and long ids as text', () => {
    expect(inferType(['02134', '00501', '10001']).type).toBe('text');
    expect(inferType(['12345678901234567890', '1']).type).toBe('text');
    expect(inferType(['0', '0.5', '-0.25', '120']).type).toBe('number');
  });

  it('plans a file with 200,000 rows', () => {
    const rows = [['Name', 'Qty'], ...Array.from({ length: 200_000 }, (_, i) => [`Item ${i}`, String(i)])];
    const plan = planFromRows(rows);
    expect(plan.columns.map((c) => c.type)).toEqual(['text', 'number']);
    expect(plan.rows.length).toBe(200_000);
  });

  it('does not read times or durations as dates', () => {
    expect(inferType(['9:00', '14:30']).type).toBe('text');
    expect(inferType(['1:30', '0:45', '2:00']).type).toBe('text');
    expect(inferType(['2026-01-02 9:00', '1/3/2026 2:30pm', 'Jan 5, 2026']).type).toBe('date');
  });

  it('builds a base from a CSV file', () => {
    const csv = 'Name,Qty,Color,When\nWidget,3,red,2026-01-02\nGadget,5,blue,2026-02-03\nGizmo,,red,\nThing,1,blue,2026-04-05\n';
    const plan = planFromRows(parseCSV(csv), { name: 'Stock' });
    expect(plan.columns.map((c) => c.type)).toEqual(['text', 'number', 'singleSelect', 'date']);
    const { doc, records } = baseFromPlan(plan, 'Stock');
    const base = new Base(doc, records);
    const t = base.tableList()[0];
    expect(t.name).toBe('Stock');
    expect(t.records.size).toBe(4);
    const color = t.fieldByName('Color');
    expect(color.options.choices.map((c) => c.name)).toEqual(['red', 'blue']);
    const gizmo = t.ordered()[2];
    expect(gizmo.c[t.fieldByName('Qty').id]).toBeUndefined();
    expect(t.ordered()[0].c[t.fieldByName('When').id]).toBe('2026-01-02');
  });

  it('adds a table to an open base and appends rows to it', () => {
    const base = new Base({ v: 1, id: 'appX', name: 'X', tables: [] }, {});
    const tid = addTableFromPlan(base, planFromRows(parseCSV('Name,Size\nA,S\nB,M\nC,S\nD,L'), { name: 'Shirts' }));
    const t = base.table(tid);
    expect(t.records.size).toBe(4);
    const plan = planFromRows(parseCSV('Size,Name\nXL,E'));
    const n = appendPlan(base, tid, plan, [t.fieldByName('Size').id, t.fieldByName('Name').id]);
    expect(n).toBe(1);
    const e = t.ordered()[4];
    expect(e.c[t.primary.id]).toBe('E');
    expect(t.fieldByName('Size').options.choices.map((c) => c.name)).toContain('XL');
    base.undo();
    expect(t.records.size).toBe(4);
  });
});
