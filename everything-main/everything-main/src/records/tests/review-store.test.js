/**
 * Storage fixes from review: offline journals, tabs and devices saving the
 * same base, the base list.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { Store } from '../src/data/store.js';
import { memoryBackend, memoryKv } from '../src/data/backend.js';
import { memoryJournal, indexedDbJournal, journalName } from '../src/data/journal.js';
import { mountApp, openBase, click, tick } from './helpers/app.js';
import { openFieldEditor } from '../src/ui/fieldeditor.js';
import { baseWith } from './helpers/base.js';

async function store(backend = memoryBackend(), journal = memoryJournal(), opts = {}) {
  const s = new Store({ backend, kv: memoryKv(), journal, user: 't', ...opts });
  await s.init();
  return s;
}

/** Make every write fail, as when the network is gone. Returns a restore function. */
function offline(backend) {
  const write = backend.write;
  backend.write = async () => {
    throw new TypeError('Failed to fetch');
  };
  return () => (backend.write = write);
}

const names = (table) => [...table.records.values()].map((r) => r.c[table.primary.id]).sort();

describe('tabs editing one base offline', () => {
  it('keep each tab’s unsaved changes', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const id = await (await store(backend, journal)).createBase();
    const a = await store(backend, journal);
    const b = await store(backend, journal);
    const sa = await a.openBase(id);
    const sb = await b.openBase(id);
    const t = sa.base.tableList()[0];
    const online = offline(backend);
    sa.base.createRecords(t.id, [{ [t.primary.id]: 'from A' }]);
    sb.base.createRecords(t.id, [{ [t.primary.id]: 'from B' }]);
    await a.closeBase(id);
    await b.closeBase(id);
    online();
    const again = await (await store(backend, journal)).openBase(id);
    expect(names(again.base.table(t.id))).toEqual(['from A', 'from B']);
  });

  it('a save in one tab keeps the journal of another', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const id = await (await store(backend, journal)).createBase();
    const a = await store(backend, journal);
    const b = await store(backend, journal);
    const sa = await a.openBase(id);
    const sb = await b.openBase(id);
    const t = sa.base.tableList()[0];
    // Tab A's edit reached only its journal before the tab was killed.
    sa.base.createRecords(t.id, [{ [t.primary.id]: 'from A' }]);
    sa.dispose();
    await sa.writeJournal();
    sb.base.createRecords(t.id, [{ [t.primary.id]: 'from B' }]);
    await sb.flush();
    await sb.writeJournal();
    const again = await (await store(backend, journal)).openBase(id);
    expect(names(again.base.table(t.id))).toEqual(['from A', 'from B']);
    await again.flush();
    await again.writeJournal();
    expect(await journal.get(id)).toBeNull();
  });

  it('a tab that replayed another’s journal keeps what that tab journals later', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const id = await (await store(backend, journal)).createBase();
    const b = await store(backend, journal);
    const sb = await b.openBase(id);
    const t = sb.base.tableList()[0];
    const online = offline(backend);
    sb.base.createRecords(t.id, [{ [t.primary.id]: 'B first' }]);
    await sb.writeJournal();
    // Tab A opens meanwhile and takes over B's journal as it was.
    const sa = await (await store(backend, journal)).openBase(id);
    sb.base.createRecords(t.id, [{ [t.primary.id]: 'B later' }]);
    await sb.writeJournal();
    sa.base.createRecords(t.id, [{ [t.primary.id]: 'A' }]);
    await sa.writeJournal();
    // Both tabs are killed.
    sa.dispose();
    sb.dispose();
    online();
    const again = await (await store(backend, journal)).openBase(id);
    expect(names(again.base.table(t.id))).toEqual(['A', 'B first', 'B later']);
  });

  it('an entry from before sessions is replayed and then cleared', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const s = await store(backend, journal);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const rec = { id: 'recOld', c: { [t.primary.id]: 'old entry' }, o: 1, ct: 1, mt: 1 };
    await s.closeBase(id);
    await journal.put(id, { at: Date.now(), schema: null, records: { [t.id]: { recOld: rec } } });
    const again = await (await store(backend, journal)).openBase(id);
    expect(names(again.base.table(t.id))).toEqual(['old entry']);
    await again.flush();
    await again.writeJournal();
    expect(await journal.get(id)).toBeNull();
  });

  it('the IndexedDB journal keeps sessions written at the same time', async () => {
    const journal = await indexedDbJournal(`test-${Math.random()}`);
    await Promise.all([
      journal.update('app1', (e) => ({ v: 2, sessions: { ...e?.sessions, a: { at: 1 } } })),
      journal.update('app1', (e) => ({ v: 2, sessions: { ...e?.sessions, b: { at: 2 } } })),
    ]);
    expect(Object.keys((await journal.get('app1')).sessions).sort()).toEqual(['a', 'b']);
    await journal.update('app1', () => null);
    expect(await journal.get('app1')).toBeFalsy();
  });
});

/** One device: its own store and journal, sharing the cloud (backend) with others. */
async function device(backend, opts) {
  const own = { ...backend };
  const journal = memoryJournal();
  const s = await store(own, journal, opts);
  return { store: s, backend: own, journal, reopen: () => store(own, journal, opts) };
}

