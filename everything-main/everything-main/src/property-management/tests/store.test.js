import { describe, it, expect } from 'vitest';
import { createStore, physicalName, logicalName } from '../src/core/store.js';
import { createMemoryBackend } from '../src/core/backend.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

async function open(backend) {
  const store = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
  await store.init();
  return store;
}

describe('partition names', () => {
  it('maps ledger records to monthly partitions and back', () => {
    expect(physicalName('transactions', { date: '2026-10-05' })).toBe('tx.2026-10');
    expect(physicalName('leases', { date: '2026-10-05' })).toBe('leases');
    expect(logicalName('tx.2026-10')).toBe('transactions');
    expect(logicalName('leases')).toBe('leases');
    expect(logicalName('tx.oops')).toBe(null);
    expect(logicalName('nope')).toBe(null);
  });
});

describe('store', () => {
  it('writes records under their partition and reads them back as one collection', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    a.put('transactions', { id: 't1', date: '2026-09-30', lines: [] });
    a.put('transactions', { id: 't2', date: '2026-10-01', lines: [] });
    await a.flush();
    expect(backend.peek('tx.2026-09').map((r) => r.id)).toEqual(['t1']);
    expect(backend.peek('tx.2026-10').map((r) => r.id)).toEqual(['t2']);

    const b = await open(backend);
    expect(b.all('transactions').map((r) => r.id).sort()).toEqual(['t1', 't2']);
    expect(b.get('transactions', 't2').date).toBe('2026-10-01');
  });

  it('moves a record between partitions when its date changes', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    a.put('transactions', { id: 't1', date: '2026-09-30', lines: [] });
    await a.flush();
    a.patch('transactions', 't1', { date: '2026-11-02' });
    expect(a.all('transactions')).toHaveLength(1);
    await a.flush();
    expect(backend.peek('tx.2026-09')).toHaveLength(0);
    expect(backend.peek('tx.2026-11').map((r) => r.id)).toEqual(['t1']);

    const b = await open(backend);
    expect(b.all('transactions').map((r) => r.date)).toEqual(['2026-11-02']);
  });

  it('only re-reads the partition another device changed', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    const b = await open(backend);
    a.put('transactions', { id: 'old', date: '2025-01-15', lines: [] });
    a.put('transactions', { id: 'new', date: '2026-10-15', lines: [] });
    await a.flush();
    await b.sync();
    expect(b.all('transactions')).toHaveLength(2);

    const reads = [];
    const orig = backend.loadCollection;
    backend.loadCollection = async (name) => {
      reads.push(name);
      return orig(name);
    };
    a.put('transactions', { id: 'another', date: '2026-10-20', lines: [] });
    await a.flush();
    await b.sync();
    expect(reads).toEqual(['tx.2026-10']);
    expect(b.all('transactions')).toHaveLength(3);
  });

  it('keeps its own unsent writes when a sync lands', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    const b = await open(backend);
    backend.setFailing(true);
    b.put('transactions', { id: 'mine', date: '2026-10-03', lines: [] });
    await b.flush().catch(() => {});
    backend.setFailing(false);
    a.put('transactions', { id: 'theirs', date: '2026-10-04', lines: [] });
    await a.flush();
    await b.sync();
    expect(b.all('transactions').map((r) => r.id).sort()).toEqual(['mine', 'theirs']);
  });

  it('sees records another device deleted disappear', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    a.put('tenants', { id: 'x', firstName: 'Ana' });
    a.put('transactions', { id: 't', date: '2026-10-03', lines: [] });
    await a.flush();
    const b = await open(backend);
    expect(b.all('tenants')).toHaveLength(1);
    a.remove('tenants', 'x');
    a.remove('transactions', 't');
    await a.flush();
    await b.sync();
    expect(b.all('tenants')).toHaveLength(0);
    expect(b.all('transactions')).toHaveLength(0);
  });

  it('bumps the revision only for the collection that changed', async () => {
    const store = await open(createMemoryBackend());
    const r1 = store.revision('transactions');
    const r2 = store.revision('leases');
    store.put('transactions', { date: '2026-10-01', lines: [] });
    expect(store.revision('transactions')).toBeGreaterThan(r1);
    expect(store.revision('leases')).toBe(r2);
  });

  it('hands out increasing numbers that stay ahead of existing records', async () => {
    const backend = createMemoryBackend();
    const store = await open(backend);
    store.put('workOrders', { number: 41 });
    expect(await store.nextNumber('workOrders')).toBe(42);
    expect(await store.nextNumber('workOrders')).toBe(43);
  });

  it('notifies subscribers once per batch with logical names', async () => {
    const store = await open(createMemoryBackend());
    const seen = [];
    store.subscribe((c) => seen.push([...c].sort()));
    store.put('transactions', { date: '2026-10-01', lines: [] });
    store.put('transactions', { date: '2026-11-01', lines: [] });
    await tick();
    expect(seen[0]).toEqual(['transactions']);
  });

  it('restores a snapshot from the cache with its partitions', async () => {
    const backend = createMemoryBackend();
    let saved = null;
    const cache = { load: async () => saved, save: async (s) => (saved = s) };
    const a = createStore({ backend, cache, flushDelay: 0, timeoutMs: 0 });
    await a.init();
    a.put('transactions', { id: 't1', date: '2026-09-30', lines: [] });
    await a.flush();
    await new Promise((r) => setTimeout(r, 700));
    expect(saved.collections['tx.2026-09']).toHaveLength(1);
    const b = createStore({ backend, cache, flushDelay: 0, timeoutMs: 0 });
    await b.init();
    expect(b.get('transactions', 't1')).toBeTruthy();
  });
});

