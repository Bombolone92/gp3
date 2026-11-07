/**
 * Regressions for bugs found in review.
 */
import { describe, it, expect } from 'vitest';
import { Store } from '../src/data/store.js';
import { memoryBackend, memoryKv } from '../src/data/backend.js';
import { memoryJournal } from '../src/data/journal.js';
import { baseWith, makeChoice } from './helpers/base.js';
import { runView } from '../src/data/query.js';
import { buttonUrl } from '../src/data/button.js';
import { HEADER_H } from '../src/views/grid/layout.js';
import { Painter } from '../src/views/grid/cells.js';
import { mountApp, openBase, tick, key, click } from './helpers/app.js';
import { openDialog } from '../src/ui/dialog.js';
import { openChoicePicker, openRecordPicker } from '../src/ui/editors.js';
import { openFieldEditor } from '../src/ui/fieldeditor.js';
import { openMenu } from '../src/ui/menu.js';
import { openPopover, popoverOpen } from '../src/ui/popover.js';
import { toast } from '../src/ui/toast.js';
import { announce } from '../src/lib/dom.js';

async function store(backend = memoryBackend(), journal = memoryJournal()) {
  const s = new Store({ backend, kv: memoryKv(), journal, user: 't' });
  await s.init();
  return s;
}

describe('storage', () => {
  it('reopening a base while it is closing gives a live, saving session', async () => {
    const s = await store();
    const id = await s.createBase();
    const a = await s.openBase(id);
    const closing = s.closeBase(id);
    const b = await s.openBase(id);
    await closing;
    expect(b).not.toBe(a);
    const t = b.base.tableList()[0];
    b.base.createRecords(t.id, [{ [t.primary.id]: 'kept' }]);
    expect(b.hasUnsaved()).toBe(true);
    await b.flush();
    await s.closeBase(id);
    const c = await (await store(s.backend)).openBase(id);
    expect([...c.base.tableList()[0].records.values()].some((r) => r.c[t.primary.id] === 'kept')).toBe(true);
  });

  it('a deleted record stays deleted when the first save of the delete fails', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const [a, b] = sess.base.createRecords(t.id, [{}, {}]);
    await sess.flush();
    const write = backend.write;
    let fail = true;
    backend.write = async (...args) => {
      if (fail) {
        fail = false;
        throw new Error('offline');
      }
      return write(...args);
    };
    sess.base.deleteRecords(t.id, [a]);
    await expect(sess.flush()).rejects.toThrow('offline');
    await sess.flush();
    const chunk = JSON.parse(backend.files.get(`bases/${id}/t/${t.id}/0.json`).data);
    expect(chunk.records.map((r) => r.id)).toEqual([b]);
  });

  it('concurrent flushes all wait for the save in progress', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const write = backend.write;
    let release;
    const gate = new Promise((r) => (release = r));
    backend.write = async (...args) => {
      await gate;
      return write(...args);
    };
    sess.base.createRecords(t.id, [{}]);
    const f1 = sess.flush();
    sess.base.createRecords(t.id, [{}]);
    const f2 = sess.flush();
    let f3Done = false;
    const f3 = sess.flush().then(() => (f3Done = true));
    await tick(5);
    expect(f3Done).toBe(false);
    release();
    await Promise.all([f1, f2, f3]);
    expect(sess.hasUnsaved()).toBe(false);
  });

  it('a duplicated base has its own copy of attachments', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const f = sess.base.addField(t.id, { name: 'Files', type: 'attachment' });
    const att = await s.putFile(id, new File(['data'], 'a.txt', { type: 'text/plain' }));
    sess.base.createRecords(t.id, [{ [f]: [att] }]);
    await sess.flush();
    const copyId = await s.duplicateBase(id);
    await s.purgeBase(id);
    const copy = await s.openBase(copyId);
    const rec = [...copy.base.tableList()[0].records.values()][0];
    const copied = rec.c[f][0];
    expect(copied.path.startsWith(`bases/${copyId}/`)).toBe(true);
    expect(await (await s.readFile(copied.path)).text()).toBe('data');
  });

  it('an old journal does not replace a newer schema from another device', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const s = await store(backend, journal);
    const id = await s.createBase();
    const doc = JSON.parse(backend.files.get(`bases/${id}/base.json`).data);
    // This device's stale journal: a renamed base, written long ago.
    await journal.put(id, { at: 1, schema: { ...doc, name: 'Stale name' }, records: {} });
    const sess = await (await store(backend, journal)).openBase(id);
    expect(sess.base.doc.name).toBe(doc.name);
    expect(sess.conflict).toMatch(/another device/);
  });
});

describe('storage after undo', () => {
  it('records deleted before a table is deleted and restored stay deleted', async () => {
    const s = await store();
    const id = await s.createBase();
    let sess = await s.openBase(id);
    const base = sess.base;
    const t = base.tableList()[0];
    const ids = base.createRecords(t.id, [{ [t.primary.id]: 'a' }, { [t.primary.id]: 'b' }]);
    await sess.flush();
    base.deleteRecords(t.id, ids);
    base.addTable('Other');
    base.apply({ t: 'table.del', id: t.id }, { label: 'Delete table' });
    base.undo();
    await s.closeBase(id);
    sess = await (await store(s.backend)).openBase(id);
    expect(sess.base.table(t.id).records.size).toBe(0);
  });
});

describe('failed saves', () => {
  it('do not override changes made while they ran', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const base = sess.base;
    const t = base.tableList()[0];
    const [x] = base.createRecords(t.id, [{ [t.primary.id]: 'X' }]);
    base.deleteRecords(t.id, [x]);
    const write = backend.write.bind(backend);
    let fail = true;
    backend.write = async (p, d) => {
      await new Promise((r) => setTimeout(r, 10));
      if (fail && p.endsWith('base.json')) throw new Error('network');
      return write(p, d);
    };
    const saving = sess.flush().catch(() => {});
    base.undo();
    await saving;
    fail = false;
    await sess.flush();
    await s.closeBase(id);
    const again = await (await store(backend)).openBase(id);
    expect(again.base.table(t.id).record(x)).toBeTruthy();
  });
});

describe('closing offline', () => {
  it('keeps an edit made just before closing', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const s = await store(backend, journal);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const write = backend.write;
    backend.write = async () => {
      throw new TypeError('Failed to fetch');
    };
    sess.base.createRecords(t.id, [{ [t.primary.id]: 'precious' }]);
    await s.closeBase(id);
    backend.write = write;
    const again = await (await store(backend, journal)).openBase(id);
    expect([...again.base.table(t.id).records.values()].map((r) => r.c[t.primary.id])).toEqual(['precious']);
  });
});

describe('deleting an open base for good', () => {
  it('stops its pending save from recreating it', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const write = backend.write.bind(backend);
    backend.write = async (p, d) => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('network');
    };
    sess.base.createRecords(t.id, [{}]);
    const saving = sess.flush().catch(() => {});
    backend.write = write;
    await s.purgeBase(id);
    await saving;
    expect(sess.timer && !sess.disposed).toBeFalsy();
    await new Promise((r) => setTimeout(r, 2100));
    expect([...backend.files.keys()].filter((k) => k.includes(id))).toEqual([]);
  });
});

describe('acting on a base that is closing', () => {
  async function closing() {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase({ name: 'Old name' });
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    sess.base.createRecords(t.id, [{}, {}, {}]);
    const write = backend.write.bind(backend);
    backend.write = async (p, d) => {
      await new Promise((r) => setTimeout(r, 10));
      return write(p, d);
    };
    s.closeBase(id);
    return { s, id, backend };
  }

  it('renames it after its save', async () => {
    const { s, id, backend } = await closing();
    await s.updateBase(id, { name: 'New name' });
    await s.flushAll();
    expect(JSON.parse(backend.files.get(`bases/${id}/base.json`).data).name).toBe('New name');
  });

  it('duplicates what was saved', async () => {
    const { s, id } = await closing();
    const copy = await s.duplicateBase(id);
    const sess = await s.openBase(copy);
    expect(sess.base.tableList()[0].records.size).toBe(3);
  });

  it('deletes all of its files', async () => {
    const { s, id, backend } = await closing();
    await s.purgeBase(id);
    expect([...backend.files.keys()].filter((k) => k.includes(id))).toEqual([]);
  });
});