describe('replaying an offline journal', () => {
  it('keeps tables, fields and records another device added since', async () => {
    const backend = memoryBackend();
    const id = await (await store(backend)).createBase();
    const one = await device(backend);
    const two = await device(backend);
    const s1 = await one.store.openBase(id);
    const t = s1.base.tableList()[0];
    const online = offline(one.backend);
    s1.base.updateField(t.id, t.primary.id, { name: 'Title' });
    const mine = s1.base.addTable('Offline');
    s1.base.createRecords(mine, [{}]);
    s1.base.createRecords(t.id, [{ [t.primary.id]: 'offline' }]);
    await one.store.closeBase(id);
    // Meanwhile the other device adds a table, a field and enough records for a second chunk.
    const s2 = await two.store.openBase(id);
    const theirs = s2.base.addTable('Remote');
    s2.base.createRecords(theirs, [{}]);
    s2.base.addField(t.id, { name: 'Remote field', type: 'text' });
    s2.base.createRecords(t.id, Array.from({ length: 2005 }, () => ({})));
    await two.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    const tables = Object.fromEntries(again.base.tableList().map((x) => [x.name, x]));
    expect(Object.keys(tables).sort()).toEqual(['Offline', 'Remote', 'Table 1']);
    expect(tables.Remote.records.size).toBe(1);
    expect(tables.Offline.records.size).toBe(1);
    expect(tables['Table 1'].records.size).toBe(2006);
    expect(tables['Table 1'].fieldByName('Remote field')).toBeTruthy();
    expect(again.conflict).toMatch(/another device/);
    // Saving the result deletes nothing of theirs.
    await again.flush();
    const fresh = await (await store(backend)).openBase(id);
    expect(fresh.base.tableList().map((x) => x.name).sort()).toEqual(['Offline', 'Remote', 'Table 1']);
    expect(fresh.base.table(theirs).records.size).toBe(1);
  });

  it('keeps fields added offline when the schema changed elsewhere', async () => {
    const backend = memoryBackend();
    const id = await (await store(backend)).createBase();
    const one = await device(backend);
    const two = await device(backend);
    const s1 = await one.store.openBase(id);
    const t = s1.base.tableList()[0];
    const [rid] = s1.base.createRecords(t.id, [{}]);
    await s1.flush();
    const online = offline(one.backend);
    const fid = s1.base.addField(t.id, { name: 'Offline field', type: 'number' });
    s1.base.setCell(t.id, rid, fid, 7);
    await one.store.closeBase(id);
    const s2 = await two.store.openBase(id);
    s2.base.addTable('Remote');
    await two.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(again.base.table(t.id).field(fid)?.name).toBe('Offline field');
    expect(again.base.table(t.id).record(rid).c[fid]).toBe(7);
  });

  it('applies offline schema changes whole when the cloud copy did not change', async () => {
    const backend = memoryBackend();
    const one = await device(backend);
    const id = await one.store.createBase();
    const s1 = await one.store.openBase(id);
    const t = s1.base.tableList()[0];
    const extra = s1.base.addTable('Extra');
    s1.base.createRecords(extra, [{}]);
    await s1.flush();
    const online = offline(one.backend);
    s1.base.updateField(t.id, t.primary.id, { name: 'Title' });
    s1.base.apply({ t: 'table.del', id: extra });
    await one.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(again.conflict).toBeFalsy();
    expect(again.base.table(t.id).primary.name).toBe('Title');
    expect(again.base.table(extra)).toBeNull();
    await again.flush();
    expect([...backend.files.keys()].some((k) => k.includes(`/t/${extra}/`))).toBe(false);
  });
});

describe('offline record edits', () => {
  async function setup() {
    const backend = memoryBackend();
    const clock = { t: 1000 };
    const opts = { now: () => clock.t };
    const one = await device(backend, opts);
    const two = await device(backend, opts);
    const id = await one.store.createBase();
    const s1 = await one.store.openBase(id);
    const t = s1.base.tableList()[0];
    const name = t.primary.id;
    const [rid] = s1.base.createRecords(t.id, [{ [name]: 'original' }]);
    await s1.flush();
    return { backend, clock, one, two, id, s1, t, name, rid };
  }
  const editOnTwo = async ({ two, id, t, name, rid }, value) => {
    const s2 = await two.store.openBase(id);
    s2.base.setCell(t.id, rid, name, value);
    await two.store.closeBase(id);
  };

  it('do not override newer edits from another device', async () => {
    const ctx = await setup();
    const { clock, one, id, s1, t, name, rid } = ctx;
    const online = offline(one.backend);
    clock.t = 2000;
    s1.base.setCell(t.id, rid, name, 'offline');
    await one.store.closeBase(id);
    clock.t = 3000;
    await editOnTwo(ctx, 'newer');
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(again.base.table(t.id).record(rid).c[name]).toBe('newer');
    expect(again.conflict).toMatch(/record edited on this device/);
  });

  it('still override older edits from another device', async () => {
    const ctx = await setup();
    const { clock, one, id, s1, t, name, rid } = ctx;
    clock.t = 1500;
    await editOnTwo(ctx, 'older');
    const online = offline(one.backend);
    clock.t = 2000;
    s1.base.setCell(t.id, rid, name, 'offline');
    await one.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(again.base.table(t.id).record(rid).c[name]).toBe('offline');
    expect(again.conflict).toBeFalsy();
  });

  it('keep an Undo made offline after the edit was saved', async () => {
    const { clock, one, id, s1, t, name, rid } = await setup();
    clock.t = 2000;
    s1.base.setCell(t.id, rid, name, 'edited');
    await s1.flush();
    const online = offline(one.backend);
    clock.t = 2500;
    s1.base.undo();
    await one.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(again.base.table(t.id).record(rid).c[name]).toBe('original');
    expect(again.conflict).toBeFalsy();
  });

  it('do not delete a record another device edited later', async () => {
    const ctx = await setup();
    const { clock, one, id, s1, t, name, rid } = ctx;
    const online = offline(one.backend);
    clock.t = 2000;
    s1.base.deleteRecords(t.id, [rid]);
    await one.store.closeBase(id);
    clock.t = 3000;
    await editOnTwo(ctx, 'newer');
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(again.base.table(t.id).record(rid)?.c[name]).toBe('newer');
  });
});

