// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeBackend, makeDesk, OWNER, AGENT } from './helpers.js';
import { Replica } from '../src/client/replica.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('concurrent ticket updates', () => {
  it('leave every local copy with the stored ticket, whatever order they land in', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'a@c.io' }, comment: { html: 'hi' } });
    const { rev: start } = await t.ok(AGENT, 'GET', `${P}/sync?since=0`);
    const replica = new Replica(null, 'test');
    replica.put('t', ticket);
    // A takes its clock first but its write lands after B's.
    const update = t.kv.update.bind(t.kv);
    let first = true;
    t.kv.update = async (key, paths) => {
      if (key.includes(':t:') && first) {
        first = false;
        await wait(30);
      }
      return update(key, paths);
    };
    await Promise.all([
      t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}`, { patch: { priority: 'urgent' } }),
      wait(5).then(() => t.ok(OWNER, 'POST', `${P}/tickets/${ticket.id}`, { patch: { assignee: AGENT.uuid } })),
    ]);
    t.kv.update = update;
    const { changes } = await t.ok(AGENT, 'GET', `${P}/sync?since=${start}`);
    replica.applyChanges(changes);
    const stored = (await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`)).ticket;
    expect(stored.priority).toBe('urgent');
    expect(stored.assignee).toBe(AGENT.uuid);
    expect(replica.tickets.get(ticket.id).priority).toBe('urgent');
    expect(replica.tickets.get(ticket.id).assignee).toBe(AGENT.uuid);
  });
});

describe('concurrent team changes', () => {
  it('keep a deactivation made while someone else leaves', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const third = { uuid: 'x-uuid', username: 'xena' };
    const { invite } = await t.ok(OWNER, 'POST', `${P}/invites`, { role: 'agent' });
    await t.ok(third, 'POST', `/api/join/${desk}`, { code: invite.code, name: 'Xena' });
    const { rev: start } = await t.ok(OWNER, 'GET', `${P}/sync?since=0`);
    // The agent's removal reads the team, then the owner deactivates Xena
    // before the removal is written.
    const getMany = t.kv.get.bind(t.kv);
    let hold = true;
    t.kv.get = async (key) => {
      const v = await getMany(key);
      if (hold && Array.isArray(key) && key.some((k) => String(k).endsWith(':members'))) {
        hold = false;
        await wait(30);
      }
      return v;
    };
    await Promise.all([
      t.ok(AGENT, 'DELETE', `${P}/members/${AGENT.uuid}`),
      wait(5).then(() => t.ok(OWNER, 'POST', `${P}/members/${third.uuid}`, { active: false })),
    ]);
    t.kv.get = getMany;
    const boot = await t.ok(OWNER, 'GET', `${P}/bootstrap`);
    expect(boot.members[third.uuid].active).toBe(false);
    expect(boot.members[AGENT.uuid]).toBeUndefined();
    const res = await t.call(third, 'GET', `${P}/bootstrap`);
    expect(res.status).toBe(403);
    // The last team entry in the feed is the complete one.
    const { changes } = await t.ok(OWNER, 'GET', `${P}/sync?since=${start}`);
    const last = changes.filter((c) => c.k === 'm').at(-1);
    expect(last.v[third.uuid].active).toBe(false);
    expect(last.v[AGENT.uuid]).toBeUndefined();
  });
});