describe('opening a base twice', () => {
  it('shares one session, saved when the last one closes', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const read = backend.read.bind(backend);
    let slow = true;
    backend.read = async (p) => {
      if (slow && p.endsWith('base.json')) {
        slow = false;
        await new Promise((r) => setTimeout(r, 20));
      }
      return read(p);
    };
    // A page left while loading closes late; the next page opened meanwhile.
    const first = s.openBase(id).then(() => s.closeBase(id));
    const b = await s.openBase(id);
    await first;
    const t = b.base.tableList()[0];
    b.base.createRecords(t.id, [{ [t.primary.id]: 'from B' }]);
    await s.closeBase(id);
    backend.read = read;
    const again = await (await store(backend)).openBase(id);
    expect([...again.base.table(t.id).records.values()].map((r) => r.c[t.primary.id])).toEqual(['from B']);
  });
});

describe('save retries', () => {
  it('back off beyond the save debounce', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    backend.write = async () => {
      throw new Error('boom');
    };
    sess.base.createRecords(t.id, [{}]);
    const delays = [];
    const real = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => {
      delays.push(ms);
      return real(() => {}, 0);
    };
    try {
      for (let i = 0; i < 3; i++) await sess.flush().catch(() => {});
    } finally {
      globalThis.setTimeout = real;
    }
    expect(delays.filter((ms) => ms >= 2000)).toEqual([2000, 5000, 15000]);
    sess.dispose();
  });
});

describe('an unreadable chunk', () => {
  it('stops the base from opening instead of being overwritten', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    sess.base.createRecords(t.id, [{}, {}]);
    await s.closeBase(id);
    const path = `bases/${id}/t/${t.id}/0.json`;
    await backend.write(path, '{"v":1,"records":[{"id":"rec');
    await expect((await store(backend)).openBase(id)).rejects.toMatchObject({ code: 'corrupt' });
    expect(await (await backend.read(path)).text).toBe('{"v":1,"records":[{"id":"rec');
  });
});

describe('the base list', () => {
  it('is not rewritten when nothing changed', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    s.setStarred(id, true);
    await new Promise((r) => setTimeout(r, 450));
    const writes = [];
    const write = backend.write.bind(backend);
    backend.write = (p, d) => {
      writes.push(p);
      return write(p, d);
    };
    await s.flushAll();
    expect(writes).toEqual([]);
  });
});

describe('the base list shared by tabs and devices', () => {
  it('keeps both changes when two saves of the list overlap', async () => {
    const backend = memoryBackend();
    const s0 = await store(backend);
    const a = await s0.createBase({ name: 'A' });
    const b = await s0.createBase({ name: 'B' });
    let release;
    const gate = new Promise((r) => (release = r));
    let held = false;
    const s = await store({ ...backend, async write(p, d) {
      if (p === 'index.json' && !held) {
        held = true;
        await gate;
      }
      return backend.write(p, d);
    } });
    s.setStarred(a, true);
    const first = s.saveIndex();
    await tick();
    s.setStarred(b, true);
    const second = s.saveIndex();
    await tick();
    release();
    await Promise.all([first, second]);
    await s.saveIndex();
    const c = await store(backend);
    expect([s.entry(a).starred, c.entry(a).starred, c.entry(b).starred]).toEqual([true, true, true]);
  });

  it('keeps a base that another tab wrote an older list over', async () => {
    const backend = memoryBackend();
    const a = await store(backend);
    const keep = await a.createBase({ name: 'Old' });
    // B's write of the list is held, so it lands after A created X.
    let release;
    const gate = new Promise((r) => (release = r));
    const b = await store({ ...backend, async write(p, d) {
      if (p === 'index.json') await gate;
      return backend.write(p, d);
    } });
    b.setStarred(keep, true);
    const saving = b.saveIndex();
    await tick();
    const x = await a.createBase({ name: 'X' });
    release();
    await saving;
    a.setStarred(keep, false);
    await a.saveIndex();
    expect(a.entry(x)).toBeTruthy();
    expect((await store(backend)).entry(x)).toBeTruthy();
  });

  it('keeps bases created, starred and deleted elsewhere', async () => {
    const backend = memoryBackend();
    const a = await store(backend);
    const shared = await a.createBase({ name: 'Shared' });
    const gone = await a.createBase({ name: 'Gone' });
    const b = await store(backend);
    const created = await a.createBase({ name: 'Created in A' });
    a.setStarred(shared, true);
    await a.purgeBase(gone);
    await a.saveIndex();
    // B still has the old list; opening a base saves it.
    await b.openBase(shared);
    await b.saveIndex();
    const c = await store(backend);
    expect(c.bases().map((x) => x.name).sort()).toEqual(['Created in A', 'Shared']);
    expect(c.entry(shared).starred).toBe(true);
    expect(c.entry(created)).toBeTruthy();
    expect(c.entry(gone)).toBeNull();
  });
});

describe('filters', () => {
  it('percent filters read typed numbers as percentages', () => {
    const { base, table, f } = baseWith([{ name: 'Pct', type: 'percent' }]);
    base.createRecords(table.id, [{ [f('Pct').id]: 0.5 }, { [f('Pct').id]: 0.25 }]);
    const v = table.views[0];
    for (const value of ['50', '50%']) {
      base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ fieldId: f('Pct').id, op: '=', value }] } });
      expect(runView(base, table, v).records.length).toBe(1);
    }
  });

  it('duration filters read values as shown', () => {
    const { base, table, f } = baseWith([{ name: 'Dur', type: 'duration', options: { format: 'h:mm' } }]);
    const d = f('Dur').id;
    base.createRecords(table.id, [{ [d]: 5400 }, { [d]: 60 }]);
    const v = table.views[0];
    const count = (op, value) => {
      base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ fieldId: d, op, value }] } });
      return runView(base, table, v).records.length;
    };
    expect(count('=', '1:30')).toBe(1);
    expect(count('=', '90')).toBe(1);
    expect(count('>', '1:00')).toBe(1);
    expect(count('<', '0:02')).toBe(1);
  });

  it('filters on formulas formatted as percent read typed numbers as percentages', () => {
    const { base, table, f } = baseWith([{ name: 'P', type: 'number' }]);
    const p = f('P').id;
    base.addField(table.id, { name: 'Pct', type: 'formula', options: { formula: `{${p}} / 100`, format: 'percent', precision: 0 } });
    base.createRecords(table.id, [{ [p]: 50 }, { [p]: 20 }]);
    const v = table.views[0];
    const count = (op, value) => {
      base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ fieldId: f('Pct').id, op, value }] } });
      return runView(base, table, v).records.length;
    };
    expect(count('=', '50')).toBe(1);
    expect(count('=', '50%')).toBe(1);
    expect(count('>', '30')).toBe(1);
  });
});