describe('renaming a closed base', () => {
  it('keeps its offline schema changes', async () => {
    const backend = memoryBackend();
    const one = await device(backend);
    const id = await one.store.createBase({ name: 'Old' });
    const s1 = await one.store.openBase(id);
    const t = s1.base.tableList()[0];
    const online = offline(one.backend);
    s1.base.updateField(t.id, t.primary.id, { name: 'Title' });
    await one.store.closeBase(id);
    online();
    await one.store.updateBase(id, { name: 'New', color: 'red' });
    const again = await (await one.reopen()).openBase(id);
    expect(again.base.table(t.id).primary.name).toBe('Title');
    expect([again.base.doc.name, again.base.doc.color]).toEqual(['New', 'red']);
    expect(again.conflict).toBeFalsy();
  });
});

describe('deleting a table while it is being saved', () => {
  it('does not fail the save', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const a = sess.base.tableList()[0];
    sess.base.createRecords(a.id, Array.from({ length: 3 * 2000 + 1 }, () => ({})));
    const b = sess.base.addTable('B');
    sess.base.createRecords(b, [{}]);
    const write = backend.write;
    let release;
    const gate = new Promise((r) => (release = r));
    backend.write = async (...args) => {
      await gate;
      return write(...args);
    };
    const saving = sess.flush();
    await new Promise((r) => setTimeout(r, 5));
    // Table B's chunk is still queued behind table A's four.
    sess.base.apply({ t: 'table.del', id: b });
    release();
    await expect(saving).resolves.toBeUndefined();
    await sess.flush();
    expect([...backend.files.keys()].some((k) => k.includes(`/t/${b}/`))).toBe(false);
  });
});

describe('two tabs or devices saving one base', () => {
  async function two() {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase({ name: 'Shared' });
    const setup = await s.openBase(id);
    const t = setup.base.tableList()[0];
    const name = t.primary.id;
    const [x, y, gone] = setup.base.createRecords(t.id, [{ [name]: 'x' }, { [name]: 'y' }, { [name]: 'gone' }]);
    await s.closeBase(id);
    const a = await (await store(backend)).openBase(id);
    const b = await (await store(backend)).openBase(id);
    const cloud = async () => (await store(backend)).openBase(id);
    return { backend, id, a, b, t, name, x, y, gone, cloud };
  }

  it('keep each other’s record edits', async () => {
    const { a, b, t, name, x, y, gone, cloud } = await two();
    a.base.setCell(t.id, y, name, 'y from A');
    a.base.createRecords(t.id, [{ [name]: 'new from A' }]);
    await a.flush();
    b.base.setCell(t.id, x, name, 'x from B');
    b.base.createRecords(t.id, [{ [name]: 'new from B' }]);
    b.base.deleteRecords(t.id, [gone]);
    await b.flush();
    // B's copy is behind now: its next save merges too.
    b.base.setCell(t.id, x, name, 'x from B again');
    await b.flush();
    expect(names((await cloud()).base.table(t.id))).toEqual(['new from A', 'new from B', 'x from B again', 'y from A']);
  });

  it('keep tables, fields and views the other added, and cells in them', async () => {
    const { a, b, t, name, x, cloud } = await two();
    const table = a.base.addTable('From A');
    a.base.createRecords(table, [{}]);
    const fid = a.base.addField(t.id, { name: 'A field', type: 'text' });
    const vid = a.base.addView(t.id, 'grid', 'A view');
    a.base.setCell(t.id, x, fid, 'kept');
    await a.flush();
    b.base.setCell(t.id, x, name, 'x from B');
    await b.flush();
    const c = await cloud();
    expect(c.base.table(table)?.records.size).toBe(1);
    expect(c.base.table(t.id).field(fid)).toBeTruthy();
    expect(c.base.table(t.id).view(vid)).toBeTruthy();
    expect(c.base.table(t.id).record(x).c).toMatchObject({ [name]: 'x from B', [fid]: 'kept' });
  });

  it('do not bring back what one of them deleted', async () => {
    const { a, b, t, cloud } = await two();
    const status = t.fieldByName('Status').id;
    a.base.setCells(t.id, [...a.base.table(t.id).records.keys()].map((id) => ({ id, cells: { [status]: t.field(status).options.choices[0].id } })));
    await a.flush();
    b.base.setCells(t.id, [...b.base.table(t.id).records.keys()].map((id) => ({ id, cells: { [status]: t.field(status).options.choices[1].id } })));
    b.base.deleteField(t.id, status);
    a.base.addTable('From A');
    await a.flush();
    await b.flush();
    const c = await cloud();
    expect(c.base.table(t.id).field(status)).toBeNull();
    expect([...c.base.table(t.id).records.values()].some((r) => status in r.c)).toBe(false);
    expect(c.base.tableList().map((x) => x.name)).toEqual(['Table 1', 'From A']);
  });

  it('keep a rename of the base made by the other', async () => {
    const { a, b, t, name, x, cloud } = await two();
    a.base.apply({ t: 'base.set', patch: { name: 'Renamed' } });
    await a.flush();
    b.base.setCell(t.id, x, name, 'x from B');
    await b.flush();
    expect((await cloud()).base.doc.name).toBe('Renamed');
  });

  it('keep records the other saved in a new chunk', async () => {
    const { a, b, t, name, x, cloud } = await two();
    a.base.createRecords(t.id, Array.from({ length: 2005 }, () => ({})));
    await a.flush();
    b.base.setCell(t.id, x, name, 'x from B');
    await b.flush();
    expect((await cloud()).base.table(t.id).records.size).toBe(2008);
  });
});

