import { describe, it, expect, vi } from 'vitest';
import { goOnline, copyDesk, reachDesk, ensureServer, friendlyError } from '../src/views/admin-online.js';
import { MemoryKV } from '../src/server/memory-kv.js';

function err(status, code) {
  return Object.assign(new Error(code), { status, code });
}

function fakeDeps({ deskOnServer = false, healthy = true } = {}) {
  const kv = new MemoryKV();
  const imported = [];
  let present = deskOnServer;
  const calls = [];
  const deps = {
    kv,
    imported,
    calls,
    request: vi.fn(async (server, method, path, opts = {}) => {
      calls.push(`${method} ${path}`);
      if (path === '/health') {
        if (!healthy) throw err(0, 'offline');
        return { ok: true, build: 'b1' };
      }
      if (path.endsWith('/bootstrap')) {
        if (!present) throw err(404, 'no_desk');
        return { meta: {} };
      }
      if (path.startsWith('/api/import/')) {
        imported.push(...opts.body.items);
        present = true;
        return { written: opts.body.items.length };
      }
      if (path.endsWith('/meta')) return { meta: opts.body };
      throw err(404, 'not_found');
    }),
    deployServer: vi.fn(async () => ({ name: 'hd-new', path: '/u/help-desk-worker.js', build: 'b1' })),
    findOwnServer: vi.fn(async () => null),
    saveServer: vi.fn(async () => {}),
    rememberDesk: vi.fn(async () => {}),
    forgetDesk: vi.fn(async () => {}),
  };
  return deps;
}

describe('going online', () => {
  it('deploys a server when none exists and copies the desk when the server cannot see it', async () => {
    const deps = fakeDeps();
    await deps.kv.set('hd:desk1:meta', { name: 'Acme' });
    await deps.kv.set('hd:desk1:t:000000001', { id: 1 });
    await deps.kv.set('hd:desk1:ch:000000000001', { r: 1 });
    await deps.kv.set('hd:desk1:pr:000000001:u', { uuid: 'u' });
    await deps.kv.set('hd:other:meta', { name: 'Other' });
    const steps = [];
    const res = await goOnline(deps, { desk: 'desk1', deskName: 'Acme', known: null, appUrl: 'https://app.example/', onStep: (id, s) => steps.push(`${id}:${s}`) });
    expect(res).toEqual({ server: 'hd-new', copied: 2 });
    expect(deps.deployServer).toHaveBeenCalled();
    expect(deps.imported.map((i) => i.key).sort()).toEqual(['hd:desk1:meta', 'hd:desk1:t:000000001']);
    expect(deps.rememberDesk).toHaveBeenCalledWith({ server: 'hd-new', desk: 'desk1', name: 'Acme', role: 'owner' });
    expect(deps.forgetDesk).toHaveBeenCalledWith('local/desk1');
    expect(deps.calls).toContain('PUT /api/d/desk1/meta');
    expect(steps).toContain('copy:done');
    expect(steps.at(-1)).toBe('finish:done');
  });

  it('reuses a healthy known server and skips the copy when the desk is already there', async () => {
    const deps = fakeDeps({ deskOnServer: true });
    const steps = [];
    const res = await goOnline(deps, { desk: 'd', deskName: 'D', known: { name: 'hd-old' }, appUrl: 'https://x/', onStep: (id, s) => steps.push(`${id}:${s}`) });
    expect(res.server).toBe('hd-old');
    expect(deps.deployServer).not.toHaveBeenCalled();
    expect(steps).toContain('copy:skipped');
  });

  it('reports the failing step and rethrows', async () => {
    const deps = fakeDeps();
    deps.deployServer.mockRejectedValue(new Error('Could not create the server: email not verified'));
    const steps = [];
    await expect(goOnline(deps, { desk: 'd', deskName: 'D', known: null, appUrl: 'https://x/', onStep: (id, s, d) => steps.push([id, s, d]) })).rejects.toThrow();
    const last = steps.at(-1);
    expect(last[0]).toBe('server');
    expect(last[1]).toBe('error');
    expect(last[2]).toMatch(/confirmed email/);
  });

  it('copies in pages', async () => {
    const deps = fakeDeps();
    for (let i = 0; i < 7; i++) await deps.kv.set(`hd:p:u:00000000${i}`, { id: i });
    const sizes = [];
    deps.request.mockImplementation(async (s, m, p, o) => {
      sizes.push(o.body.items.length);
      return {};
    });
    const n = await copyDesk(deps, 'hd-x', 'p', { batch: 3 });
    expect(n).toBe(7);
    expect(sizes).toEqual([3, 3, 1]);
  });

  it('tells a missing desk from an unreachable server', async () => {
    const deps = fakeDeps();
    expect(await reachDesk(deps, 's', 'd')).toBe('missing');
    deps.request.mockRejectedValue(err(0, 'offline'));
    await expect(reachDesk(deps, 's', 'd', { attempts: 2, delay: 1 })).rejects.toThrow(/did not answer/);
  });

  it('falls back to deploying when the known server is gone', async () => {
    const deps = fakeDeps({ healthy: false });
    const s = await ensureServer(deps, { known: { name: 'hd-gone' } });
    expect(s.name).toBe('hd-new');
  });

  it('explains common platform errors', () => {
    expect(friendlyError(new Error('insufficient_funds'))).toMatch(/credit/);
    expect(friendlyError(new Error('Failed to fetch'))).toMatch(/connection/);
  });
});