describe('date filters', () => {
  it('"today" moves on at local midnight', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      let now = new Date(2026, 9, 12, 23).getTime();
      const { base, table, f } = baseWith([{ name: 'Due', type: 'date' }], { now: () => now });
      const d = f('Due').id;
      base.createRecords(table.id, [{ [d]: '2026-10-12' }, { [d]: '2026-10-13' }]);
      const v = table.views[0];
      base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ fieldId: d, op: 'is', value: { mode: 'today' } }] } });
      const due = () => runView(base, table, v).records.map((r) => r.c[d]);
      expect(due()).toEqual(['2026-10-12']);
      now = new Date(2026, 9, 13, 1).getTime();
      expect(due()).toEqual(['2026-10-13']);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('many records linked to one', () => {
  it('link, unlink and undo in linear time', () => {
    const { base, table } = baseWith();
    const projects = base.addTable('Projects');
    const [p] = base.createRecords(projects, [{}]);
    const link = base.addField(table.id, { name: 'Project', type: 'link', options: { tableId: projects } });
    const inverse = table.field(link).options.inverseId;
    const t0 = performance.now();
    const ids = base.createRecords(table.id, Array.from({ length: 20_000 }, () => ({ [link]: [p] })));
    base.deleteRecords(table.id, ids.slice(0, 10_000));
    base.undo();
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(base.table(projects).record(p).c[inverse].length).toBe(20_000);
    expect(new Set(base.table(projects).record(p).c[inverse])).toEqual(new Set(ids));
  });
});

describe('rollups', () => {
  it('count linked records with empty values', () => {
    const { base, table, f } = baseWith([{ name: 'Done', type: 'checkbox' }]);
    const projects = base.addTable('Projects');
    const link = base.addField(table.id, { name: 'Project', type: 'link', options: { tableId: projects } });
    const inverse = table.field(link).options.inverseId;
    const [p] = base.createRecords(projects, [{}]);
    base.createRecords(table.id, [{ [link]: [p], [f('Done').id]: true }, { [link]: [p] }, { [link]: [p] }]);
    const pt = base.table(projects);
    const roll = (fn) => {
      const id = base.addField(projects, { name: fn, type: 'rollup', options: { linkFieldId: inverse, targetFieldId: f('Done').id, fn } });
      return base.compute.value(pt, pt.record(p), pt.field(id));
    };
    expect(roll('and')).toBe(false);
    expect(roll('or')).toBe(true);
    expect(roll('countAll')).toBe(3);
    expect(roll('sum')).toBe(1);
  });
});

describe('finding linked records by name', () => {
  it('builds the name index once per change', () => {
    const { base, table } = baseWith();
    const name = table.primary.id;
    const ids = base.createRecords(table.id, Array.from({ length: 50_000 }, (_, i) => ({ [name]: `Item ${i}` })));
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) expect(base.compute.findRecords(table.id, [`Item ${i}`])).toEqual([ids[i]]);
    expect(performance.now() - t0).toBeLessThan(1000);
    base.setCell(table.id, ids[0], name, 'Renamed');
    expect(base.compute.findRecords(table.id, ['Renamed'])).toEqual([ids[0]]);
  });
});

describe('formulas using the clock', () => {
  it('move on without edits', () => {
    let now = new Date(2026, 9, 12, 23, 59).getTime();
    const { base, table } = baseWith([], { now: () => now });
    const f = base.addField(table.id, { name: 'Today', type: 'formula', options: { formula: 'TODAY()' } });
    const [id] = base.createRecords(table.id, [{}]);
    const value = () => base.compute.value(table, table.record(id), table.field(f));
    expect(value()).toBe('2026-10-12');
    now += 10 * 60000;
    expect(value()).toBe('2026-10-13');
  });
});

describe('reference cycles through linked records', () => {
  it('show #CYCLE whichever field is computed first', () => {
    for (const order of [['pf', 'tl'], ['tl', 'pf']]) {
      const { base, table } = baseWith();
      const tasks = base.addTable('Tasks');
      const link = base.addField(table.id, { name: 'Tasks', type: 'link', options: { tableId: tasks } });
      const inverse = table.field(link).options.inverseId;
      const [t1] = base.createRecords(tasks, [{}]);
      const [p1] = base.createRecords(table.id, [{ [link]: [t1] }]);
      const pf = base.addField(table.id, { name: 'PF', type: 'formula', options: { formula: '1' } });
      const tl = base.addField(tasks, { name: 'TL', type: 'rollup', options: { linkFieldId: inverse, targetFieldId: pf, fn: 'sum' } });
      const rl = base.addField(table.id, { name: 'RL', type: 'rollup', options: { linkFieldId: link, targetFieldId: tl, fn: 'sum' } });
      base.updateField(table.id, pf, { options: { formula: `{${rl}} + 1` } });
      const tt = base.table(tasks);
      const get = { pf: () => base.compute.value(table, table.record(p1), table.field(pf)), tl: () => base.compute.value(tt, tt.record(t1), tt.field(tl)) };
      for (const k of order) expect(get[k]()?.error).toBe('#CYCLE');
    }
  });
});

describe('formulas over lookups', () => {
  it('get whole names, also through a lookup of a lookup', () => {
    const red = makeChoice('Red, hot');
    const { base, table } = baseWith();
    const tasks = base.addTable('Tasks');
    const tt = base.table(tasks);
    const color = base.addField(tasks, { name: 'Color', type: 'singleSelect', options: { choices: [red] } });
    const link = base.addField(table.id, { name: 'Tasks', type: 'link', options: { tableId: tasks } });
    const [t1] = base.createRecords(tasks, [{ [tt.primary.id]: 'Smith, John', [color]: red.id }]);
    const [p1] = base.createRecords(table.id, [{ [link]: [t1] }]);
    const colors = base.addField(table.id, { name: 'Colors', type: 'lookup', options: { linkFieldId: link, targetFieldId: color } });
    const join = (expr) => {
      const id = base.addField(table.id, { name: `F ${expr}`, type: 'formula', options: { formula: `ARRAYJOIN(${expr}, "|")` } });
      return base.compute.value(table, table.record(p1), table.field(id));
    };
    expect(join(`{${colors}}`)).toBe('Red, hot');
    // A lookup of a lookup, from a table linked to this one.
    const back = tt.field(table.field(link).options.inverseId);
    const deep = base.addField(tasks, { name: 'Deep', type: 'lookup', options: { linkFieldId: back.id, targetFieldId: colors } });
    const f = base.addField(tasks, { name: 'J', type: 'formula', options: { formula: `ARRAYJOIN({${deep}}, "|")` } });
    expect(base.compute.value(tt, tt.record(t1), tt.field(f))).toBe('Red, hot');
  });
});

describe('rollups of links and files as text', () => {
  it('use names', () => {
    const { base, table } = baseWith();
    const tasks = base.addTable('Tasks');
    const tt = base.table(tasks);
    const people = base.addField(tasks, { name: 'Owner', type: 'link', options: { tableId: table.id } });
    const files = base.addField(tasks, { name: 'Files', type: 'attachment' });
    const [ada] = base.createRecords(table.id, [{ [table.primary.id]: 'Ada' }]);
    base.createRecords(tasks, [{ [people]: [ada], [files]: [{ id: 'att1', name: 'a.png', size: 1, type: 'image/png', path: 'p' }] }]);
    const link = tt.field(people).options.inverseId;
    const roll = (target, fn) => {
      const id = base.addField(table.id, { name: `${fn} ${target}`, type: 'rollup', options: { linkFieldId: link, targetFieldId: target, fn } });
      return base.compute.value(table, table.record(ada), table.field(id));
    };
    expect(roll(files, 'concat')).toBe('a.png');
    expect(roll(people, 'concat')).toBe('Ada');
  });
});

describe('a date field without times', () => {
  it('gives formulas its date even when a time is stored', () => {
    const now = new Date(2026, 9, 13, 9).getTime();
    const { base, table, f } = baseWith([{ name: 'D', type: 'date', options: { includeTime: true } }], { now: () => now });
    const d = f('D').id;
    const [id] = base.createRecords(table.id, [{ [d]: new Date(2026, 9, 13, 14).toISOString() }]);
    base.updateField(table.id, d, { options: { ...f('D').options, includeTime: false } });
    const same = base.addField(table.id, { name: 'Same', type: 'formula', options: { formula: `{${d}} = TODAY()` } });
    const next = base.addField(table.id, { name: 'Next', type: 'formula', options: { formula: `DATEADD({${d}}, 1, "days")` } });
    const value = (fid) => base.compute.value(table, table.record(id), table.field(fid));
    expect(value(same)).toBe(true);
    expect(value(next)).toBe('2026-10-14');
  });
});