describe('a damaged base list', () => {
  it('lists its bases again and is kept as a copy before it is written over', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const a = await s.createBase({ name: 'Alpha' });
    const b = await s.createBase({ name: 'Beta' });
    s.setStarred(a, true);
    await s.saveIndex();
    // Beta's entry is cut off in the middle: it is listed from its own file.
    const text = backend.files.get('index.json').data;
    const cut = text.indexOf('"name"', text.indexOf(b)) + 3;
    const damaged = `${text.slice(0, cut)}\u0000${text.slice(cut + 5)}`;
    await backend.write('index.json', damaged);
    const again = await store(backend);
    expect(again.bases().map((x) => x.name).sort()).toEqual(['Alpha', 'Beta']);
    expect(again.entry(a).starred).toBe(true);
    await again.createBase({ name: 'Gamma' });
    const copies = [...backend.files.keys()].filter((k) => /^index\.corrupt-\d+\.json$/.test(k));
    expect(copies.length).toBe(1);
    expect(backend.files.get(copies[0]).data).toBe(damaged);
    expect((await store(backend)).bases().map((x) => x.name).sort()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('written over by another tab is kept too', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const a = await s.createBase({ name: 'Alpha' });
    await backend.write('index.json', '{"v":1,"bases":[{"id":"');
    s.setStarred(a, true);
    await s.saveIndex();
    expect([...backend.files.keys()].some((k) => k.startsWith('index.corrupt-'))).toBe(true);
    expect((await store(backend)).bases().map((x) => x.name)).toEqual(['Alpha']);
  });
});

describe('closing the tab', () => {
  it('journals the last edit right away', async () => {
    const { app, store: s } = await mountApp();
    const id = await s.createBase();
    const page = await openBase(app, id);
    const t = page.base.tableList()[0];
    page.base.createRecords(t.id, [{ [t.primary.id]: 'last edit' }]);
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const entry = s.journal.data.get(id);
    expect(Object.values(entry?.sessions || {}).some((x) => x.records?.[t.id])).toBe(true);
    app.destroy();
  });
});

describe('the base list after saves', () => {
  it('is not rewritten for every save, and keeps the last edit time', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    await new Promise((r) => setTimeout(r, 450));
    backend.calls.length = 0;
    for (let i = 0; i < 3; i++) {
      sess.base.createRecords(t.id, [{}]);
      await sess.flush();
    }
    await new Promise((r) => setTimeout(r, 450));
    expect(backend.calls.filter((c) => c[0] === 'write' && c[1] === 'index.json').length).toBe(0);
    await s.flushAll();
    const saved = JSON.parse(backend.files.get('index.json').data).bases.find((b) => b.id === id);
    expect(saved.updatedAt).toBe(s.entry(id).updatedAt);
    expect(saved.updatedAt).toBe(sess.base.doc.updatedAt);
  });
});

describe('undoing a field edit', () => {
  it('removes what the edit added', () => {
    const { base, table, f } = baseWith([{ name: 'Notes', type: 'text' }]);
    const id = f('Notes').id;
    base.updateField(table.id, id, { description: 'Said here' });
    base.undo();
    expect('description' in table.field(id)).toBe(false);
    base.redo();
    expect(table.field(id).description).toBe('Said here');
  });
});

describe('converting a field to autonumber', () => {
  it('numbers every record and goes on from there', () => {
    const { base, table, f } = baseWith([{ name: 'Code', type: 'number' }]);
    const code = f('Code').id;
    const ids = base.createRecords(table.id, [{ [code]: 10 }, { [code]: 20 }, {}]);
    base.updateField(table.id, code, { type: 'autonumber' });
    expect(ids.map((id) => table.record(id).c[code])).toEqual([1, 2, 3]);
    const [next] = base.createRecords(table.id, [{}]);
    expect(table.record(next).c[code]).toBe(4);
    base.undo();
    base.undo();
    expect(ids.map((id) => table.record(id).c[code])).toEqual([10, 20, undefined]);
    expect(table.schema.nextNumber).toBe(4);
  });
});

describe('the field editor', () => {
  it('asks before replacing values with autonumbers', async () => {
    const { app, store: s } = await mountApp();
    const id = await s.createBase();
    const page = await openBase(app, id);
    const t = page.table;
    const f = page.base.addField(t.id, { name: 'Code', type: 'number' });
    const [rid] = page.base.createRecords(t.id, [{ [f]: 42 }]);
    const anchor = document.body.appendChild(document.createElement('button'));
    openFieldEditor(anchor, page, t, { field: t.field(f) });
    click(document.querySelector('.popover .type-btn'));
    click([...document.querySelectorAll('.popover .menu-item')].find((x) => x.textContent.includes('Autonumber')));
    click([...document.querySelectorAll('.popover .btn.primary')].find((x) => x.textContent === 'Save'));
    await tick();
    const dialog = document.querySelector('dialog[open]');
    expect(dialog?.textContent).toContain('replaced by numbers');
    click([...dialog.querySelectorAll('button')].find((x) => x.textContent === 'Cancel'));
    await tick();
    expect(t.record(rid).c[f]).toBe(42);
    anchor.remove();
    app.destroy();
  });
});

