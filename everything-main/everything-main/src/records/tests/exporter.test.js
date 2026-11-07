import { describe, it, expect } from 'vitest';
import { exportRows, readBaseJson } from '../src/ui/exporter.js';
import { TEMPLATES, buildTemplate } from '../src/data/templates.js';
import { Base, makeChoice } from '../src/data/base.js';
import { baseWith } from './helpers/base.js';
import { planFromRows, appendPlan } from '../src/ui/importer.js';
import { parseCSV, toCSV } from '../src/lib/csv.js';
import { Store } from '../src/data/store.js';
import { memoryBackend, memoryKv } from '../src/data/backend.js';
import { memoryJournal } from '../src/data/journal.js';

function crm() {
  const { doc, records } = buildTemplate(TEMPLATES.find((t) => t.id === 'crm'));
  return new Base(doc, records);
}

describe('export', () => {
  it('exports a view as rows of display text', () => {
    const base = crm();
    const deals = base.tableList()[0];
    const rows = exportRows(base, deals, deals.views[0]);
    expect(rows[0]).toEqual(deals.fields.map((f) => f.name));
    const lumen = rows.find((r) => r[0] === 'Lumen pilot');
    expect(lumen).toContain('$12,000');
    expect(lumen).toContain('Lumen Studio');
    expect(lumen).toContain('$4,800');
  });

  it('exports options and linked names with commas so they import back', () => {
    const c = makeChoice('Red, dark');
    const { base, table, f } = baseWith([{ name: 'Tags', type: 'multipleSelect', options: { choices: [c, makeChoice('Blue')] } }]);
    const name = f('Name').id;
    const link = base.addField(table.id, { name: 'Client', type: 'link', options: { tableId: table.id } });
    const [acme] = base.createRecords(table.id, [{ [name]: 'Acme, Inc.' }]);
    base.createRecords(table.id, [{ [name]: 'Deal', [f('Tags').id]: [c.id], [link]: [acme] }]);
    const rows = exportRows(base, table, null);
    const plan = planFromRows(parseCSV(toCSV(rows)));
    appendPlan(base, table.id, plan, plan.columns.map((col) => table.fieldByName(col.name)?.id || ''));
    const copy = table.ordered().at(-1);
    expect(copy.c[name]).toBe('Deal');
    expect(copy.c[f('Tags').id]).toEqual([c.id]);
    expect(copy.c[link]).toEqual([acme]);
    expect(f('Tags').options.choices.length).toBe(2);
  });

  it('prints dates as shown and exports them exactly', () => {
    const { base, table, f } = baseWith([{ name: 'Due', type: 'date' }]);
    base.createRecords(table.id, [{ [f('Due').id]: '2026-03-05' }]);
    const col = (rows) => rows[1][rows[0].indexOf('Due')];
    expect(col(exportRows(base, table, null))).toBe('2026-03-05');
    expect(col(exportRows(base, table, null, { forFile: false }))).toBe('3/5/2026');
  });

  it('round-trips a base backup', async () => {
    const base = crm();
    const records = {};
    for (const t of base.tableList()) records[t.id] = [...t.records.values()];
    const text = `﻿${JSON.stringify({ format: 'records-base', version: 1, doc: base.doc, records })}`;
    const data = readBaseJson(text);
    const store = new Store({ backend: memoryBackend(), kv: memoryKv(), journal: memoryJournal() });
    await store.init();
    const id = await store.createBase({ name: data.doc.name, doc: data.doc, records: data.records });
    const s = await store.openBase(id);
    const deals = s.base.tableList()[0];
    expect(deals.records.size).toBe(4);
    const weighted = deals.fieldByName('Weighted');
    expect(s.base.compute.value(deals, deals.ordered()[0], weighted)).toBeCloseTo(33600);
    expect(() => readBaseJson('{"a":1}')).toThrow(/not a Records base/);
    expect(() => readBaseJson('nope')).toThrow(/not valid JSON/);
  });
});