describe('ticket requester', () => {
  it('cannot be cleared', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'a@c.io' }, comment: { html: 'hi' } });
    for (const requester of [null, 0, 'abc', -3, 1.5]) {
      const res = await t.call(AGENT, 'POST', `${P}/tickets/${ticket.id}`, { patch: { requester } });
      expect(res.status).toBe(400);
    }
    const after = (await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`)).ticket;
    expect(after.requester).toBe(ticket.requester);
  });
});

describe('concurrent custom field edits', () => {
  it('keep both when agents fill in different fields at once', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    await t.ok(OWNER, 'PUT', `${P}/cfg/fields`, { value: [
      { id: 'plan', title: 'Plan', type: 'text', active: true },
      { id: 'region', title: 'Region', type: 'text', active: true },
    ] });
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'a@c.io' }, comment: { html: 'hi' }, fields: { plan: 'free' } });
    // Both read the ticket before either writes.
    const get = t.kv.get.bind(t.kv);
    let readers = 0;
    let go;
    const both = new Promise((r) => { go = r; });
    t.kv.get = async (key) => {
      const v = await get(key);
      if (typeof key === 'string' && key.endsWith(`:t:${String(ticket.id).padStart(9, '0')}`) && readers < 2) {
        readers++;
        if (readers === 2) go();
        await both;
      }
      return v;
    };
    await Promise.all([
      t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}`, { patch: { fields: { plan: 'team' } } }),
      t.ok(OWNER, 'POST', `${P}/tickets/${ticket.id}`, { patch: { fields: { region: 'eu' } } }),
    ]);
    t.kv.get = get;
    const stored = (await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`)).ticket;
    expect(stored.fields).toEqual({ plan: 'team', region: 'eu' });
    // Clearing a field removes it.
    await t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}`, { patch: { fields: { plan: null } } });
    expect((await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`)).ticket.fields).toEqual({ region: 'eu' });
  });
});

describe('auto-close', () => {
  it('runs once when several agents sync at the same moment', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    await t.ok(AGENT, 'POST', `${P}/tickets/1`, { patch: { status: 'solved' } });
    t.advance(5 * 24 * 3600 * 1000);
    await Promise.all([
      t.ok(AGENT, 'GET', `${P}/sync?since=0`),
      t.ok(OWNER, 'GET', `${P}/sync?since=0`),
      t.ok(AGENT, 'GET', `${P}/sync?since=0`),
    ]);
    const { ticket, events } = await t.ok(AGENT, 'GET', `${P}/tickets/1`);
    expect(ticket.status).toBe('closed');
    const closes = events.filter((e) => e.changes?.some((c) => c.field === 'status' && c.to === 'closed'));
    expect(closes.length).toBe(1);
  });
});

describe('service level targets', () => {
  it('do not breach a ticket an agent opened with a public message until the customer writes back', async () => {
    const { slaStatus, DEFAULT_SLA } = await import('../src/shared/rules.js');
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Your renewal', requester: { email: 'c@d.com' }, comment: { html: '<p>Hi, your plan renews soon.</p>', public: true }, assignee: AGENT.uuid, status: 'open' });
    const later = t.now + 9 * 3600 * 1000;
    expect(slaStatus(ticket, DEFAULT_SLA, later)?.metric).toBe('resolve');
    t.advance(3600 * 1000);
    const { key } = (await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`)).ticket;
    await t.ok(null, 'POST', `/p/${desk}/requests/${ticket.id}/comments`, { key, body: 'Can I switch plans?' }, { headers: { 'x-real-ip': '10.1.1.1' } });
    const after = (await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`)).ticket;
    const sla = slaStatus(after, DEFAULT_SLA, t.now);
    expect(sla.metric).toBe('first');
    expect(sla.dueAt).toBe(after.lastCustomerAt + DEFAULT_SLA.targets.normal.first * 60000);
    // A ticket logged with an internal note still waits on a first reply.
    const { ticket: logged } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Phone call', requester: { email: 'e@f.com' }, comment: { html: '<p>Called in</p>', public: false } });
    expect(slaStatus(logged, DEFAULT_SLA, logged.createdAt + 1000).metric).toBe('first');
  });
});

describe('organization domains', () => {
  it('belong to one organization at a time', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const { org: a } = await t.ok(AGENT, 'POST', `${P}/orgs`, { name: 'Acme', domains: 'acme.com' });
    const clash = await t.call(AGENT, 'POST', `${P}/orgs`, { name: 'Acme Copy', domains: 'acme.com' });
    expect(clash.status).toBe(400);
    expect(clash.body.message).toContain('Acme');
    const { org: b } = await t.ok(AGENT, 'POST', `${P}/orgs`, { name: 'Other', domains: 'other.com' });
    expect((await t.call(AGENT, 'POST', `${P}/orgs/${b.id}`, { domains: 'other.com, acme.com' })).status).toBe(400);
    // Re-saving an organization's own domains is fine.
    await t.ok(AGENT, 'POST', `${P}/orgs/${a.id}`, { domains: 'acme.com, acme.io' });
    const { user } = await t.ok(AGENT, 'POST', `${P}/users`, { name: 'New', email: 'new@acme.com' });
    expect(user.org).toBe(a.id);
  });
});

describe('ticket history', () => {
  it('records the spam change when a ticket is restored from spam', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'a@c.io' }, comment: { html: 'hi' } });
    await t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}/spam`, { spam: true });
    await t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}/restore`);
    const { events } = await t.ok(AGENT, 'GET', `${P}/tickets/${ticket.id}`);
    expect(events.at(-1).changes).toEqual([{ field: 'spam', from: true, to: false }]);
  });
});

describe('daily email cap', () => {
  it('counts every recipient', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, ccs: Array.from({ length: 9 }, (_, i) => `cc${i}@d.com`) });
    const window = Math.floor(t.now / 1000 / 86400);
    await t.kv.set(`hd:${desk}:rl:mail:day:${window}`, 495);
    const res = await t.ok(AGENT, 'POST', `${P}/tickets/1`, { comment: { html: '<p>Update for everyone</p>', public: true } });
    expect(res.notified[0].skipped).toBe('daily_limit');
    expect(t.sent).toHaveLength(0);
  });
});

describe('refused requests', () => {
  it('leave no new customer behind', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    const users = async () => (await t.kv.list({ pattern: `hd:${desk}:ue:`, returnValues: false })).length;
    const before = await users();
    const portal = await t.call(null, 'POST', `/p/${desk}/requests`, { email: 'fresh@x.io', subject: '', description: 'help' }, { headers: { 'x-real-ip': '10.2.2.2' } });
    expect(portal.status).toBe(400);
    const agent = await t.call(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'other@x.io' }, assignee: 'nobody', comment: { html: 'hi' } });
    expect(agent.status).toBe(400);
    expect(await users()).toBe(before);
  });
});

describe('help center rate limits', () => {
  it('tell IPv4 visitors apart when their address is written as IPv6', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    for (let i = 0; i < 12; i++) {
      const res = await t.call(null, 'POST', `/p/${desk}/requests`, { email: `v${i}@x.io`, subject: 's', description: 'd' }, { headers: { 'x-real-ip': `::ffff:10.0.0.${i}` } });
      expect(res.status).toBe(200);
    }
    // One visitor is still limited.
    let last;
    for (let i = 0; i < 11; i++) last = await t.call(null, 'POST', `/p/${desk}/requests`, { email: `w${i}@x.io`, subject: 's', description: 'd' }, { headers: { 'x-real-ip': '::ffff:10.9.9.9' } });
    expect(last.status).toBe(429);
  });
});

describe('customer import', () => {
  it('skips malformed rows instead of failing partway', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const res = await t.ok(OWNER, 'POST', `/api/d/${desk}/users-import`, { rows: [{ name: 'Ann', email: 'ann@x.io' }, null, 'junk', { name: 'Bo', email: 'bo@x.io' }] });
    expect(res.created.map((u) => u.name)).toEqual(['Ann', 'Bo']);
    expect(res.skipped).toBe(2);
  });
});

describe('help center required fields', () => {
  it('are enforced by the server', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    await t.ok(OWNER, 'PUT', `/api/d/${desk}/cfg/fields`, { value: [
      { id: 'terms', title: 'I accept the terms', type: 'checkbox', active: true, portal: true, required: true },
      { id: 'order', title: 'Order number', type: 'text', active: true, portal: true, required: true },
    ] });
    const ip = { headers: { 'x-real-ip': '10.3.3.3' } };
    const base = { email: 'r@x.io', subject: 's', description: 'd' };
    const none = await t.call(null, 'POST', `/p/${desk}/requests`, base, ip);
    expect(none.status).toBe(400);
    expect(none.body.message).toBe('I accept the terms is required');
    const blank = await t.call(null, 'POST', `/p/${desk}/requests`, { ...base, fields: { terms: true, order: '  ' } }, ip);
    expect(blank.status).toBe(400);
    const ok = await t.call(null, 'POST', `/p/${desk}/requests`, { ...base, fields: { terms: true, order: 'A-1' } }, ip);
    expect(ok.status).toBe(200);
  });
});

describe('deleted default group', () => {
  it('does not break joining or taking tickets', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { withAgent: false });
    const P = `/api/d/${desk}`;
    await t.ok(OWNER, 'PUT', `${P}/cfg/groups`, { value: [{ id: 'billing', name: 'Billing' }] });
    const { invite } = await t.ok(OWNER, 'POST', `${P}/invites`, { role: 'agent' });
    const { me } = await t.ok(AGENT, 'POST', `/api/join/${desk}`, { code: invite.code, name: 'Aaron' });
    expect(me.groups).toEqual([]);
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'a@c.io' }, comment: { html: 'hi' } });
    const res = await t.call(AGENT, 'POST', `${P}/tickets/${ticket.id}`, { patch: { assignee: AGENT.uuid, group: null } });
    expect(res.status).toBe(200);
  });
});

describe('replica batch updates', () => {
  it('apply many records with one change event', () => {
    const replica = new Replica(null, 'test');
    replica.ready = true;
    const events = [];
    replica.addEventListener('change', (e) => events.push(e.detail));
    replica.upsertMany('u', [{ id: 1, name: 'A', updatedAt: 1 }, { id: 2, name: 'B', updatedAt: 1 }]);
    expect(replica.users.size).toBe(2);
    expect(events.length).toBe(1);
    expect([...events[0].ids.u]).toEqual([1, 2]);
    replica.upsertMany('u', []);
    expect(events.length).toBe(1);
  });
});

describe('losing access', () => {
  it('is only concluded from the server saying so', async () => {
    const { ApiError } = await import('../src/client/api.js');
    for (const [error, removed] of [
      [new ApiError(404, { message: 'This help desk server could not be found' }), false],
      [new ApiError(403, { error: 'forbidden', message: 'nope' }), false],
      [new ApiError(404, { error: 'no_desk', message: 'gone' }), true],
      [new ApiError(403, { error: 'not_member', message: 'removed' }), true],
    ]) {
      const replica = new Replica(null, 'test');
      replica.sync = async () => { throw error; };
      replica.schedule = () => {};
      let fired = false;
      replica.addEventListener('removed', () => { fired = true; });
      await replica.tick();
      expect(fired).toBe(removed);
      expect(replica.status).toBe(removed ? 'removed' : 'offline');
    }
  });
});

describe('stalled requests', () => {
  it('do not hold up syncing for good', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      let calls = 0;
      const replica = new Replica({ get: () => { calls++; return calls === 1 ? new Promise(() => {}) : Promise.resolve({ rev: 0, changes: [] }); } }, 'test');
      replica.schedule = () => {};
      const first = replica.tick();
      await vi.advanceTimersByTimeAsync(21000);
      await first;
      expect(replica.status).toBe('offline');
      await replica.tick();
      expect(calls).toBe(2);
      expect(replica.status).toBe('live');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('record listings', () => {
  it('wait for a write that has taken its revision but not landed', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    await t.ok(AGENT, 'POST', `${P}/users`, { name: 'A', email: 'a@c.io' });
    // Slow down the batch that stores a new ticket with its change entry.
    const set = t.kv.set.bind(t.kv);
    t.kv.set = async (items, ...rest) => {
      if (Array.isArray(items) && items.some((i) => /:t:\d+$/.test(i.key))) await wait(200);
      return set(items, ...rest);
    };
    const created = t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'New one', requester: { email: 'a@c.io' }, comment: { html: 'hi' } });
    await wait(20);
    const page = await t.ok(AGENT, 'GET', `${P}/records/tickets`);
    const { ticket } = await created;
    t.kv.set = set;
    // The new ticket is either in the listing or in the feed after its revision.
    const { changes } = await t.ok(AGENT, 'GET', `${P}/sync?since=${page.rev}`);
    const seen = page.items.some((x) => x.id === ticket.id) || changes.some((c) => c.k === 't' && c.id === ticket.id);
    expect(seen).toBe(true);
  });

  it('do not keep waiting for entries that are gone', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 's', requester: { email: 'a@c.io' }, comment: { html: 'hi' } });
    // The feed entries expire after 14 days.
    for (const key of await t.kv.list({ pattern: `hd:${desk}:ch:` })) await t.kv.del(typeof key === 'string' ? key : key.key);
    let start = Date.now();
    await t.ok(AGENT, 'GET', `${P}/records/tickets`);
    const first = Date.now() - start;
    start = Date.now();
    await t.ok(AGENT, 'GET', `${P}/records/users`);
    expect(first).toBeLessThan(1000);
    expect(Date.now() - start).toBeLessThan(100);
  });
});