describe('converting text to options', () => {
  it('takes linear time in the number of distinct values', () => {
    const { base, table, f } = baseWith([{ name: 'Tag', type: 'text' }]);
    const tag = f('Tag').id;
    const ids = base.createRecords(table.id, Array.from({ length: 16000 }, (_, i) => ({ [tag]: `Tag ${i % 8000}` })));
    const start = performance.now();
    base.updateField(table.id, tag, { type: 'singleSelect', options: { choices: [] } });
    const ms = performance.now() - start;
    const choices = table.field(tag).options.choices;
    expect(choices.length).toBe(8000);
    expect(new Set(choices.map((c) => c.color)).size).toBe(10);
    const byId = new Map(choices.map((c) => [c.id, c.name]));
    expect(byId.get(table.record(ids[8001]).c[tag])).toBe('Tag 1');
    expect(table.record(ids[1]).c[tag]).toBe(table.record(ids[8001]).c[tag]);
    // Was 1.5s (quadratic); now tens of milliseconds.
    expect(ms).toBeLessThan(500);
  });
});

describe('inserting and moving records at one spot', () => {
  const unique = (table) => new Set(table.ordered().map((r) => r.o)).size === table.records.size;

  it('keeps records in place however many go in', () => {
    const { base, table } = baseWith();
    const all = base.createRecords(table.id, Array.from({ length: 1000 }, () => ({})));
    const anchor = all[500];
    const added = [];
    let most = 0;
    base.on('change', (ch) => (most = Math.max(most, ch.records.get(table.id)?.size || 0)));
    for (let i = 0; i < 80; i++) added.push(base.createRecords(table.id, [{}], { after: anchor })[0]);
    const ids = table.ordered().map((r) => r.id);
    expect(ids.slice(500, 582)).toEqual([anchor, ...added.reverse(), all[501]]);
    expect(unique(table)).toBe(true);
    // Room is made around the spot, not across the table.
    expect(most).toBeLessThan(200);
    base.undo();
    expect(table.ordered().map((r) => r.id).slice(500, 581)).toEqual([anchor, ...added.slice(1), all[501]]);
  });

  it('keeps moved records where they were dropped', () => {
    const { base, table } = baseWith();
    const [a, b, c, d] = base.createRecords(table.id, [{}, {}, {}, {}]);
    // Drag c and d in turn to just before b, again and again.
    for (let i = 0; i < 80; i++) {
      const [x, y] = i % 2 ? [c, d] : [d, c];
      base.moveRecords(table.id, [x], b);
      expect(table.ordered().map((r) => r.id)).toEqual(i ? [a, y, x, b] : [a, x, b, y]);
      expect(unique(table)).toBe(true);
    }
  });
});

describe('duplicating many records', () => {
  it('puts each copy after its record, in one step and linear time', () => {
    const { base, table, f } = baseWith([{ name: 'No', type: 'autonumber' }]);
    const name = table.primary.id;
    const all = base.createRecords(table.id, Array.from({ length: 20000 }, (_, i) => ({ [name]: `r${i}` })));
    const picked = all.filter((_, i) => i % 10 === 0);
    const steps = base.undoStack.length;
    const start = performance.now();
    const copies = base.duplicateRecords(table.id, picked);
    const ms = performance.now() - start;
    expect(copies.length).toBe(2000);
    expect(base.undoStack.length).toBe(steps + 1);
    const ordered = table.ordered();
    expect(ordered.slice(0, 4).map((r) => r.c[name])).toEqual(['r0', 'r0', 'r1', 'r2']);
    expect(ordered[1].id).toBe(copies[0]);
    expect(table.record(copies[1]).c[f('No').id]).toBe(20002);
    // Was 0.7s (a sort per copy); now about ten milliseconds.
    expect(ms).toBeLessThan(200);
    base.undo();
    expect(table.records.size).toBe(20000);
  });

  it('makes room when there is none between a record and the next', () => {
    const { base, table } = baseWith();
    const [a, b, c] = base.createRecords(table.id, [{}, {}, {}]);
    base.apply({ t: 'rec.order', table: table.id, orders: [{ id: b, o: table.record(a).o + 1e-12 }] });
    const [copy] = base.duplicateRecords(table.id, [a]);
    expect(table.ordered().map((r) => r.id)).toEqual([a, copy, b, c]);
    expect(new Set(table.ordered().map((r) => r.o)).size).toBe(4);
  });
});

describe('duplicating a link field', () => {
  it('copies links on both sides without editing the records', () => {
    let t = 1000;
    const { base, table } = baseWith([], { now: () => t });
    const other = base.addTable('Other');
    const [x] = base.createRecords(other, [{}]);
    const link = base.addField(table.id, { name: 'Other', type: 'link', options: { tableId: other } });
    const [a] = base.createRecords(table.id, [{ [link]: [x] }]);
    const before = structuredClone(table.record(a));
    const fields = base.table(other).fields.length;
    t = 2000;
    const copy = base.duplicateField(table.id, link);
    const inverse = table.field(copy).options.inverseId;
    expect(table.record(a).c[copy]).toEqual([x]);
    expect(base.table(other).record(x).c[inverse]).toEqual([a]);
    expect(table.record(a).mt).toBe(before.mt);
    expect(table.record(a).h).toEqual(before.h);
    base.undo();
    expect(table.field(copy)).toBeNull();
    expect(base.table(other).fields.length).toBe(fields);
  });
});

