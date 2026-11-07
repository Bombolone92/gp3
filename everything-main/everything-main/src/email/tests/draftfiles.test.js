import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDraftFileStore } from '../src/lib/draftfiles.js';

const file = (name = 'notes.txt') => ({ filename: name, type: 'text/plain', bytes: new Uint8Array([0, 255, 42]) });

describe('draft attachment storage', () => {
  it('persists actual bytes across store instances and isolates accounts', async () => {
    const db = new IDBFactory();
    const first = createDraftFileStore('alice', db);
    await first.save('draft', [file()]);
    expect(await createDraftFileStore('alice', db).load('draft')).toEqual([file()]);
    expect(await createDraftFileStore('bob', db).load('draft')).toEqual([]);
  });

  it('orders saves, replacements and deletion even when issued together', async () => {
    const store = createDraftFileStore('alice', new IDBFactory());
    await Promise.all([store.save('draft', [file()]), store.save('draft', [file('new.txt')])]);
    expect((await store.load('draft'))[0].filename).toBe('new.txt');
    await Promise.all([store.save('draft', [file()]), store.remove('draft')]);
    expect(await store.load('draft')).toEqual([]);
  });

  it('reports unavailable storage without claiming a successful save', async () => {
    const store = createDraftFileStore('alice', null);
    await expect(store.save('draft', [file()])).rejects.toThrow('unavailable');
    await expect(store.load('draft')).rejects.toThrow('unavailable');
  });

  it('recovers after a failed structured clone without blocking future writes', async () => {
    const store = createDraftFileStore('alice', new IDBFactory());
    await expect(store.save('draft', [{ read() {} }])).rejects.toThrow();
    await store.save('draft', [file()]);
    expect(await store.load('draft')).toEqual([file()]);
  });
});
