// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeBackend, makeDesk, OWNER, AGENT, STRANGER } from './helpers.js';

describe('desks and membership', () => {
  it('creates a desk with defaults and makes the creator its owner', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { withAgent: false });
    const boot = await t.ok(OWNER, 'GET', `/api/d/${desk}/bootstrap`);
    expect(boot.meta.name).toBe('Acme Support');
    expect(boot.me.role).toBe('owner');
    expect(boot.cfg.groups[0].name).toBe('Support');
    expect(boot.cfg.macros.length).toBeGreaterThan(0);
    expect(boot.cfg.triggers.length).toBeGreaterThan(0);
  });

  it('lets nobody create desks when the server owner cannot be told', async () => {
    const { createBackend } = await import('../src/server/backend.js');
    const { MemoryKV } = await import('../src/server/memory-kv.js');
    const backend = createBackend({ kv: new MemoryKV(), ownerUuid: async () => null });
    const res = await backend.handle({ method: 'POST', path: '/api/desks', query: {}, body: { name: 'Mine' }, headers: {}, who: async () => STRANGER });
    expect(res.status).toBe(403);
  });

  it('only lets the server owner create desks', async () => {
    const t = makeBackend();
    const res = await t.call(STRANGER, 'POST', '/api/desks', { name: 'Mine' });
    expect(res.status).toBe(403);
  });

  it('refuses people who are not agents, and requires sign-in', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { withAgent: false });
    expect((await t.call(STRANGER, 'GET', `/api/d/${desk}/bootstrap`)).status).toBe(403);
    expect((await t.call(null, 'GET', `/api/d/${desk}/bootstrap`)).status).toBe(401);
  });

  it('joins with an invite exactly once', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { withAgent: false });
    const { invite } = await t.ok(OWNER, 'POST', `/api/d/${desk}/invites`, { role: 'agent' });
    const joined = await t.ok(AGENT, 'POST', `/api/join/${desk}`, { code: invite.code, name: 'Aaron' });
    expect(joined.me.role).toBe('agent');
    const again = await t.call(STRANGER, 'POST', `/api/join/${desk}`, { code: invite.code });
    expect(again.status).toBe(403);
  });

  it('keeps agents out of admin routes', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    expect((await t.call(AGENT, 'PUT', `/api/d/${desk}/cfg/groups`, { value: [] })).status).toBe(403);
    expect((await t.call(AGENT, 'POST', `/api/d/${desk}/invites`, {})).status).toBe(403);
  });
});