describe('settings from two devices', () => {
  it("one device's unsaved settings change does not erase another's", async () => {
    const backend = createMemoryBackend({ settings: { company: { name: 'Start' } } });
    // Device B can be taken offline on its own.
    let bOffline = false;
    const bBackend = Object.fromEntries(Object.entries(backend).map(([k, f]) => [k, typeof f === 'function' ? (...a) => (bOffline ? Promise.reject(Object.assign(new Error('offline'), { code: 'network' })) : f(...a)) : f]));
    const a = createStore({ backend, flushDelay: 0, timeoutMs: 0 });
    const b = createStore({ backend: bBackend, flushDelay: 0, timeoutMs: 0 });
    await a.init();
    await b.init();
    bOffline = true;
    b.saveSettings({ company: { name: 'B Co' } });
    await b.flush();
    a.saveSettings({ lateFee: { amount: 9999 } });
    await a.flush();
    bOffline = false;
    await b.sync({ force: true });
    await b.flush();
    expect(b.state.settings).toMatchObject({ company: { name: 'B Co' }, lateFee: { amount: 9999 } });
    await a.sync({ force: true });
    expect(a.state.settings).toMatchObject({ company: { name: 'B Co' }, lateFee: { amount: 9999 } });
  });
});

describe('csv', () => {
  it('keeps negative amounts numeric and still guards formulas', async () => {
    const { toCSV } = await import('../src/core/csv.js');
    expect(toCSV([['-12.50', '=SUM(A1)', '-x', '7']])).toBe("-12.50,'=SUM(A1),'-x,7\r\n");
  });
});

describe('store failure handling', () => {
  it('refuses a ledger record without a valid date', async () => {
    const store = await open(createMemoryBackend());
    expect(() => store.put('transactions', { id: 'x', lines: [] })).toThrow(/valid date/);
    expect(store.all('transactions')).toHaveLength(0);
  });

  it('a collection the server rejects does not take other changes with it', async () => {
    const backend = createMemoryBackend();
    const orig = backend.putRecords;
    backend.putRecords = async (name, recs) => {
      if (name === 'units') throw Object.assign(new Error('bad record'), { status: 400 });
      return orig(name, recs);
    };
    const a = await open(backend);
    a.put('units', { id: 'u1', name: 'bad' });
    a.put('tenants', { id: 't1', firstName: 'Ana' });
    await a.flush();
    expect(backend.peek('tenants').map((r) => r.id)).toEqual(['t1']);
    expect(a.pendingCount()).toBe(0);
    expect(a.state.error).toMatch(/rejected/);
    // Another device sees the tenant: its version was bumped.
    const b = await open(backend);
    expect(b.get('tenants', 't1')).toBeTruthy();
  });

  it('one record the server refuses does not drop the rest of its batch', async () => {
    const backend = createMemoryBackend();
    const orig = backend.putRecords;
    backend.putRecords = async (name, recs) => {
      if (recs.some((r) => r.id === 'bad')) throw Object.assign(new Error('bad id'), { status: 400 });
      return orig(name, recs);
    };
    const a = await open(backend);
    a.put('tenants', { id: 'good1' });
    a.put('tenants', { id: 'bad' });
    a.put('tenants', { id: 'good2' });
    await a.flush();
    expect(backend.peek('tenants').map((r) => r.id).sort()).toEqual(['good1', 'good2']);
    expect(a.state.error).toMatch(/rejected/);
    expect(a.pendingCount()).toBe(0);
  });

  it('a network failure part way requeues only what did not land', async () => {
    const backend = createMemoryBackend();
    const orig = backend.putRecords;
    let fail = true;
    backend.putRecords = async (name, recs) => {
      if (name === 'units' && fail) throw Object.assign(new Error('offline'), { code: 'network' });
      return orig(name, recs);
    };
    const a = await open(backend);
    a.put('tenants', { id: 't1' });
    a.put('units', { id: 'u1' });
    await a.flush().catch(() => {});
    expect(backend.peek('tenants')).toHaveLength(1);
    expect(a.pendingCount()).toBe(1);
    fail = false;
    await a.flush();
    expect(backend.peek('units')).toHaveLength(1);
    const b = await open(backend);
    expect(b.get('tenants', 't1')).toBeTruthy();
    expect(b.get('units', 'u1')).toBeTruthy();
  });

  it('sends waiting changes as soon as a sync succeeds after an outage', async () => {
    const backend = createMemoryBackend();
    const a = await open(backend);
    backend.setFailing(true);
    a.put('tenants', { id: 't1' });
    // Several failed attempts grow the retry delay to a minute.
    for (let i = 0; i < 6; i++) await a.flush().catch(() => {});
    backend.setFailing(false);
    await a.sync();
    await new Promise((r) => setTimeout(r, 30));
    expect(backend.peek('tenants').map((r) => r.id)).toEqual(['t1']);
    expect(a.pendingCount()).toBe(0);
  });

  it('keeps the newer copy of a record found in two months and deletes the other', async () => {
    const backend = createMemoryBackend();
    await backend.putRecords('tx.2026-09', [{ id: 't', date: '2026-09-30', memo: 'old', updatedAt: '2026-10-01T00:00:00Z', lines: [] }]);
    await backend.putRecords('tx.2026-10', [{ id: 't', date: '2026-10-02', memo: 'new', updatedAt: '2026-10-02T00:00:00Z', lines: [] }]);
    await backend.bumpVersions(['tx.2026-09', 'tx.2026-10']);
    const a = await open(backend);
    expect(a.all('transactions').map((r) => r.memo)).toEqual(['new']);
    await a.flush();
    expect(backend.peek('tx.2026-09')).toHaveLength(0);
    expect(backend.peek('tx.2026-10')).toHaveLength(1);
  });
});