describe('converting a computed number', () => {
  it('keeps its full value', () => {
    const { base, table } = baseWith();
    const f = base.addField(table.id, { name: 'Avg', type: 'formula', options: { formula: '13 / 8', format: 'integer' } });
    const [id] = base.createRecords(table.id, [{}]);
    base.updateField(table.id, f, { type: 'number', options: { precision: 3 } });
    expect(table.record(id).c[f]).toBe(1.625);
  });
});

describe('undoing a deleted linked record', () => {
  it('restores the order of links on the other side', () => {
    const { base, table } = baseWith();
    const projects = base.addTable('Projects');
    const link = base.addField(table.id, { name: 'Project', type: 'link', options: { tableId: projects } });
    const inverse = table.field(link).options.inverseId;
    const [p] = base.createRecords(projects, [{}]);
    const ids = base.createRecords(table.id, [{ [link]: [p] }, { [link]: [p] }, { [link]: [p] }]);
    const pt = base.table(projects);
    expect(pt.record(p).c[inverse]).toEqual(ids);
    base.deleteRecords(table.id, [ids[0]]);
    base.undo();
    expect(pt.record(p).c[inverse]).toEqual(ids);
    base.redo();
    expect(pt.record(p).c[inverse]).toEqual(ids.slice(1));
  });
});

describe('duplicating a link field', () => {
  it('is one undo step', () => {
    const { base, table } = baseWith();
    const link = base.addField(table.id, { name: 'Related', type: 'link', options: { tableId: table.id } });
    const [a, b] = base.createRecords(table.id, [{}, {}]);
    base.setCell(table.id, a, link, [b]);
    const fields = table.fields.length;
    const copy = base.duplicateField(table.id, link);
    expect(table.record(a).c[copy]).toEqual([b]);
    base.undo();
    expect(table.fields.length).toBe(fields);
  });
});

describe('button fields', () => {
  it('open plain links with query strings', () => {
    const { base, table } = baseWith([{ name: 'Go', type: 'button', options: { label: 'Go', url: 'https://example.com/?a=1&b=2' } }]);
    const [id] = base.createRecords(table.id, [{}]);
    expect(buttonUrl(base, table, table.record(id), table.fieldByName('Go'))).toBe('https://example.com/?a=1&b=2');
  });
});

describe('date defaults', () => {
  it('"today" is the local date', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const { base, table, f } = baseWith([{ name: 'Due', type: 'date', options: { default: 'today' } }], { now: () => new Date(2026, 9, 12, 20, 30).getTime() });
      const [id] = base.createRecords(table.id, [{}]);
      expect(table.record(id).c[f('Due').id]).toBe('2026-10-12');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('gmt date filters', () => {
  it('times shown in GMT filter by the date they show', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const now = new Date(2026, 9, 12, 12).getTime();
      const { base, table, f } = baseWith([{ name: 'At', type: 'date', options: { includeTime: true, gmt: true } }], { now: () => now });
      const d = f('At').id;
      base.createRecords(table.id, [{ [d]: '2026-10-12T02:00:00.000Z' }]);
      const v = table.views[0];
      const count = (value) => {
        base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ fieldId: d, op: 'is', value }] } });
        return runView(base, table, v).records.length;
      };
      expect(count({ mode: 'exactDate', date: '2026-10-12' })).toBe(1);
      expect(count({ mode: 'today' })).toBe(1);
      expect(count({ mode: 'yesterday' })).toBe(0);
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

describe('deleting a field', () => {
  it('removes it from color rules', () => {
    const { base, table, f } = baseWith([{ name: 'Qty', type: 'number' }]);
    const v = table.views[0];
    const qty = f('Qty').id;
    base.updateView(table.id, v.id, { color: { type: 'conditions', rules: [{ id: 'r1', color: 'red', filter: { conjunction: 'and', conditions: [{ id: 'c1', fieldId: qty, op: '>', value: 3 }] } }] } });
    base.apply({ t: 'field.del', table: table.id, id: qty });
    expect(v.color.rules[0].filter.conditions).toEqual([]);
    base.undo();
    expect(v.color.rules[0].filter.conditions[0].fieldId).toBe(qty);
  });
});

describe('changing a field type', () => {
  it('keeps a filter on it meaningful', () => {
    const { base, table, f } = baseWith([{ name: 'Owner', type: 'text' }]);
    const owner = f('Owner').id;
    base.createRecords(table.id, [{ [owner]: 'Maya' }, { [owner]: 'Ravi' }]);
    const v = table.views[0];
    base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ id: 'c1', fieldId: owner, op: 'is', value: 'Maya' }] } });
    expect(runView(base, table, v).records.length).toBe(1);
    base.updateField(table.id, owner, { type: 'singleSelect', options: { choices: [] } });
    const maya = f('Owner').options.choices.find((c) => c.name === 'Maya');
    expect(v.filters.conditions[0].value).toBe(maya.id);
    expect(runView(base, table, v).records.length).toBe(1);
    base.undo();
    expect(f('Owner').type).toBe('text');
    expect(v.filters.conditions[0].value).toBe('Maya');
    expect(runView(base, table, v).records.length).toBe(1);    base.redo();
    expect(v.filters.conditions[0].value).toBe(maya.id);
    expect(runView(base, table, v).records.length).toBe(1);
  });

  it('keeps option names with commas whole', () => {
    const smith = makeChoice('Smith, John');
    const { base, table, f } = baseWith([{ name: 'Owner', type: 'singleSelect', options: { choices: [smith] } }]);
    const owner = f('Owner').id;
    const [id] = base.createRecords(table.id, [{ [owner]: smith.id }]);
    base.updateField(table.id, owner, { type: 'multipleSelect', options: { choices: [smith] } });
    expect(f('Owner').options.choices.map((c) => c.name)).toEqual(['Smith, John']);
    expect(table.record(id).c[owner]).toEqual([smith.id]);
    base.updateField(table.id, owner, { type: 'text' });
    expect(table.record(id).c[owner]).toBe('Smith, John');
  });

  it('links text to records whose names contain commas', () => {
    const { base, table, f } = baseWith([{ name: 'Client', type: 'text' }]);
    const name = f('Name').id;
    const client = f('Client').id;
    const [beta] = base.createRecords(table.id, [{ [name]: 'Beta, Inc' }]);
    const [deal] = base.createRecords(table.id, [{ [name]: 'Deal', [client]: 'Beta, Inc' }]);
    base.updateField(table.id, client, { type: 'link', options: { tableId: table.id } });
    expect(table.record(deal).c[client]).toEqual([beta]);
  });

  it('links text with several names that contain quotes', () => {
    const { base, table, f } = baseWith([{ name: 'Items', type: 'text' }]);
    const name = f('Name').id;
    const items = f('Items').id;
    const [a, b] = base.createRecords(table.id, [{ [name]: '27" monitor' }, { [name]: '24" monitor' }]);
    const [order] = base.createRecords(table.id, [{ [name]: 'Order', [items]: '27" monitor, 24" monitor' }]);
    base.updateField(table.id, items, { type: 'link', options: { tableId: table.id } });
    expect(table.record(order).c[items]).toEqual([a, b]);
  });

  it('resets a condition whose operator no longer applies', () => {
    const { base, table, f } = baseWith([{ name: 'Code', type: 'text' }]);
    const code = f('Code').id;
    base.createRecords(table.id, [{ [code]: '12' }, { [code]: '7' }]);
    const v = table.views[0];
    base.updateView(table.id, v.id, { filters: { conjunction: 'and', conditions: [{ id: 'c1', fieldId: code, op: 'contains', value: '1' }] } });
    base.updateField(table.id, code, { type: 'number' });
    expect(v.filters.conditions[0]).toMatchObject({ op: '=', value: null });
    expect(runView(base, table, v).records.length).toBe(2);
  });
});

