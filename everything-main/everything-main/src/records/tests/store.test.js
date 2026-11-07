import { describe, it, expect, vi, afterEach } from 'vitest';
import { Store, CHUNK } from '../src/data/store.js';
import { memoryBackend, memoryKv, puterBackend, isMissing } from '../src/data/backend.js';
import { memoryJournal } from '../src/data/journal.js';

afterEach(() => vi.useRealTimers());

async function newStore(backend = memoryBackend(), journal = memoryJournal()) {
  const store = new Store({ backend, kv: memoryKv(), journal, user: 'tester' });
  await store.init();
  return { store, backend, journal };
}

describe('store', () => {
  it('creates, lists, renames, stars, trashes and purges bases', async () => {
    const { store, backend } = await newStore();
    const id = await store.createBase({ name: 'Projects', color: 'green' });
    expect(store.bases().map((b) => b.name)).toEqual(['Projects']);
    expect(backend.files.has(`bases/${id}/base.json`)).toBe(true);
    await store.updateBase(id, { name: 'Work' });
    expect(store.entry(id).name).toBe('Work');
    store.setStarred(id, true);
    store.trashBase(id);
    expect(store.bases()).toEqual([]);
    expect(store.trashed().length).toBe(1);
    store.restoreBase(id);
    await store.purgeBase(id);
    expect(store.index.bases).toEqual([]);
    expect([...backend.files.keys()].some((k) => k.startsWith(`bases/${id}`))).toBe(false);
    // The index survives a reload.
    const again = new Store({ backend, kv: memoryKv(), journal: memoryJournal() });
    await again.init();
    expect(again.index.bases).toEqual([]);
  });

  it('saves records in chunks and only rewrites changed chunks', async () => {
    const { store, backend } = await newStore();
    const id = await store.createBase({ name: 'Big' });
    const s = await store.openBase(id);
    const table = s.base.tableList()[0];
    const name = table.primary.id;
    const rows = Array.from({ length: CHUNK * 2 + 10 }, (_, i) => ({ [name]: `r${i}` }));
    s.base.createRecords(table.id, rows);
    await s.flush();
    expect(table.schema.chunks).toBe(3);
    expect(backend.files.has(`bases/${id}/t/${table.id}/2.json`)).toBe(true);
    // Edit one record: one chunk and the manifest are written.
    backend.calls.length = 0;
    const rec = table.ordered()[3];
    s.base.setCell(table.id, rec.id, name, 'changed');
    await s.flush();
    const writes = backend.calls.filter((c) => c[0] === 'write').map((c) => c[1]);
    expect(writes).toEqual([`bases/${id}/t/${table.id}/0.json`, `bases/${id}/base.json`]);
    // A fresh store reads everything back.
    await store.closeBase(id);
    const { store: s2 } = await newStore(backend);
    const reopened = await s2.openBase(id);
    const t2 = reopened.base.table(table.id);
    expect(t2.records.size).toBe(CHUNK * 2 + 10);
    expect(t2.record(rec.id).c[name]).toBe('changed');
  });

  it('removes deleted records and tables from storage', async () => {
    const { store, backend } = await newStore();
    const id = await store.createBase();
    const s = await store.openBase(id);
    const table = s.base.tableList()[0];
    const [a, b] = s.base.createRecords(table.id, [{}, {}]);
    await s.flush();
    s.base.deleteRecords(table.id, [a]);
    await s.flush();
    const chunk = JSON.parse(backend.files.get(`bases/${id}/t/${table.id}/0.json`).data);
    expect(chunk.records.map((r) => r.id)).toEqual([b]);
    const t2 = s.base.addTable('Second');
    s.base.createRecords(t2, [{}]);
    await s.flush();
    expect(backend.files.has(`bases/${id}/t/${t2}/0.json`)).toBe(true);
    s.base.apply({ t: 'table.del', id: t2 });
    await s.flush();
    expect(backend.files.has(`bases/${id}/t/${t2}/0.json`)).toBe(false);
  });

  it('replays the journal when a save never happened', async () => {
    const { store, backend, journal } = await newStore();
    const id = await store.createBase();
    const s = await store.openBase(id);
    const table = s.base.tableList()[0];
    const [rid] = s.base.createRecords(table.id, [{ [table.primary.id]: 'unsaved' }]);
    s.dispose();
    await s.writeJournal();
    expect(await journal.get(id)).toBeTruthy();
    // "Reload" without the save ever reaching the backend.
    const { store: s2 } = await newStore(backend, journal);
    const again = await s2.openBase(id);
    expect(again.base.table(table.id).record(rid).c[table.primary.id]).toBe('unsaved');
    expect(again.status).toBe('pending');
    await again.flush();
    expect(await journal.get(id)).toBeNull();
  });

  it('retries failed saves and reports the status', async () => {
    const backend = memoryBackend();
    const { store } = await newStore(backend);
    const id = await store.createBase();
    const s = await store.openBase(id);
    const table = s.base.tableList()[0];
    const write = backend.write;
    backend.write = async () => {
      throw Object.assign(new Error('nope'), { status: 500 });
    };
    s.base.createRecords(table.id, [{}]);
    await expect(s.flush()).rejects.toThrow('nope');
    expect(s.status).toBe('error');
    expect(s.hasUnsaved()).toBe(true);
    backend.write = write;
    await s.flush();
    expect(s.status).toBe('saved');
  });

  it('duplicates a base with its records', async () => {
    const { store } = await newStore();
    const id = await store.createBase({ name: 'Orig' });
    const s = await store.openBase(id);
    const table = s.base.tableList()[0];
    s.base.createRecords(table.id, [{ [table.primary.id]: 'x' }]);
    const copy = await store.duplicateBase(id);
    const c = await store.openBase(copy);
    const ct = c.base.tableList()[0];
    expect(c.base.name).toBe('Orig copy');
    expect([...ct.records.values()][0].c[ct.primary.id]).toBe('x');
  });

  it('stores attachments as files', async () => {
    const { store, backend } = await newStore();
    const att = await store.putFile('appX', new File(['hello'], 'a/b.txt', { type: 'text/plain' }));
    expect(att.name).toBe('a/b.txt');
    expect(att.path).toMatch(/^bases\/appX\/files\/att\w+\/a_b\.txt$/);
    expect(await (await store.readFile(att.path)).text()).toBe('hello');
    expect(backend.files.size).toBe(1);
  });
});