describe('duplicating a table', () => {
  it('points color rules, button links and links to itself at the copy', async () => {
    const { app, store: s } = await mountApp();
    const id = await s.createBase();
    const page = await openBase(app, id);
    const base = page.base;
    const t = page.table;
    const name = t.primary.id;
    const qty = base.addField(t.id, { name: 'Qty', type: 'number' });
    const parent = base.addField(t.id, { name: 'Parent', type: 'link', options: { tableId: t.id } });
    const parentName = base.addField(t.id, { name: 'Parent name', type: 'lookup', options: { linkFieldId: parent, targetFieldId: name } });
    base.addField(t.id, { name: 'Go', type: 'button', options: { label: 'Go', url: `"https://x.com/?q=" & {${name}}` } });
    const v = t.views[0];
    base.updateView(t.id, v.id, { color: { type: 'conditions', rules: [{ id: 'r1', color: 'red', filter: { conjunction: 'and', conditions: [{ id: 'c1', fieldId: qty, op: '>', value: 3 }] } }] } });
    const [a] = base.createRecords(t.id, [{ [name]: 'Top' }]);
    base.createRecords(t.id, [{ [name]: 'Child', [parent]: [a] }]);
    page.duplicateTable(t);
    const c = base.tableList()[1];
    const field = (n) => c.fieldByName(n);
    expect(c.views[0].color.rules[0].filter.conditions[0].fieldId).toBe(field('Qty').id);
    expect(field('Go').options.url).toBe(`"https://x.com/?q=" & {${c.primary.id}}`);
    expect(field('Parent').options.tableId).toBe(c.id);
    const top = [...c.records.values()].find((r) => r.c[c.primary.id] === 'Top');
    const child = [...c.records.values()].find((r) => r.c[c.primary.id] === 'Child');
    expect(child.c[field('Parent').id]).toEqual([top.id]);
    expect(base.compute.value(c, child, field('Parent name'))).toEqual(['Top']);
    // The original is untouched.
    expect(t.field(parentName).options.targetFieldId).toBe(name);
    app.destroy();
  });
});

describe('a restored backup', () => {
  it('has its own copy of attachments', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase();
    const sess = await s.openBase(id);
    const t = sess.base.tableList()[0];
    const f = sess.base.addField(t.id, { name: 'Files', type: 'attachment' });
    const att = await s.putFile(id, new File(['data'], 'a.txt', { type: 'text/plain' }));
    sess.base.createRecords(t.id, [{ [f]: [att] }]);
    await sess.flush();
    // What a downloaded backup holds (see exportBaseJson), restored as home does.
    const backup = JSON.parse(JSON.stringify({ doc: sess.base.doc, records: { [t.id]: [...t.records.values()] } }));
    const copyId = await s.createBase({ name: backup.doc.name, doc: backup.doc, records: backup.records });
    await s.purgeBase(id);
    const copy = await s.openBase(copyId);
    const copied = [...copy.base.tableList()[0].records.values()][0].c[f][0];
    expect(copied.path.startsWith(`bases/${copyId}/`)).toBe(true);
    expect(await (await s.readFile(copied.path)).text()).toBe('data');
  });
});

describe('the journal of an account', () => {
  it('is found again when the account cannot be looked up (offline)', () => {
    localStorage.clear();
    const online = journalName({ uuid: 'u1' });
    expect(journalName(null)).toBe(online);
    expect(journalName({ uuid: 'u2' })).not.toBe(online);
  });
});

describe('several tabs’ offline journals', () => {
  it('keep a table an older tab added when a newer tab changed the schema', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const id = await (await store(backend, journal)).createBase();
    const a = await (await store(backend, journal)).openBase(id);
    const b = await (await store(backend, journal)).openBase(id);
    const t = a.base.tableList()[0];
    b.base.addField(t.id, { name: 'From B', type: 'text' });
    await b.flush();
    // Opened after B's save: its journal is based on the cloud copy as it is now; A's is not.
    const n = await (await store(backend, journal)).openBase(id);
    const online = offline(backend);
    const x = a.base.addTable('Offline A');
    a.base.createRecords(x, [{}]);
    a.dispose();
    await a.writeJournal();
    n.base.updateField(t.id, t.primary.id, { name: 'Title' });
    n.dispose();
    await n.writeJournal();
    online();
    const again = await (await store(backend, journal)).openBase(id);
    expect(again.base.table(x)?.records.size).toBe(1);
    expect(again.base.table(t.id).primary.name).toBe('Title');
    await again.flush();
    const fresh = await (await store(backend)).openBase(id);
    expect(fresh.base.table(x)?.records.size).toBe(1);
    expect(fresh.base.table(t.id).fieldByName('From B')).toBeTruthy();
  });
});