describe('grouping', () => {
  it('groups a very large group without overflowing the stack', () => {
    const { base, table, f } = baseWith([{ name: 'S', type: 'singleSelect', options: { choices: [{ id: 'selA', name: 'A', color: 'blue' }] } }]);
    const s = f('S').id;
    base.createRecords(table.id, Array.from({ length: 200_000 }, () => ({ [s]: 'selA' })));
    const v = table.views[0];
    base.updateView(table.id, v.id, { groups: [{ fieldId: s, dir: 'asc' }] });
    expect(runView(base, table, v).records.length).toBe(200_000);
  });
});

describe('grid', () => {
  function sized(g, w, h) {
    Object.defineProperty(g.scroller, 'clientWidth', { configurable: true, get: () => w });
    Object.defineProperty(g.scroller, 'clientHeight', { configurable: true, get: () => h });
    const rect = () => ({ left: 0, top: 0, width: w, height: h, right: w, bottom: h });
    g.el.getBoundingClientRect = rect;
    g.scroller.getBoundingClientRect = rect;
    g.resize();
  }

  function press(g, x, y, opts = {}) {
    const e = new MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...opts });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    g.scroller.dispatchEvent(e);
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  }

  async function grid() {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const files = page.base.addField(t.id, { name: 'Files', type: 'attachment' });
    page.base.createRecords(t.id, [{ [t.primary.id]: 'A', [files]: [{ id: 'att1', name: 'x.png', size: 1, type: 'image/png', path: 'p' }] }]);
    await tick();
    return { page, g: page.viewInst, t, files };
  }

  it('pasting text over an attachment column keeps the files', async () => {
    const { g, t, files } = await grid();
    const c = g.layout.cols.findIndex((x) => x.field.id === files);
    g.setCursor(0, c - 1);
    g.pasteText('note\tsomething');
    expect(t.ordered()[0].c[files].length).toBe(1);
  });

  it('Tab at the last cell leaves the grid', async () => {
    const { g } = await grid();
    g.setCursor(0, g.layout.cols.length - 1);
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    g.scroller.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    g.setCursor(0, 0);
    key(g.scroller, 'Tab');
    expect(g.cursor.c).toBe(1);
  });

  it('pressing a day in the date editor keeps the editor open', async () => {
    const { page, g, t } = await grid();
    const due = page.base.addField(t.id, { name: 'Due', type: 'date' });
    await tick();
    g.setCursor(0, g.layout.cols.findIndex((x) => x.field.id === due));
    g.startEdit();
    const day = document.querySelector('.calendar .cal-grid button');
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    day.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it('a date edit ends when focus leaves its calendar', async () => {
    const { page, g, t } = await grid();
    const due = page.base.addField(t.id, { name: 'Due', type: 'date' });
    await tick();
    g.setCursor(0, g.layout.cols.findIndex((x) => x.field.id === due));
    g.startEdit();
    const input = document.querySelector('.cell-editor');
    input.value = '3/5/2026';
    key(input, 'ArrowDown', { altKey: true });
    const day = document.querySelector('.calendar .cal-grid button');
    day.focus();
    input.dispatchEvent(new FocusEvent('blur'));
    await tick();
    expect(g.editor).toBeTruthy();
    // Focus moves on from the calendar to the page.
    day.blur();
    await tick();
    expect(g.editor).toBeFalsy();
    expect(t.ordered()[0].c[due]).toBe('2026-03-05');
  });

  it('typing "?" into a cell does not open the shortcuts', async () => {
    const { g, t } = await grid();
    g.setCursor(0, 0);
    key(g.scroller, '?');
    expect(document.querySelector('dialog[open]')).toBeNull();
    const input = document.querySelector('.cell-editor');
    expect(input.value).toBe('?');
    key(input, 'Enter');
    expect(t.ordered()[0].c[t.primary.id]).toBe('?');
  });

  it('pastes rows into an empty table', async () => {
    const { page, g, t } = await grid();
    page.base.deleteRecords(t.id, t.ordered().map((r) => r.id));
    await tick();
    g.scroller.focus();
    const e = new Event('paste', { bubbles: true, cancelable: true });
    e.clipboardData = { getData: () => 'One\nTwo' };
    document.dispatchEvent(e);
    expect(t.ordered().map((r) => r.c[t.primary.id])).toEqual(['One', 'Two']);
  });

  it('shift-checks rows from the last checked record after the view changes', async () => {
    const { page, g, t } = await grid();
    const name = t.primary.id;
    page.base.createRecords(t.id, [{ [name]: 'B' }, { [name]: 'C' }]);
    await tick();
    g.toggleChecked(g.layout.records[2].id, null);
    // Sort descending: the checked record moves to the top.
    page.base.updateView(t.id, g.view.id, { sorts: [{ fieldId: name, dir: 'desc' }] });
    await tick();
    g.toggleChecked(g.layout.records[1].id, 1);
    expect([...g.checked].map((id) => t.record(id).c[name]).sort()).toEqual(['B', 'C']);
    // Filter it out: a shift-click is a plain check.
    page.base.updateView(t.id, g.view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: name, op: 'is', value: 'A' }] } });
    await tick();
    expect(() => g.toggleChecked(g.layout.records[0].id, 0)).not.toThrow();
  });

  it('forgets checked rows that a filter hides', async () => {
    const { page, g, t } = await grid();
    const name = t.primary.id;
    page.base.createRecords(t.id, [{ [name]: 'B' }]);
    await tick();
    for (const r of g.layout.records) g.toggleChecked(r.id, null);
    page.base.updateView(t.id, g.view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: name, op: 'is', value: 'A' }] } });
    await tick();
    expect([...g.checked].map((id) => t.record(id).c[name])).toEqual(['A']);
  });

  it('shift-click on a checkbox cell extends the selection without toggling', async () => {
    const { page, g, t } = await grid();
    const done = page.base.addField(t.id, { name: 'Done', type: 'checkbox' });
    await tick();
    sized(g, 1200, 600);
    const c = g.layout.cols.findIndex((x) => x.field.id === done);
    const col = g.layout.cols[c];
    const row = g.layout.rows[g.layout.recRow[0]];
    g.setCursor(0, 0);
    press(g, col.x + col.w / 2, HEADER_H + row.y + row.h / 2, { shiftKey: true });
    expect(g.cursor).toEqual({ r: 0, c });
    expect(t.ordered()[0].c[done]).toBeUndefined();
  });

  it('a re-sort does not stretch a selection over other records', async () => {
    const { page, g, t } = await grid();
    const name = t.primary.id;
    const qty = page.base.addField(t.id, { name: 'Qty', type: 'number' });
    const a = t.ordered()[0].id;
    page.base.setCell(t.id, a, qty, 2);
    page.base.createRecords(t.id, [{ [name]: 'B', [qty]: 1 }, { [name]: 'C', [qty]: 3 }]);
    await tick();
    // Select B..C, then sort by Qty: A lands between them.
    g.anchor = { r: 1, c: 0 };
    g.cursor = { r: 2, c: 0 };
    page.base.updateView(t.id, g.view.id, { sorts: [{ fieldId: qty, dir: 'asc' }] });
    await tick();
    const rg = g.range();
    const selected = g.layout.records.slice(rg.r0, rg.r1 + 1).map((r) => r.c[name]);
    expect(selected).not.toContain('A');
  });

  it('refits frozen columns when the grid gets narrower', async () => {
    const { page, g, t } = await grid();
    for (const n of ['B', 'C', 'D']) page.base.addField(t.id, { name: n, type: 'text' });
    page.base.updateView(t.id, g.view.id, { frozen: 3 });
    await tick();
    sized(g, 1600, 600);
    expect(g.layout.frozen).toBe(3);
    sized(g, 700, 600);
    expect(g.layout.frozenW).toBeLessThanOrEqual(700 - 160);
    sized(g, 1600, 600);
    expect(g.layout.frozen).toBe(3);
  });

  it('resizes its canvas when the pixel density changes', async () => {
    const { g } = await grid();
    sized(g, 800, 600);
    const dpr = window.devicePixelRatio;
    try {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
      g.resize();
      expect(g.canvas.width).toBe(1600);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: dpr });
    }
  });

  it('fill handle released inside the selection changes nothing', async () => {
    const { page, g, t } = await grid();
    const name = t.primary.id;
    page.base.createRecords(t.id, [{ [name]: 'B' }, { [name]: 'C' }]);
    await tick();
    g.anchor = { r: 0, c: 0 };
    g.cursor = { r: 1, c: 0 };
    const steps = page.base.undoStack.length;
    g.fillDown(1);
    expect(page.base.undoStack.length).toBe(steps);
    // Ctrl+D still copies the first row down.
    g.anchor = { r: 0, c: 0 };
    g.cursor = { r: 2, c: 0 };
    key(g.scroller, 'd', { ctrlKey: true });
    expect(t.ordered().map((r) => r.c[name])).toEqual(['A', 'A', 'A']);
  });

  it('a fill handle scrolled under the frozen columns cannot be grabbed', async () => {
    const { page, g, t } = await grid();
    for (const n of ['B', 'C', 'D', 'E', 'F']) page.base.addField(t.id, { name: n, type: 'text' });
    await tick();
    sized(g, 700, 400);
    const c = g.layout.frozen;
    g.setCursor(0, c, { scroll: false });
    // Scroll the selected column fully under the frozen ones (jsdom does not scroll).
    const col = g.layout.cols[c];
    Object.defineProperty(g.scroller, 'scrollLeft', { configurable: true, get: () => col.x + col.w - g.layout.frozenW + 40, set() {} });
    g.paint();
    expect(g.fillHandle).toBeNull();
  });

  it('a click past the drawn stars does not set a rating', async () => {
    const { page, g, t } = await grid();
    const stars = page.base.addField(t.id, { name: 'Stars', type: 'rating', options: { max: 10 } });
    await tick();
    sized(g, 1200, 600);
    const c = g.layout.cols.findIndex((x) => x.field.id === stars);
    page.base.updateView(t.id, g.view.id, { widths: { ...(g.view.widths || {}), [stars]: 100 } });
    await tick();
    const col = g.layout.cols[c];
    const row = g.layout.rows[g.layout.recRow[0]];
    // 100px fits 5 stars; the right edge is where a 6th would be.
    expect(g.cellClick(row, c, g.layout.colX(c, 0) + col.w - 2, HEADER_H + row.y + 10)).toBe(false);
    expect(t.ordered()[0].c[stars]).toBeUndefined();
    expect(g.cellClick(row, c, g.layout.colX(c, 0) + 8 + 17 * 4 + 5, HEADER_H + row.y + 10)).toBe(true);
    expect(t.ordered()[0].c[stars]).toBe(5);
  });

  it('the date editor of a GMT field picks the day it shows', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      const { page, g, t } = await grid();
      const at = page.base.addField(t.id, { name: 'At', type: 'date', options: { includeTime: true, gmt: true } });
      page.base.setCell(t.id, t.ordered()[0].id, at, '2026-10-12T02:00:00.000Z');
      await tick();
      g.setCursor(0, g.layout.cols.findIndex((x) => x.field.id === at));
      g.startEdit();
      expect(document.querySelector('.calendar .cal-day.selected').getAttribute('aria-label')).toBe('October 12, 2026');
      click(document.querySelector('.calendar .cal-day[aria-label="October 14, 2026"]'));
      expect(t.ordered()[0].c[at]).toBe('2026-10-14T02:00:00.000Z');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('opening and leaving a cell editor keeps a value its text rounds', async () => {
    const { page, g, t } = await grid();
    const dur = page.base.addField(t.id, { name: 'Dur', type: 'duration', options: { format: 'h:mm' } });
    page.base.setCell(t.id, t.ordered()[0].id, dur, 90);
    await tick();
    g.setCursor(0, g.layout.cols.findIndex((x) => x.field.id === dur));
    g.startEdit();
    key(document.querySelector('.cell-editor'), 'Enter');
    expect(t.ordered()[0].c[dur]).toBe(90);
  });

  it('steps on from a record that an edit filtered out', async () => {
    const { page, t } = await grid();
    const name = t.primary.id;
    const done = page.base.addField(t.id, { name: 'Done', type: 'checkbox' });
    page.base.createRecords(t.id, [{ [name]: 'B' }, { [name]: 'C' }]);
    page.base.updateView(t.id, page.view.id, { filters: { conjunction: 'and', conditions: [{ fieldId: done, op: 'is', value: false }] } });
    await tick();
    const [, b] = t.ordered();
    page.openRecord(b.id);
    await tick();
    page.base.setCell(t.id, b.id, done, true);
    await tick();
    const next = document.querySelector('[aria-label="Next record"]');
    expect(next.disabled).toBe(false);
    click(next);
    expect(document.querySelector('.record-title').textContent).toBe('C');
  });

  it('keeps a comment being written when the base changes', async () => {
    const { page, t } = await grid();
    page.openRecord(t.ordered()[0].id);
    // The dialog focuses its first field on the next frame.
    await tick(20);
    const box = document.querySelector('.comment-input');
    box.focus();
    box.value = 'Half a thought';
    page.base.createRecords(t.id, [{}]);
    await tick();
    expect(document.querySelector('.comment-input').value).toBe('Half a thought');
    expect(document.activeElement).toBe(document.querySelector('.comment-input'));
  });

  it('returns focus to a field after its picker in a record closes', async () => {
    const { page, t } = await grid();
    const tags = page.base.addField(t.id, { name: 'Tags', type: 'multipleSelect', options: { choices: [{ id: 'selA', name: 'A', color: 'blue' }] } });
    page.openRecord(t.ordered()[0].id);
    await tick();
    const box = document.querySelector(`[data-field="${tags}"] .multi-input`);
    box.focus();
    click(box);
    const input = document.querySelector('.popover input');
    key(input, 'Enter');
    key(input, 'Escape');
    expect(t.ordered()[0].c[tags]).toEqual(['selA']);
    expect(document.activeElement).toBe(document.querySelector(`[data-field="${tags}"] .multi-input`));
  });

  it('find, quick search and the sidebar shortcut wait while a record is open', async () => {
    const { page, t } = await grid();
    page.openRecord(t.ordered()[0].id);
    await tick(20);
    const collapsed = document.querySelector('.basepage')?.className;
    key(document.activeElement, 'f', { ctrlKey: true });
    key(document.activeElement, 'k', { ctrlKey: true });
    key(document.activeElement, 'l', { ctrlKey: true, shiftKey: true });
    expect(document.querySelector('.findbar')).toBeNull();
    expect(document.querySelector('.palette')).toBeNull();
    expect(document.querySelector('.basepage')?.className).toBe(collapsed);
  });

  it('Ctrl+K twice keeps one quick search open', async () => {
    const { g } = await grid();
    key(g.scroller, 'k', { ctrlKey: true });
    key(document.activeElement, 'k', { ctrlKey: true });
    expect(document.querySelectorAll('.palette').length).toBe(1);
  });

  it('titles the browser tab with the view, table and base', async () => {
    const { page, t } = await grid();
    expect(document.title).toBe(`Grid view \u2013 ${t.name} \u2013 ${page.base.doc.name} \u2013 Records`);
    page.base.apply({ t: 'base.set', patch: { name: 'Renamed' } });
    expect(document.title).toContain('Renamed');
    page.app.navigate('');
    await page.app.route();
    expect(document.title).toBe('Records');
  });

  it('pastes a copied link into a text cell without quotes', async () => {
    const { page, g, t } = await grid();
    const name = t.primary.id;
    const link = page.base.addField(t.id, { name: 'Client', type: 'link', options: { tableId: t.id } });
    const note = page.base.addField(t.id, { name: 'Note', type: 'text' });
    const [acme] = page.base.createRecords(t.id, [{ [name]: 'Acme, Inc' }]);
    page.base.setCell(t.id, t.ordered()[0].id, link, [acme]);
    await tick();
    g.scroller.focus();
    const c = g.layout.cols.findIndex((x) => x.field.id === link);
    g.setCursor(0, c);
    let copied = '';
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    copy.clipboardData = { setData: (type, v) => (copied = v) };
    document.dispatchEvent(copy);
    g.setCursor(0, g.layout.cols.findIndex((x) => x.field.id === note));
    g.pasteText(copied);
    expect(t.ordered()[0].c[note]).toBe('Acme, Inc');
  });

  it('leaving a base with a record open goes home cleanly', async () => {
    const { page } = await grid();
    page.openRecord(page.table.ordered()[0].id);
    await tick();
    const app = page.app;
    app.navigate('');
    await app.route();
    expect(location.hash).toBe('#/');
  });
});

