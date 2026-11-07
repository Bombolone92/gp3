import { describe, it, expect } from 'vitest';
import { baseWith, makeChoice } from './helpers/base.js';
import { toText } from '../src/data/fields.js';

describe('records', () => {
  it('creates, edits, deletes with undo and redo', () => {
    const { base, table, f } = baseWith([{ name: 'Qty', type: 'number' }]);
    const [id] = base.createRecords(table.id, [{ [f('Name').id]: 'Apple' }]);
    expect(table.records.size).toBe(1);
    base.setCell(table.id, id, f('Qty').id, 3);
    expect(table.record(id).c[f('Qty').id]).toBe(3);
    base.undo();
    expect(table.record(id).c[f('Qty').id]).toBeUndefined();
    base.redo();
    expect(table.record(id).c[f('Qty').id]).toBe(3);
    base.deleteRecords(table.id, [id]);
    expect(table.records.size).toBe(0);
    base.undo();
    expect(table.record(id).c[f('Name').id]).toBe('Apple');
  });

  it('orders inserted records between neighbours', () => {
    const { base, table } = baseWith();
    const [a, b] = base.createRecords(table.id, [{}, {}]);
    const [c] = base.createRecords(table.id, [{}], { after: a });
    expect(table.ordered().map((r) => r.id)).toEqual([a, c, b]);
    base.moveRecords(table.id, [a], null);
    expect(table.ordered().map((r) => r.id)).toEqual([c, b, a]);
  });

  it('groups a transaction into one undo step', () => {
    const { base, table, f } = baseWith();
    base.transact(() => {
      base.createRecords(table.id, [{ [f('Name').id]: 'x' }]);
      base.createRecords(table.id, [{ [f('Name').id]: 'y' }]);
    });
    expect(table.records.size).toBe(2);
    base.undo();
    expect(table.records.size).toBe(0);
  });

  it('stamps created and modified info', () => {
    let t = 1000;
    const { base, table, f } = baseWith([], { now: () => t });
    const [id] = base.createRecords(table.id, [{}]);
    t = 5000;
    base.setCell(table.id, id, f('Name').id, 'z');
    const rec = table.record(id);
    expect(rec.ct).toBe(1000);
    expect(rec.mt).toBe(5000);
    expect(rec.cb).toBe('tester');
  });

  it('keeps a short history of edits, but not of bulk edits', () => {
    const { base, table, f } = baseWith([{ name: 'Qty', type: 'number' }]);
    const [id] = base.createRecords(table.id, [{ [f('Qty').id]: 1 }]);
    base.setCell(table.id, id, f('Qty').id, 2);
    base.setCell(table.id, id, f('Name').id, 'Box');
    const h = table.record(id).h;
    expect(h.map((e) => [e.from, e.to])).toEqual([['1', '2'], ['', 'Box']]);
    expect(h[0].by).toBe('tester');
    for (let i = 0; i < 30; i++) base.setCell(table.id, id, f('Qty').id, i + 10);
    expect(table.record(id).h.length).toBe(20);
    const many = base.createRecords(table.id, Array.from({ length: 60 }, () => ({})));
    base.setCells(table.id, many.map((rid) => ({ id: rid, cells: { [f('Qty').id]: 5 } })));
    expect(table.record(many[0]).h).toBeUndefined();
  });

  it('assigns autonumbers to existing and new records', () => {
    const { base, table } = baseWith();
    base.createRecords(table.id, [{}, {}]);
    const fid = base.addField(table.id, { name: 'No', type: 'autonumber' });
    const nums = table.ordered().map((r) => r.c[fid]);
    expect(nums).toEqual([1, 2]);
    const [id] = base.createRecords(table.id, [{}]);
    expect(table.record(id).c[fid]).toBe(3);
  });
});