describe('tickets', () => {
  it('creates a ticket with a new requester and records events', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { ticket, requester } = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, {
      subject: 'Cannot sign in',
      requester: { name: 'Carla Customer', email: 'carla@client.io' },
      comment: { html: '<p>Hello <script>alert(1)</script>there</p>', public: true },
      priority: 'high',
      tags: ['Login Issue', 'login issue'],
    });
    expect(ticket.id).toBe(1);
    expect(ticket.tags).toEqual(['login_issue']);
    expect(ticket.priority).toBe('high');
    expect(requester.email).toBe('carla@client.io');
    const full = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`);
    const comment = full.events.find((e) => e.kind === 'comment');
    expect(comment.html).toBe('<p>Hello there</p>');
    expect(full.events.some((e) => e.kind === 'create')).toBe(true);
  });

  it('numbers tickets sequentially and reuses customers by email', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const a = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'One', requester: { email: 'x@y.com' }, comment: { text: 'a' } });
    const b = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Two', requester: { email: 'X@Y.com' }, comment: { text: 'b' } });
    expect([a.ticket.id, b.ticket.id]).toEqual([1, 2]);
    expect(a.ticket.requester).toBe(b.ticket.requester);
  });

  it('updates fields, tracks changes and reply timestamps', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    t.advance(60_000);
    const res = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, {
      patch: { status: 'pending', assignee: AGENT.uuid },
      comment: { html: '<p>On it</p>', public: true },
    });
    expect(res.ticket.status).toBe('pending');
    expect(res.ticket.assignee).toBe(AGENT.uuid);
    expect(res.ticket.firstReplyAt).toBe(t.now);
    const change = res.events.find((e) => e.kind === 'change');
    expect(change.changes.map((c) => c.field).sort()).toEqual(['assignee', 'status']);
  });

  it('rejects assigning to someone who is not an agent', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    const res = await t.call(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { assignee: STRANGER.uuid } });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe('assignee');
  });

  it('keeps concurrent edits to different fields', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    await Promise.all([
      t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { priority: 'urgent' } }),
      t.ok(OWNER, 'POST', `/api/d/${desk}/tickets/1`, { patch: { type: 'incident' } }),
    ]);
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`);
    expect(ticket.priority).toBe('urgent');
    expect(ticket.type).toBe('incident');
  });

  it('runs triggers and sends notification emails', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { name: 'Carla', email: 'c@d.com' } });
    const res = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { comment: { html: '<p>Here is the fix</p>', public: true } });
    expect(res.notified[0].ok).toBe(true);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].to).toEqual(['c@d.com']);
    expect(t.sent[0].text).toContain('Here is the fix');
    expect(t.sent[0].text).toContain('https://help.example.com/#/help/hd-test/');
    // Internal notes never email the customer.
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { comment: { html: '<p>secret</p>', public: false } });
    expect(t.sent).toHaveLength(1);
  });

  it('closed tickets are read-only and solved ones close automatically', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { status: 'solved' } });
    t.advance(5 * 24 * 3600 * 1000);
    await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=0`);
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`);
    expect(ticket.status).toBe('closed');
    const res = await t.call(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { status: 'open' } });
    expect(res.status).toBe(409);
  });

  it('merges one ticket into another', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'First', requester: { email: 'c@d.com' }, comment: { text: 'a' }, tags: ['a'] });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Dup', requester: { email: 'c@d.com' }, comment: { text: 'b' }, tags: ['b'] });
    const res = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/2/merge`, { into: 1 });
    expect(res.ticket.status).toBe('closed');
    expect(res.ticket.mergedInto).toBe(1);
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`);
    expect(ticket.tags.sort()).toEqual(['a', 'b']);
  });

  it('moves tickets to the trash, restores them and purges them', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Spam', requester: { email: 'c@d.com' }, comment: { text: 'x' } });
    expect((await t.call(OWNER, 'DELETE', `/api/d/${desk}/tickets/1`)).status).toBe(409);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1/delete`);
    const restored = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1/restore`);
    expect(restored.ticket.deleted).toBe(null);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1/delete`);
    await t.ok(OWNER, 'DELETE', `/api/d/${desk}/tickets/1`);
    expect((await t.call(AGENT, 'GET', `/api/d/${desk}/tickets/1`)).status).toBe(404);
  });
});

describe('sync', () => {
  it('serves numbered changes since a revision, and asks for a reset after a long gap', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const start = await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=0`);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    const next = await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=${start.rev}`);
    const kinds = next.changes.map((c) => c.k);
    expect(kinds).toContain('u');
    expect(kinds).toContain('t');
    const tc = next.changes.find((c) => c.k === 't');
    expect(tc.v.subject).toBe('Help');
    expect(next.rev).toBe(next.head);
    const none = await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=${next.rev}`);
    expect(none.changes).toEqual([]);
  });

  it('stops at a revision whose entry is not written yet', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { rev } = await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=0`);
    await t.kv.incr(`hd:${desk}:rev`); // a writer that took a number but has not written
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    const res = await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=${rev}`);
    expect(res.gap).toBe(true);
    expect(res.rev).toBe(rev);
  });

  it('pages full record listings', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    for (let i = 0; i < 3; i++) {
      await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: `T${i}`, requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    }
    const page = await t.ok(AGENT, 'GET', `/api/d/${desk}/records/tickets`);
    expect(page.items.map((x) => x.subject)).toEqual(['T0', 'T1', 'T2']);
    expect(page.rev).toBeGreaterThan(0);
  });
});

describe('customers and organizations', () => {
  it('matches customers to organizations by email domain', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { org } = await t.ok(AGENT, 'POST', `/api/d/${desk}/orgs`, { name: 'Client Inc', domains: 'client.io, @Client.io' });
    expect(org.domains).toEqual(['client.io']);
    const { user } = await t.ok(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Dee', email: 'dee@client.io' });
    expect(user.org).toBe(org.id);
    const dup = await t.call(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Dee 2', email: 'DEE@client.io' });
    expect(dup.status).toBe(409);
  });

  it('detaches customers from a deleted organization', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { org } = await t.ok(AGENT, 'POST', `/api/d/${desk}/orgs`, { name: 'Gone Inc', domains: 'gone.io' });
    const { user } = await t.ok(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Gil', email: 'gil@gone.io' });
    expect(user.org).toBe(org.id);
    await t.ok(OWNER, 'DELETE', `/api/d/${desk}/orgs/${org.id}`);
    expect((await t.kv.get(`hd:${desk}:u:${String(user.id).padStart(9, '0')}`)).org).toBe(null);
  });

  it('will not delete a customer who has tickets', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { ticket } = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    const res = await t.call(OWNER, 'DELETE', `/api/d/${desk}/users/${ticket.requester}`);
    expect(res.status).toBe(409);
  });
});