describe('wrapped cell text', () => {
  it('ends with an ellipsis exactly when text is cut', () => {
    const ctx = document.createElement('canvas').getContext('2d');
    const P = new Painter(ctx, {}, () => {}, () => null);
    // 7px per character: "Line1" is 35px wide.
    expect(P.wrap('Line1\nLine2\nX', 60, 2).at(-1)).toMatch(/…$/);
    expect(P.wrap('aaaa    bbbb', 60, 2)).toEqual(['aaaa', 'bbbb']);
    expect(P.wrap('one\ntwo', 60, 2)).toEqual(['one', 'two']);
    expect(P.wrap('one\ntwo\n', 60, 2)).toEqual(['one', 'two']);
  });
});

describe('grid thumbnails', () => {
  it('keep a bounded number of bitmaps and close the rest', async () => {
    const closed = [];
    const real = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async () => ({ close() {
      closed.push(this);
    } });
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      const P = new Painter(ctx, {}, () => {}, async () => new Blob(['x']));
      for (let i = 0; i < 1100; i++) P.thumb({ thumb: `t${i}`, type: 'image/png' });
      await tick(5);
      expect(P.thumbs.size).toBe(1000);
      expect(closed.length).toBe(100);
      P.destroy();
      expect(closed.length).toBe(1100);
    } finally {
      globalThis.createImageBitmap = real;
    }
  });
});

