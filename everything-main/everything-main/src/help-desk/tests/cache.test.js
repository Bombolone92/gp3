import { describe, it, expect, vi } from 'vitest';
import { Replica } from '../src/client/replica.js';
import { loadDesk } from '../src/client/cache.js';

describe('offline cache', () => {
  it('keeps changes whose save failed for the next save', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rep = new Replica({}, 'w/cache-test');
    rep.rev = 10;
    rep.put('t', { id: 1, subject: 'v1', updatedAt: 1 });
    await rep.flush();
    // The next write fails (storage full) ...
    const real = IDBDatabase.prototype.transaction;
    let fail = true;
    IDBDatabase.prototype.transaction = function transaction(...args) {
      if (fail && args[1] === 'readwrite') {
        fail = false;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return real.apply(this, args);
    };
    try {
      rep.put('t', { id: 1, subject: 'v2', updatedAt: 2 });
      rep.rev = 11;
      await rep.flush();
      // ... and a later one succeeds.
      rep.put('t', { id: 2, subject: 'other', updatedAt: 3 });
      rep.rev = 12;
      await rep.flush();
    } finally {
      IDBDatabase.prototype.transaction = real;
    }
    const cached = await loadDesk('w/cache-test');
    expect(cached.state.rev).toBe(12);
    expect(cached.t.find((r) => r.id === 1).subject).toBe('v2');
  });
});

describe('signing out', () => {
  it('forgets desk content kept in this browser, but not preferences', async () => {
    const { forgetLocalData, saveDesk } = await import('../src/client/cache.js');
    await saveDesk('w/out', { puts: [{ kind: 't', id: 1, v: { id: 1, subject: 'Secret' } }], state: { rev: 3 } });
    localStorage.setItem('help-desk:notifications:w/out', '[{"subject":"Secret"}]');
    localStorage.setItem('help-desk:kb-draft:w/out:new', '{}');
    localStorage.setItem('help-desk:theme', 'dark');
    sessionStorage.setItem('help-desk:tabs:w/out', '[{"id":"1"}]');
    await forgetLocalData();
    expect(await loadDesk('w/out')).toBeNull();
    expect(localStorage.getItem('help-desk:notifications:w/out')).toBeNull();
    expect(localStorage.getItem('help-desk:kb-draft:w/out:new')).toBeNull();
    expect(sessionStorage.getItem('help-desk:tabs:w/out')).toBeNull();
    expect(localStorage.getItem('help-desk:theme')).toBe('dark');
    // The cache keeps working afterwards.
    await saveDesk('w/out', { state: { rev: 1 } });
    expect((await loadDesk('w/out')).state.rev).toBe(1);
  });
});

describe('losing access to a desk', () => {
  it('removes its local copy', async () => {
    const { saveDesk } = await import('../src/client/cache.js');
    const { app } = await import('../src/app.js');
    const { ApiError } = await import('../src/client/api.js');
    await saveDesk('w/gone', { puts: [{ kind: 't', id: 1, v: { id: 1, subject: 'Secret' } }], state: { rev: 3 } });
    const replica = new Replica({}, 'w/gone');
    app.ref = 'w/gone';
    app.replica = replica;
    // What openDesk wires up once a desk is open.
    replica.addEventListener('removed', () => {});
    const real = Replica.prototype.open;
    Replica.prototype.open = async () => { throw new ApiError(403, { error: 'not_member', message: 'removed' }); };
    app.doc = { desks: { 'w/gone': {} } };
    window.puter = { kv: { get: async () => null, set: async () => true, update: async () => ({}) }, auth: { getUser: async () => ({ uuid: 'u' }) } };
    try {
      await app.openDesk('w', 'gone').catch(() => {});
    } finally {
      Replica.prototype.open = real;
      delete window.puter;
    }
    expect(await loadDesk('w/gone')).toBeNull();
  });
});