describe('a tab killed after saving over another tab’s save', () => {
  async function setup() {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const s = await store(backend, journal);
    const id = await s.createBase();
    const setupSess = await s.openBase(id);
    const t = setupSess.base.tableList()[0];
    const fruit = setupSess.base.addField(t.id, { name: 'Fruit', type: 'text' });
    const [rid] = setupSess.base.createRecords(t.id, [{ [fruit]: 'apple' }]);
    await s.closeBase(id);
    const a = await (await store(backend, journal)).openBase(id);
    const b = await (await store(backend, journal)).openBase(id);
    return { backend, journal, id, a, b, t, fruit, rid };
  }

  it('keeps its offline schema changes and the cells they converted', async () => {
    const { backend, journal, id, a, b, t, fruit, rid } = await setup();
    const fromB = b.base.addField(t.id, { name: 'From B', type: 'text' });
    b.base.setCell(t.id, rid, fromB, 'b value');
    await b.flush();
    // A's save merges B's: its copy stays behind B's field.
    a.base.setCell(t.id, rid, t.primary.id, 'named');
    await a.flush();
    const online = offline(backend);
    a.base.updateField(t.id, fruit, { type: 'singleSelect' });
    a.base.deleteField(t.id, t.fieldByName('Status').id);
    a.base.updateField(t.id, t.primary.id, { name: 'Title' });
    a.dispose();
    await a.writeJournal();
    online();
    const again = await (await store(backend, journal)).openBase(id);
    const table = again.base.table(t.id);
    expect(again.conflict).toBeFalsy();
    expect(table.field(fruit).type).toBe('singleSelect');
    const choice = table.field(fruit).options.choices.find((c) => c.id === table.record(rid).c[fruit]);
    expect(choice?.name).toBe('apple');
    expect(table.fieldByName('Status')).toBeNull();
    expect(table.primary.name).toBe('Title');
    expect(table.record(rid).c).toMatchObject({ [t.primary.id]: 'named', [fromB]: 'b value' });
    await again.flush();
    const fresh = (await (await store(backend)).openBase(id)).base.table(t.id);
    expect(fresh.fieldByName('Status')).toBeNull();
    expect(fresh.field(fromB)?.name).toBe('From B');
    expect(fresh.record(rid).c[fromB]).toBe('b value');
  });

  it('keeps tables and views the other tab added', async () => {
    const { backend, journal, id, a, b, t } = await setup();
    const table = b.base.addTable('From B');
    b.base.createRecords(table, [{}]);
    const vid = b.base.addView(t.id, 'grid', 'B view');
    await b.flush();
    a.base.addField(t.id, { name: 'From A', type: 'text' });
    await a.flush();
    const online = offline(backend);
    a.base.updateField(t.id, t.primary.id, { name: 'Title' });
    a.dispose();
    await a.writeJournal();
    online();
    const again = await (await store(backend, journal)).openBase(id);
    expect(again.base.table(table)?.records.size).toBe(1);
    expect(again.base.table(t.id).view(vid)).toBeTruthy();
    expect(again.base.table(t.id).primary.name).toBe('Title');
    await again.flush();
    expect((await (await store(backend)).openBase(id)).base.table(table)?.records.size).toBe(1);
  });
});

describe('an offline journal replayed over a schema changed elsewhere', () => {
  it('leaves cells of a field it converted as they are in the cloud', async () => {
    const backend = memoryBackend();
    const id = await (await store(backend)).createBase();
    const one = await device(backend);
    const two = await device(backend);
    const s1 = await one.store.openBase(id);
    const t = s1.base.tableList()[0];
    const fruit = s1.base.addField(t.id, { name: 'Fruit', type: 'text' });
    const [rid] = s1.base.createRecords(t.id, [{ [fruit]: 'apple' }]);
    await s1.flush();
    const online = offline(one.backend);
    s1.base.updateField(t.id, fruit, { type: 'singleSelect' });
    await one.store.closeBase(id);
    const s2 = await two.store.openBase(id);
    s2.base.addTable('Remote');
    await two.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    const table = again.base.table(t.id);
    expect(table.field(fruit).type).toBe('text');
    expect(table.record(rid).c[fruit]).toBe('apple');
  });
});

