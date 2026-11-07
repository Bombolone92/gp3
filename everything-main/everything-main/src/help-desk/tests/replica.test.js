/**
 * The local replica reloading a desk it fell behind on.
 */
import { describe, it, expect } from 'vitest';
import { makeBackend, makeDesk, OWNER, AGENT } from './helpers.js';
import { Replica } from '../src/client/replica.js';
import { ApiError } from '../src/client/api.js';
import { loadDesk } from '../src/client/cache.js';

describe('replica full reload', () => {
  it('picks up settings and team changes made while it was behind', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const api = { get: (path) => t.ok(AGENT, 'GET', `${P}${path}`) };
    const replica = new Replica(api, `test/${desk}`, { pollMs: 1e9, hiddenPollMs: 1e9 });
    await replica.open();
    expect(replica.cfg.groups.map((g) => g.name)).not.toContain('Billing');
    // While this device sleeps, an admin adds a group and a teammate, and the
    // desk moves on far enough that the feed can't be replayed.
    const groups = (await t.ok(OWNER, 'GET', `${P}/bootstrap`)).cfg.groups;
    await t.ok(OWNER, 'PUT', `${P}/cfg/groups`, { value: [...groups, { id: 'billing', name: 'Billing' }] });
    await t.ok(OWNER, 'PUT', `${P}/meta`, { name: 'Acme Care' });
    const { invite } = await t.ok(OWNER, 'POST', `${P}/invites`, { role: 'agent' });
    await t.ok({ uuid: 'bea-uuid', username: 'bea' }, 'POST', `/api/join/${desk}`, { code: invite.code, name: 'Bea' });
    for (let i = 0; i < 401; i++) await t.kv.incr(`hd:${desk}:rev`);
    await replica.pull();
    expect(replica.cfg.groups.map((g) => g.name)).toContain('Billing');
    expect(replica.meta.name).toBe('Acme Care');
    expect(replica.members['bea-uuid']?.name).toBe('Bea');
    replica.close({ save: false });
  });
});

describe('a closed replica', () => {
  const pending = () => {
    let settle;
    const api = { get: () => new Promise((resolve, reject) => { settle = { resolve, reject }; }) };
    return { api, settle: () => settle };
  };

  it('keeps nothing a request still out brings back', async () => {
    const { api, settle } = pending();
    const replica = new Replica(api, 'test/closed-a');
    replica.rev = 1;
    const ticking = replica.tick();
    replica.close({ save: false });
    settle().resolve({ rev: 2, head: 2, changes: [{ r: 2, k: 't', id: 1, v: { id: 1, subject: 'Secret', updatedAt: 1 } }] });
    await ticking;
    await new Promise((r) => setTimeout(r, 700));
    expect(replica.tickets.size).toBe(0);
    expect(await loadDesk('test/closed-a')).toBeNull();
  });

  it('does not report losing access to a desk it no longer shows', async () => {
    const { api, settle } = pending();
    const replica = new Replica(api, 'test/closed-b');
    let removed = 0;
    replica.addEventListener('removed', () => removed++);
    const ticking = replica.tick();
    replica.close({ save: false });
    settle().reject(new ApiError(403, { error: 'not_member', message: 'No access' }));
    await ticking;
    expect(removed).toBe(0);
  });
});
