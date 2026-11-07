import { Base, makeTable, makeChoice } from '../../src/data/base.js';

/** A base with one table and the given extra fields (name -> type/options). */
export function baseWith(fields = [], { now = () => 1_760_000_000_000 } = {}) {
  const schema = makeTable('Tasks', [{ name: 'Name', type: 'text' }, ...fields]);
  const doc = { v: 1, id: 'appTest0000000000', name: 'Test', color: 'blue', icon: 'table', tables: [schema] };
  const base = new Base(doc, {}, { user: 'tester', now });
  const table = base.table(schema.id);
  const f = (name) => table.fieldByName(name);
  return { base, table, f };
}

export { makeChoice };