describe('help center', () => {
  it('is closed until the owner turns it on', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    expect((await t.call(null, 'GET', `/p/${desk}`)).status).toBe(404);
  });

  it('accepts a request, shows only public replies, and takes customer replies', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { name: 'Pat', email: 'pat@home.net', subject: 'Broken', description: 'It broke' }, { headers: { 'x-real-ip': '1.2.3.4' } });
    expect(sent.id).toBe(1);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { comment: { html: '<p>internal</p>', public: false } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { comment: { html: '<p>public answer</p>', public: true }, patch: { status: 'pending' } });
    const view = await t.ok(null, 'GET', `/p/${desk}/requests/1?key=${sent.key}`);
    expect(view.events.map((e) => e.html)).toEqual(['<p>It broke</p>', '<p>public answer</p>']);
    expect(view.events[1].by.name).toBe('Aaron Agent');
    expect((await t.call(null, 'GET', `/p/${desk}/requests/1?key=wrongwrongwrongwrong`)).status).toBe(403);
    await t.ok(null, 'POST', `/p/${desk}/requests/1/comments`, { key: sent.key, body: 'Thanks, still broken' });
    const repliedAt = t.now;
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`);
    expect(ticket.status).toBe('open');
    expect(ticket.lastCustomerAt).toBe(repliedAt);
  });

  it('rate limits anonymous requests per address', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const body = { name: 'Pat', email: 'pat@home.net', subject: 'S', description: 'D' };
    for (let i = 0; i < 10; i++) await t.ok(null, 'POST', `/p/${desk}/requests`, body, { headers: { 'x-real-ip': '9.9.9.9' } });
    const res = await t.call(null, 'POST', `/p/${desk}/requests`, body, { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(res.status).toBe(429);
  });

  it('lets the requester rate a solved request and opens a follow-up after close', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'pat@home.net', subject: 'Broken', description: 'It broke' });
    expect((await t.call(null, 'POST', `/p/${desk}/requests/1/rate`, { key: sent.key, score: 'good' })).status).toBe(409);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { status: 'solved' } });
    const rated = await t.ok(null, 'POST', `/p/${desk}/requests/1/rate`, { key: sent.key, score: 'good', comment: 'Great' });
    expect(rated.ticket.csat).toEqual({ score: 'good', comment: 'Great' });
    t.advance(10 * 24 * 3600 * 1000);
    await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=0`);
    const res = await t.ok(null, 'POST', `/p/${desk}/requests/1/comments`, { key: sent.key, body: 'It broke again' });
    expect(res.followUp.id).toBe(2);
  });

  it('closes solved tickets that are due behind many that are not', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    // Ticket numbers 1 to 600 were solved a moment ago; #601 days ago.
    await t.kv.incr(`hd:${desk}:seq`, { t: 600 });
    await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Old one', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    await t.ok(AGENT, 'POST', `${P}/tickets/601`, { patch: { status: 'solved' } });
    t.advance(5 * 24 * 3600 * 1000);
    for (let id = 1; id <= 600; id++) await t.kv.set(`hd:${desk}:sv:${String(id).padStart(9, '0')}`, t.now);
    await t.ok(AGENT, 'GET', `${P}/sync?since=0`);
    expect((await t.ok(AGENT, 'GET', `${P}/tickets/601`)).ticket.status).toBe('closed');
  });

  it('requires fields marked required to solve, however an agent solves', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    await t.ok(OWNER, 'PUT', `${P}/cfg/fields`, { value: [{ id: 'cause', title: 'Root cause', type: 'text', required: true }] });
    await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Help', requester: { email: 'c@d.com' }, comment: { text: 'hi' } });
    const bulk = await t.ok(AGENT, 'POST', `${P}/tickets-bulk`, { ids: [1], patch: { status: 'solved' } });
    expect(bulk.results[0].error).toMatch(/Root cause/);
    expect((await t.call(AGENT, 'POST', `${P}/tickets/1`, { patch: { status: 'solved' } })).status).toBe(400);
    const done = await t.ok(AGENT, 'POST', `${P}/tickets/1`, { patch: { status: 'solved', fields: { cause: 'Config' } } });
    expect(done.ticket.status).toBe('solved');
  });

  it('records when the first reply clock started on a ticket an agent opened', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'Your order', requester: { email: 'c@d.com' }, comment: { html: '<p>Your order shipped</p>', public: true } });
    t.advance(24 * 3600 * 1000);
    await t.ok(null, 'POST', `/p/${desk}/requests/${ticket.id}/comments`, { key: ticket.key, body: 'It has not arrived' });
    const asked = t.now;
    t.advance(3600 * 1000);
    const res = await t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}`, { comment: { html: '<p>Checking</p>', public: true } });
    expect(res.ticket.firstReplyFrom).toBe(asked);
    expect(res.ticket.firstReplyAt - res.ticket.firstReplyFrom).toBe(3600 * 1000 + 1);
  });

  it('runs triggers on a satisfaction rating', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    const { cfg } = await t.ok(OWNER, 'GET', `${P}/bootstrap`);
    await t.ok(OWNER, 'PUT', `${P}/cfg/triggers`, { value: [...cfg.triggers, {
      id: 'bad-rating', title: 'Bad rating alert', active: true, event: 'updated',
      conditions: { all: [{ field: 'satisfaction', op: 'is', value: 'bad' }], any: [] },
      actions: [{ field: 'add_tags', value: 'bad_rating' }, { field: 'notify_email', to: 'lead@acme.com', subject: 'Bad rating', body: 'Look at it' }],
    }] });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'pat@home.net', subject: 'Broken', description: 'It broke' });
    await t.ok(AGENT, 'POST', `${P}/tickets/1`, { patch: { status: 'solved' } });
    t.sent.length = 0;
    const rated = await t.ok(null, 'POST', `/p/${desk}/requests/1/rate`, { key: sent.key, score: 'bad', comment: 'Slow' });
    expect(rated.ticket.csat.score).toBe('bad');
    const { ticket, events } = await t.ok(AGENT, 'GET', `${P}/tickets/1`);
    expect(ticket.tags).toContain('bad_rating');
    expect(ticket.status).toBe('solved');
    expect(events.find((e) => e.kind === 'rating')).toMatchObject({ score: 'bad', comment: 'Slow', by: { type: 'customer' } });
    expect(t.sent.map((m) => m.to)).toContainEqual(['lead@acme.com']);
    // A closed ticket keeps its fields, but a new rating still notifies.
    t.advance(10 * 24 * 3600 * 1000);
    await t.ok(AGENT, 'GET', `${P}/sync?since=0`);
    await t.ok(null, 'POST', `/p/${desk}/requests/1/rate`, { key: sent.key, score: 'good' });
    await t.ok(null, 'POST', `/p/${desk}/requests/1/rate`, { key: sent.key, score: 'bad' });
    const closed = (await t.ok(AGENT, 'GET', `${P}/tickets/1`)).ticket;
    expect(closed).toMatchObject({ status: 'closed', csat: { score: 'bad' } });
  });

  it('serves only published articles', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/articles`, { title: 'Draft', body: '<p>x</p>' });
    const { article } = await t.ok(AGENT, 'POST', `/api/d/${desk}/articles`, { title: 'Reset your password', body: '<p>Go to settings</p>', status: 'published' });
    const list = await t.ok(null, 'GET', `/p/${desk}/articles`);
    expect(list.articles.map((a) => a.title)).toEqual(['Reset your password']);
    const one = await t.ok(null, 'GET', `/p/${desk}/articles/${article.id}`);
    expect(one.body).toBe('<p>Go to settings</p>');
    expect((await t.call(null, 'GET', `/p/${desk}/articles/1`)).status).toBe(404);
  });
});