describe('single select picker', () => {
  it('ignores Enter that confirms an input method composition', async () => {
    const { base, table, f } = baseWith([{ name: 'S', type: 'singleSelect', options: { choices: [] } }]);
    const anchor = document.body.appendChild(document.createElement('button'));
    const pop = openChoicePicker(anchor, base, table, f('S'), {});
    const input = pop.el.querySelector('input');
    input.value = 'にほん';
    input.dispatchEvent(new Event('input'));
    key(input, 'Enter', { isComposing: true });
    expect(f('S').options.choices).toEqual([]);
    pop.close();
    anchor.remove();
  });

  it('closes once an option is chosen or added', async () => {
    const { base, table, f } = baseWith([{ name: 'S', type: 'singleSelect', options: { choices: [] } }]);
    const anchor = document.body.appendChild(document.createElement('button'));
    const changes = [];
    const pop = openChoicePicker(anchor, base, table, f('S'), { onChange: (ids) => changes.push(ids) });
    const input = pop.el.querySelector('input');
    input.value = 'New';
    input.dispatchEvent(new Event('input'));
    key(input, 'Enter');
    key(input, 'Enter');
    expect(pop.closed).toBe(true);
    expect(f('S').options.choices.map((c) => c.name)).toEqual(['New']);
    anchor.remove();
  });
});

describe('field editor', () => {
  it('drops a default option that was removed', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const a = { id: 'selA', name: 'A', color: 'blue' };
    const b = { id: 'selB', name: 'B', color: 'red' };
    const f = page.base.addField(t.id, { name: 'S', type: 'singleSelect', options: { choices: [a, b], default: 'selB' } });
    const anchor = document.body.appendChild(document.createElement('button'));
    openFieldEditor(anchor, page, t, { field: t.field(f) });
    click(document.querySelector('[aria-label="Remove B"]'));
    expect([...document.querySelectorAll('select[aria-label="Default option"] option')].map((o) => o.textContent)).toEqual(['None', 'A']);
    click([...document.querySelectorAll('.popover .btn.primary')].find((x) => x.textContent === 'Save'));
    await tick();
    expect(t.field(f).options.default).toBeUndefined();
    const [rid] = page.base.createRecords(t.id, [{}]);
    expect(t.record(rid).c[f]).toBeUndefined();
    anchor.remove();
  });

  it('shows a button link with field names after switching types back', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const f = page.base.addField(t.id, { name: 'Go', type: 'button', options: { label: 'Go', url: `"https://x.com/?q=" & {${t.primary.id}}` } });
    const anchor = document.body.appendChild(document.createElement('button'));
    openFieldEditor(anchor, page, t, { field: t.field(f) });
    const pick = (label) => {
      click(document.querySelector('.popover .type-btn'));
      click([...document.querySelectorAll('.popover .menu-item')].find((x) => x.textContent.includes(label)));
    };
    pick('Single line text');
    pick('Button');
    const link = [...document.querySelectorAll('.popover input.input')].find((x) => x.value.includes('https://x.com'));
    expect(link.value).toContain('{Name}');
    anchor.remove();
  });

  it('does not save a formula that does not parse', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const f = page.base.addField(t.id, { name: 'F', type: 'formula', options: { formula: '1' } });
    const anchor = document.body.appendChild(document.createElement('button'));
    openFieldEditor(anchor, page, t, { field: t.field(f) });
    const ta = document.querySelector('.formula-input');
    ta.value = '{Name} & (';
    ta.dispatchEvent(new Event('input'));
    click([...document.querySelectorAll('.popover .btn.primary')].find((b) => b.textContent === 'Save'));
    await tick();
    expect(t.field(f).options.formula).toBe('1');
    anchor.remove();
  });
});

describe('menus', () => {
  it('Home, End and typing skip disabled items', () => {
    const anchor = document.body.appendChild(document.createElement('button'));
    const chosen = [];
    openMenu(anchor, [
      { label: 'Archive', disabled: true, onSelect: () => chosen.push('Archive') },
      { label: 'Copy', onSelect: () => chosen.push('Copy') },
      { label: 'Delete', onSelect: () => chosen.push('Delete') },
      { label: 'Duplicate', disabled: true, onSelect: () => chosen.push('Duplicate') },
    ]);
    const menu = document.querySelector('.popover [role="menu"]') || document.querySelector('.popover');
    const press = (k) => key(document.activeElement || menu, k);
    press('Home');
    press('Enter');
    expect(chosen).toEqual(['Copy']);
    openMenu(anchor, [{ label: 'Archive' }, { label: 'Delete', onSelect: () => chosen.push('Delete') }, { label: 'Duplicate', disabled: true }]);
    press('End');
    press('Enter');
    expect(chosen).toEqual(['Copy', 'Delete']);
    openMenu(anchor, [{ label: 'Copy' }, { label: 'Duplicate', disabled: true }, { label: 'Delete', onSelect: () => chosen.push('Delete again') }]);
    press('d');
    press('Enter');
    expect(chosen).toEqual(['Copy', 'Delete', 'Delete again']);
    anchor.remove();
  });
});