describe('puter backend', () => {
  it('writes with overwrite and missing parents, reads blobs, treats missing files as empty', async () => {
    const calls = [];
    const puter = {
      fs: {
        async write(path, data, opts) {
          calls.push(['write', path, opts]);
          return { modified: 1700000000, size: data.size };
        },
        async read(path) {
          if (path.endsWith('missing.json')) throw Object.assign(new Error('x'), { code: 'subject_does_not_exist' });
          return new Blob(['{"a":1}']);
        },
        async stat() {
          return { modified: 1700000000, size: 7 };
        },
        async delete(path, opts) {
          calls.push(['delete', path, opts]);
        },
      },
    };
    const b = puterBackend(puter);
    const res = await b.write('x/y.json', '{}');
    expect(calls[0]).toEqual(['write', 'records/x/y.json', { overwrite: true, dedupeName: false, createMissingParents: true }]);
    expect(res.modified).toBe(1700000000000);
    expect((await b.read('ok.json')).text).toBe('{"a":1}');
    expect(await b.read('missing.json')).toBeNull();
    expect((await b.stat('ok.json')).modified).toBe(1700000000000);
    await b.remove('bases/z');
    expect(calls[1]).toEqual(['delete', 'records/bases/z', { recursive: true }]);
    expect(isMissing({ status: 404 })).toBe(true);
  });
});