describe('making room for a record next to others', () => {
  // Three records with no room left between the first two, saved; then two tabs open.
  async function crowded(backend = memoryBackend()) {
    const s = await store(backend);
    const id = await s.createBase();
    const setupSess = await s.openBase(id);
    const t = setupSess.base.tableList()[0];
    const name = t.primary.id;
    const [x, y, z] = setupSess.base.createRecords(t.id, [{ [name]: 'x' }, { [name]: 'y' }, { [name]: 'z' }]);
    setupSess.base.apply({ t: 'rec.order', table: t.id, orders: [{ id: y, o: t.record(x).o + 1e-12 }] });
    await s.closeBase(id);
    return { backend, id, t, name, x, y, z };
  }
  const order = (table) => table.ordered().map((r) => r.c[table.primary.id]);

  it('does not undo another tab’s edits to the records moved', async () => {
    const { backend, id, t, name, x, y } = await crowded();
    const a = await (await store(backend)).openBase(id);
    const b = await (await store(backend)).openBase(id);
    b.base.setCell(t.id, y, name, 'y from B');
    await b.flush();
    a.base.createRecords(t.id, [{ [name]: 'new' }], { after: x });
    await a.flush();
    const c = (await (await store(backend)).openBase(id)).base.table(t.id);
    expect(order(c)).toEqual(['x', 'new', 'y from B', 'z']);
  });

  it('by duplicating does not undo another tab’s edits either', async () => {
    const { backend, id, t, name, x, y } = await crowded();
    const a = await (await store(backend)).openBase(id);
    const b = await (await store(backend)).openBase(id);
    b.base.setCell(t.id, y, name, 'y from B');
    await b.flush();
    a.base.duplicateRecords(t.id, [x]);
    await a.flush();
    const c = (await (await store(backend)).openBase(id)).base.table(t.id);
    expect(order(c)).toEqual(['x', 'x', 'y from B', 'z']);
  });

  it('still saves edits to a record that also moved', async () => {
    const { backend, id, t, name, x, y, z } = await crowded();
    const a = await (await store(backend)).openBase(id);
    const b = await (await store(backend)).openBase(id);
    b.base.setCell(t.id, z, name, 'z from B');
    await b.flush();
    a.base.setCell(t.id, y, name, 'y from A');
    a.base.createRecords(t.id, [{ [name]: 'new' }], { after: x });
    await a.flush();
    const c = (await (await store(backend)).openBase(id)).base.table(t.id);
    expect(order(c)).toEqual(['x', 'new', 'y from A', 'z from B']);
    // Saved alone, the new order is written too.
    const s = await store(backend);
    const d = await s.openBase(id);
    d.base.createRecords(t.id, [{ [name]: 'alone' }], { after: c.ordered()[0].id });
    await s.closeBase(id);
    expect(order((await (await store(backend)).openBase(id)).base.table(t.id))).toEqual(['x', 'alone', 'new', 'y from A', 'z from B']);
  });

  it('offline, does not undo another device’s later edits to the records moved', async () => {
    const backend = memoryBackend();
    const clock = { t: 1000 };
    const opts = { now: () => clock.t };
    const { id, t, name, x, y } = await crowded(backend);
    const one = await device(backend, opts);
    const two = await device(backend, opts);
    const s1 = await one.store.openBase(id);
    clock.t = 2000;
    const s2 = await two.store.openBase(id);
    s2.base.setCell(t.id, y, name, 'y from two');
    await two.store.closeBase(id);
    const online = offline(one.backend);
    clock.t = 3000;
    s1.base.createRecords(t.id, [{ [name]: 'new' }], { after: x });
    await one.store.closeBase(id);
    online();
    const again = await (await one.reopen()).openBase(id);
    expect(order(again.base.table(t.id))).toEqual(['x', 'new', 'y from two', 'z']);
    expect(again.conflict).not.toMatch(/record/);
    await again.flush();
    expect(order((await (await store(backend)).openBase(id)).base.table(t.id))).toEqual(['x', 'new', 'y from two', 'z']);
  });

  it('keeps a failed save’s edit to a record moved while it ran', async () => {
    const { backend, id, t, name, x, y, z } = await crowded();
    const a = await (await store(backend)).openBase(id);
    const b = await (await store(backend)).openBase(id);
    a.base.setCell(t.id, y, name, 'y edited');
    const online = offline(backend);
    const saving = a.flush().catch(() => {});
    a.base.createRecords(t.id, [{ [name]: 'new' }], { after: x });
    await saving;
    online();
    // The retry merges with B's save.
    b.base.setCell(t.id, z, name, 'z from B');
    await b.flush();
    await a.flush();
    expect(order((await (await store(backend)).openBase(id)).base.table(t.id))).toEqual(['x', 'new', 'y edited', 'z from B']);
  });
});

describe('a tab that renamed the base', () => {
  it('keeps a later rename made in another tab, and shows it', async () => {
    const backend = memoryBackend();
    const s = await store(backend);
    const id = await s.createBase({ name: 'Shared' });
    await s.closeBase(id);
    const a = await (await store(backend)).openBase(id);
    const b = await (await store(backend)).openBase(id);
    const t = a.base.tableList()[0];
    const [x] = a.base.createRecords(t.id, [{}]);
    a.base.apply({ t: 'base.set', patch: { name: 'From A', color: 'red' } });
    await a.flush();
    b.base.apply({ t: 'base.set', patch: { name: 'From B' } });
    await b.flush();
    const seen = [];
    a.base.on('change', (ch, op) => seen.push(op));
    a.base.setCell(t.id, x, t.primary.id, 'edited');
    await a.flush();
    expect(a.base.doc.name).toBe('From B');
    expect(seen.some((op) => op?.t === 'base.set' && op.patch.name === 'From B')).toBe(true);
    a.base.setCell(t.id, x, t.primary.id, 'edited again');
    await a.flush();
    const cloud = (await (await store(backend)).openBase(id)).base.doc;
    expect(cloud.name).toBe('From B');
    expect(cloud.color).toBe('red');
  });
});

describe('the base list written after a save', () => {
  it('keeps a rename another tab made meanwhile', async () => {
    const backend = memoryBackend();
    const a = await store(backend);
    const id = await a.createBase({ name: 'Shared' });
    const sess = await a.openBase(id);
    await a.saveIndex();
    const t = sess.base.tableList()[0];
    // Only the edit time changes: the list is written a little later.
    sess.base.createRecords(t.id, [{}]);
    await sess.flush();
    const b = await store(backend);
    await b.updateBase(id, { name: 'Renamed' });
    await b.flushAll();
    await a.saveIndex();
    expect(JSON.parse(backend.files.get('index.json').data).bases.find((x) => x.id === id).name).toBe('Renamed');
    expect(a.entry(id).name).toBe('Renamed');
  });
});

describe('an offline entry from before sessions', () => {
  it('is still taken whole after another tab journals next to it', async () => {
    const backend = memoryBackend();
    const journal = memoryJournal();
    const id = await (await store(backend, journal)).createBase();
    const other = await (await store(backend, journal)).openBase(id);
    const t = other.base.tableList()[0];
    const [rid] = other.base.createRecords(t.id, [{}]);
    await other.flush();
    const doc = JSON.parse(backend.files.get(`bases/${id}/base.json`).data);
    doc.tables[0].fields.find((f) => f.id === t.primary.id).name = 'Title';
    await journal.put(id, { at: Date.now(), schema: doc, records: {} });
    other.base.setCell(t.id, rid, t.primary.id, 'edited');
    other.dispose();
    await other.writeJournal();
    const again = await (await store(backend, journal)).openBase(id);
    expect(again.base.table(t.id).primary.name).toBe('Title');
    expect(again.conflict).toBeFalsy();
  });
});