describe('configuration', () => {
  it('validates config documents', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { value } = await t.ok(OWNER, 'PUT', `/api/d/${desk}/cfg/fields`, {
      value: [
        { id: 'plan', title: 'Plan', type: 'dropdown', options: [{ label: 'Pro Plan' }, { label: 'Free' }] },
        { id: 'bad id!', title: 'Nope', type: 'text' },
        { id: 'weird', title: 'Weird', type: 'html' },
      ],
    });
    expect(value).toEqual([
      { id: 'plan', title: 'Plan', type: 'dropdown', desc: '', active: true, portal: false, required: false, options: [{ value: 'pro_plan', label: 'Pro Plan' }, { value: 'free', label: 'Free' }] },
    ]);
  });

  it('stores custom field values that match their definitions', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(OWNER, 'PUT', `/api/d/${desk}/cfg/fields`, { value: [{ id: 'plan', title: 'Plan', type: 'dropdown', options: [{ label: 'Pro' }] }, { id: 'seats', title: 'Seats', type: 'number' }] });
    const { ticket } = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, {
      subject: 'x', requester: { email: 'c@d.com' }, comment: { text: 'y' }, fields: { plan: 'pro', seats: '12', other: 'z' },
    });
    expect(ticket.fields).toEqual({ plan: 'pro', seats: 12 });
    const res = await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { fields: { plan: 'nope' } } });
    expect(res.ticket.fields).toEqual({ seats: 12 });
  });
});

describe('attachments', () => {
  it('stores uploads as files and serves them to agents', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const up = await t.ok(AGENT, 'POST', `/api/d/${desk}/files`, null, { raw: blob, headers: { 'x-file-name': encodeURIComponent('notes/../a.txt'), 'content-type': 'text/plain' } });
    expect(up.name).toBe('notes_.._a.txt');
    const res = await t.call(AGENT, 'GET', `/api/d/${desk}/files/${up.id}`);
    expect(await res.response.text()).toBe('hello');
    expect((await t.call(STRANGER, 'GET', `/api/d/${desk}/files/${up.id}`)).status).toBe(403);
  });
});