describe('record picker', () => {
  it('keeps the highlight on the record that was just linked', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const link = page.base.addField(t.id, { name: 'Related', type: 'link', options: { tableId: t.id } });
    const [rec] = page.base.createRecords(t.id, [{ [t.primary.id]: 'Alpha' }, { [t.primary.id]: 'Beta' }, { [t.primary.id]: 'Gamma' }]);
    const anchor = document.body.appendChild(document.createElement('button'));
    const pop = openRecordPicker(anchor, page, t, t.field(link), t.record(rec));
    const input = pop.el.querySelector('input');
    const active = () => pop.el.querySelector('.record-item.active .record-name').textContent;
    while (active() !== 'Gamma') key(input, 'ArrowDown');
    key(input, 'Enter');
    expect(active()).toBe('Gamma');
    key(input, 'Enter');
    expect(t.record(rec).c[link] || []).toEqual([]);
    pop.close();
    anchor.remove();
  });
});

describe('home', () => {
  it('keeps focus on the layout toggle', async () => {
    const { app, store: st } = await mountApp();
    await st.createBase({ name: 'Plans' });
    app.navigate('');
    await app.route();
    const list = document.querySelector('[aria-label="List layout"]');
    list.focus();
    click(list);
    await tick();
    expect(document.activeElement.getAttribute('aria-label')).toBe('List layout');
  });

  it('keeps focus on a star after starring a base', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase({ name: 'Plans' });
    app.navigate('');
    await app.route();
    const star = document.querySelector(`[data-base="${id}"] .star-btn`);
    star.focus();
    click(star);
    await tick();
    expect(document.activeElement.classList.contains('star-btn')).toBe(true);
    expect(document.activeElement.closest('[data-base]').dataset.base).toBe(id);
  });
});

describe('navigating while a base loads', () => {
  it('ends up where the latest navigation pointed', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    let page = await openBase(app, id);
    const second = page.base.addTable('Second');
    const first = page.table.id;
    app.navigate('');
    await app.route();
    // Open the base on its first table, then switch tables before it loads.
    location.hash = `/${id}/${first}`;
    const loading = app.route();
    page = app.page;
    page.go(second, null);
    await loading;
    await tick(5);
    expect(app.page.tableId).toBe(second);
    expect(location.hash).toContain(second);
  });
});

describe('a link to a deleted record', () => {
  it('opens the table and says the record is gone', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    location.hash = `/${id}/${t.id}/${t.views[0].id}/recGone000000000`;
    await app.route();
    expect(location.hash).toBe(`#/${id}/${t.id}/${t.views[0].id}`);
    expect(document.querySelector('.toast').textContent).toContain('no longer exists');
  });
});

describe('view list', () => {
  it('names a view and its type once', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    page.base.addView(page.table.id, 'kanban', 'Board');
    await tick();
    const labels = [...document.querySelectorAll('a.view-link')].map((a) => a.getAttribute('aria-label'));
    expect(labels).toEqual(['Grid view', 'Board, Kanban view']);
  });
});

describe('history', () => {
  it('Back past a deleted view does not get stuck', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const v1 = t.views[0].id;
    const v2 = page.base.addView(t.id, 'grid', 'Second');
    page.go(t.id, v2);
    page.base.apply({ t: 'view.del', table: t.id, id: v2 });
    const length = history.length;
    // Back lands on the deleted view's address, which falls back to the first view.
    history.replaceState(null, '', `#/${id}/${t.id}/${v2}`);
    await app.route();
    expect(location.hash).toBe(`#/${id}/${t.id}/${v1}`);
    expect(history.length).toBe(length);
  });
});

describe('leaving a base', () => {
  it('does not keep its account button (and the page behind it) alive', async () => {
    const { app } = await mountApp();
    expect([...app.avatars].every((ref) => ref instanceof WeakRef)).toBe(true);
    app.setPicture('data:image/png;base64,AAAA');
    expect(document.querySelector('.account-btn img.avatar')).not.toBeNull();
  });

  it('closes its menus and Undo toasts', async () => {
    const { app, store: st } = await mountApp();
    const id = await st.createBase();
    const page = await openBase(app, id);
    page.toastUndo('Deleted Notes');
    openPopover(document.querySelector('button'), document.createTextNode('Filter'));
    app.navigate('');
    await app.route();
    expect(popoverOpen()).toBe(false);
    expect([...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Deleted Notes'))).toBe(false);
  });
});

describe('floating ui over dialogs', () => {
  it('a drag that ends outside a dialog does not close it', () => {
    const dlg = openDialog({ title: 'Rename', body: document.createElement('input') });
    dlg.el.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 });
    const at = (type, x, y) => dlg.el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
    // Pressed inside (on the input), released outside: the click lands on the dialog.
    dlg.body.firstChild.dispatchEvent(new MouseEvent('pointerdown', { clientX: 200, clientY: 200, bubbles: true }));
    at('click', 50, 50);
    expect(dlg.el.isConnected).toBe(true);
    at('pointerdown', 50, 50);
    at('click', 50, 50);
    expect(dlg.el.isConnected).toBe(false);
  });

  it('runs a dialog action once on a double click', async () => {
    let runs = 0;
    const dlg = openDialog({ title: 'Import', body: document.createElement('div'), actions: [{ label: 'Import', primary: true, onClick: async () => {
      runs++;
      await tick(10);
    } }] });
    const btn = dlg.actions[0].el;
    btn.click();
    btn.click();
    await tick(20);
    expect(runs).toBe(1);
  });

  it('announcements while a dialog is open are made inside it', async () => {
    const dlg = openDialog({ title: 'Record', body: document.createElement('div') });
    announce('Record 2 of 4');
    await tick(40);
    expect(dlg.el.querySelector('[data-live]').textContent).toBe('Record 2 of 4');
    dlg.close();
  });

  it('popovers and toasts opened from a modal dialog render inside it', () => {
    const dlg = openDialog({ title: 'Record', body: document.createElement('div') });
    const anchor = dlg.body.appendChild(document.createElement('button'));
    const p = openPopover(anchor, document.createTextNode('Options'));
    expect(dlg.el.contains(p.el)).toBe(true);
    toast('Link copied');
    const host = document.querySelector('.toasts');
    expect(dlg.el.contains(host)).toBe(true);
    dlg.close();
    expect(popoverOpen()).toBe(false);
    expect(host.parentNode).toBe(document.body);
    host.remove();
  });
});

async function gridBase(names = ['A', 'B', 'C']) {
  const { app, store: st } = await mountApp();
  const id = await st.createBase();
  const page = await openBase(app, id);
  const t = page.table;
  page.base.createRecords(t.id, names.map((n) => ({ [t.primary.id]: n })));
  await tick();
  return { app, store: st, page, g: page.viewInst, t };
}

describe('expanded record', () => {
  it('stepping with the keyboard saves the field being typed in to its own record', async () => {
    const { page, t } = await gridBase(['one', 'two']);
    const [r1, r2] = t.ordered();
    page.openRecord(r1.id);
    await tick(20);
    const input = document.querySelector(`[data-field="${t.primary.id}"] input`);
    // Browsers send change when an edited input loses focus; jsdom does not.
    input.addEventListener('blur', () => input.dispatchEvent(new Event('change')));
    input.focus();
    input.value = 'edited';
    key(input, '.', { ctrlKey: true, shiftKey: true });
    expect(document.querySelector('.record-title').textContent).toBe('two');
    const now = document.querySelector(`[data-field="${t.primary.id}"] input`);
    expect(now.value).toBe('two');
    expect(document.activeElement).toBe(now);
    now.blur();
    expect(t.record(r1.id).c[t.primary.id]).toBe('edited');
    expect(t.record(r2.id).c[t.primary.id]).toBe('two');
  });

  it('stepping keeps focus on the field input, not its description icon', async () => {
    const { page, t } = await gridBase(['one', 'two']);
    page.base.updateField(t.id, t.primary.id, { description: 'The name' });
    page.openRecord(t.ordered()[0].id);
    await tick(20);
    document.querySelector(`[data-field="${t.primary.id}"] input`).focus();
    key(document.activeElement, '.', { ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(document.querySelector(`[data-field="${t.primary.id}"] input`));
  });
});