describe('fields', () => {
  it('converts values when the type changes, and undo restores them', () => {
    const { base, table, f } = baseWith([{ name: 'Tag', type: 'text' }]);
    const tag = f('Tag').id;
    const ids = base.createRecords(table.id, [{ [tag]: 'red' }, { [tag]: 'blue' }, { [tag]: 'red' }]);
    base.updateField(table.id, tag, { type: 'singleSelect', options: { choices: [] } });
    const field = table.field(tag);
    expect(field.options.choices.map((c) => c.name).sort()).toEqual(['blue', 'red']);
    const red = field.options.choices.find((c) => c.name === 'red').id;
    expect(table.record(ids[0]).c[tag]).toBe(red);
    expect(table.record(ids[2]).c[tag]).toBe(red);
    base.undo();
    expect(table.field(tag).type).toBe('text');
    expect(table.record(ids[0]).c[tag]).toBe('red');
  });

  it('removing a choice clears it from cells', () => {
    const a = makeChoice('A');
    const b = makeChoice('B', [a]);
    const { base, table, f } = baseWith([{ name: 'S', type: 'singleSelect', options: { choices: [a, b] } }]);
    const s = f('S').id;
    const [id] = base.createRecords(table.id, [{ [s]: a.id }]);
    base.updateField(table.id, s, { options: { choices: [b] } });
    expect(table.record(id).c[s]).toBeUndefined();
    base.undo();
    expect(table.record(id).c[s]).toBe(a.id);
  });

  it('protects the primary field', () => {
    const { base, table } = baseWith();
    expect(() => base.deleteField(table.id, table.schema.primaryFieldId)).toThrow();
    expect(() => base.updateField(table.id, table.schema.primaryFieldId, { type: 'attachment' })).toThrow();
  });

  it('keeps names unique and scrubs views on delete', () => {
    const { base, table, f } = baseWith([{ name: 'Qty', type: 'number' }]);
    const id = base.addField(table.id, { name: 'qty', type: 'number' });
    expect(table.field(id).name).toBe('qty 2');
    const view = table.views[0];
    base.updateView(table.id, view.id, { sorts: [{ fieldId: id, dir: 'asc' }], hidden: [id] });
    base.deleteField(table.id, id);
    expect(view.sorts).toEqual([]);
    expect(view.hidden).toEqual([]);
    base.undo();
    expect(table.field(id)).toBeTruthy();
    expect(view.sorts).toEqual([{ fieldId: id, dir: 'asc' }]);
    expect(f('Qty')).toBeTruthy();
  });
});

describe('linked records', () => {
  function twoTables() {
    const ctx = baseWith([{ name: 'Hours', type: 'number' }]);
    const { base, table } = ctx;
    const peopleId = base.addTable('People');
    const people = base.table(peopleId);
    const link = base.addField(table.id, { name: 'Owner', type: 'link', options: { tableId: peopleId } });
    return { ...ctx, people, link };
  }

  it('creates an inverse field and keeps both sides in step', () => {
    const { base, table, people, link, f } = twoTables();
    const inverse = table.field(link).options.inverseId;
    expect(people.field(inverse).options.inverseId).toBe(link);
    const [ada] = base.createRecords(people.id, [{ [people.primary.id]: 'Ada' }]);
    const [t1, t2] = base.createRecords(table.id, [{ [f('Name').id]: 'T1' }, { [f('Name').id]: 'T2' }]);
    base.setCell(table.id, t1, link, [ada]);
    base.setCell(table.id, t2, link, [ada]);
    expect(people.record(ada).c[inverse]).toEqual([t1, t2]);
    base.setCell(table.id, t1, link, []);
    expect(people.record(ada).c[inverse]).toEqual([t2]);
    base.undo();
    expect(people.record(ada).c[inverse]).toEqual([t2, t1]);
  });

  it('deleting a record removes it from links, undo restores both sides', () => {
    const { base, table, people, link, f } = twoTables();
    const inverse = table.field(link).options.inverseId;
    const [ada] = base.createRecords(people.id, [{ [people.primary.id]: 'Ada' }]);
    const [t1] = base.createRecords(table.id, [{ [f('Name').id]: 'T1', [link]: [ada] }]);
    expect(people.record(ada).c[inverse]).toEqual([t1]);
    base.deleteRecords(people.id, [ada]);
    expect(table.record(t1).c[link]).toBeUndefined();
    base.undo();
    expect(table.record(t1).c[link]).toEqual([ada]);
    expect(people.record(ada).c[inverse]).toEqual([t1]);
  });

  it('computes lookup, rollup, count and formula fields', () => {
    const { base, table, people, link, f } = twoTables();
    const inverse = table.field(link).options.inverseId;
    const [ada] = base.createRecords(people.id, [{ [people.primary.id]: 'Ada' }]);
    base.createRecords(table.id, [
      { [f('Name').id]: 'A', [f('Hours').id]: 2, [link]: [ada] },
      { [f('Name').id]: 'B', [f('Hours').id]: 5, [link]: [ada] },
    ]);
    const total = base.addField(people.id, { name: 'Total', type: 'rollup', options: { linkFieldId: inverse, targetFieldId: f('Hours').id, fn: 'sum' } });
    const count = base.addField(people.id, { name: 'Tasks', type: 'count', options: { linkFieldId: inverse } });
    const names = base.addField(people.id, { name: 'Names', type: 'lookup', options: { linkFieldId: inverse, targetFieldId: f('Name').id } });
    const label = base.addField(people.id, { name: 'Label', type: 'formula', options: { formula: `{${people.primary.id}} & ": " & {${total}} & "h"` } });
    const rec = people.record(ada);
    const v = (id) => base.compute.value(people, rec, people.field(id));
    expect(v(total)).toBe(7);
    expect(v(count)).toBe(2);
    expect(v(names)).toEqual(['A', 'B']);
    expect(toText(people.field(names), v(names), base.compute.ctx)).toBe('A, B');
    expect(v(label)).toBe('Ada: 7h');
    // Changes invalidate cached values.
    const [, b] = table.ordered();
    base.setCell(table.id, b.id, f('Hours').id, 10);
    expect(v(total)).toBe(12);
    expect(v(label)).toBe('Ada: 12h');
  });

  it('detects formula cycles', () => {
    const { base, table } = baseWith();
    const a = base.addField(table.id, { name: 'A', type: 'formula', options: { formula: '1' } });
    const b = base.addField(table.id, { name: 'B', type: 'formula', options: { formula: `{${a}} + 1` } });
    base.updateField(table.id, a, { options: { formula: `{${b}} + 1`, format: 'auto' } });
    const [id] = base.createRecords(table.id, [{}]);
    const v = base.compute.value(table, table.record(id), table.field(a));
    expect(v.error).toBe('#CYCLE');
  });

  it('turns text into links by matching names', () => {
    const { base, table, f } = baseWith([{ name: 'Who', type: 'text' }]);
    const peopleId = base.addTable('People');
    const people = base.table(peopleId);
    const [ada, bob] = base.createRecords(peopleId, [{ [people.primary.id]: 'Ada' }, { [people.primary.id]: 'Bob' }]);
    const [t1] = base.createRecords(table.id, [{ [f('Who').id]: 'ada, Bob, Zed' }]);
    base.updateField(table.id, f('Who').id, { type: 'link', options: { tableId: peopleId } });
    expect(table.record(t1).c[f('Who').id]).toEqual([ada, bob]);
    const inv = table.field(f('Who').id).options.inverseId;
    expect(people.record(ada).c[inv]).toEqual([t1]);
  });

  it('deleting a table removes links into it, undo brings everything back', () => {
    const { base, table, people, link } = twoTables();
    base.apply({ t: 'table.del', id: people.id });
    expect(table.field(link)).toBeNull();
    base.undo();
    expect(base.table(people.id)).toBeTruthy();
    expect(table.field(link)).toBeTruthy();
  });
});
