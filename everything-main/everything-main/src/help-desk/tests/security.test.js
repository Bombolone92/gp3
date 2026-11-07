// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { makeBackend, makeDesk, OWNER, AGENT, STRANGER } from './helpers.js';
import { sanitizeHtml } from '../src/shared/html.js';

const ip = (n) => ({ headers: { 'x-real-ip': `10.1.1.${n}` } });

describe('attachments', () => {
  it('stores types a browser could run as plain bytes, served sandboxed', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], { type: 'image/svg+xml' });
    const up = await t.ok(AGENT, 'POST', `/api/d/${desk}/files`, null, { raw: svg, headers: { 'x-file-name': 'x.svg', 'content-type': 'image/svg+xml' } });
    expect(up.type).toBe('application/octet-stream');
    const res = await t.call(AGENT, 'GET', `/api/d/${desk}/files/${up.id}`);
    expect(res.response.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.response.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.response.headers.get('content-security-policy')).toMatch(/sandbox/);
  });
});

describe('deleting a ticket for good', () => {
  it('deletes its attachments too', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const P = `/api/d/${desk}`;
    const up = await t.ok(AGENT, 'POST', `${P}/files`, null, { raw: new Blob(['passport scan'], { type: 'image/png' }), headers: { 'x-file-name': 'id.png', 'content-type': 'image/png' } });
    const { ticket } = await t.ok(AGENT, 'POST', `${P}/tickets`, { subject: 'ID', requester: { email: 'c@d.com' }, comment: { html: '<p>Attached</p>', public: true, attachments: [up] } });
    expect(t.stored.size).toBe(1);
    await t.ok(AGENT, 'POST', `${P}/tickets/${ticket.id}/delete`);
    await t.ok(OWNER, 'DELETE', `${P}/tickets/${ticket.id}`);
    expect((await t.call(AGENT, 'GET', `${P}/files/${up.id}`)).status).toBe(404);
    expect(t.stored.size).toBe(0);
  });

  it('deletes a whole desk\'s attachments with the desk', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/files`, null, { raw: new Blob(['x']), headers: { 'x-file-name': 'a.txt' } });
    expect(t.stored.size).toBe(1);
    while ((await t.ok(OWNER, 'DELETE', `/api/d/${desk}`)).remaining);
    expect(t.stored.size).toBe(0);
  });
});

describe('malformed requests', () => {
  it('are refused cleanly, without a server error or a stray customer', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    await t.ok(OWNER, 'PUT', `${P}/cfg/fields`, { value: [{ id: 'plan', title: 'Plan', type: 'text', portal: true }] });
    await t.ok(AGENT, 'POST', `${P}/users`, { name: 'Ann', email: 'ann@x.io' });
    expect((await t.call(AGENT, 'POST', `${P}/tickets-bulk`, { ids: '1,2', patch: { priority: 'high' } })).status).toBe(400);
    expect((await t.call(AGENT, 'POST', `${P}/users/1`, 'oops')).status).toBe(400);
    expect((await t.call(AGENT, 'POST', `${P}/users/1`, [1, 2])).status).toBe(400);
    const res = await t.call(null, 'POST', `/p/${desk}/requests`, { email: 'new@x.io', subject: 's', description: 'd', fields: 'x' }, ip(7));
    expect(res.status).toBe(400);
    const { items } = await t.ok(AGENT, 'GET', `${P}/records/users`);
    expect(items.map((u) => u.email)).toEqual(['ann@x.io']);
  });
});

describe('record listings', () => {
  it('only list the desk\'s own record kinds', async () => {
    const t = makeBackend();
    const deskA = await makeDesk(t);
    const { desk: deskB } = await t.ok(OWNER, 'POST', '/api/desks', { name: 'Other desk' });
    await t.ok(OWNER, 'POST', `/api/d/${deskB}/invites`, { role: 'admin' });
    for (const kind of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const res = await t.call(AGENT, 'GET', `/api/d/${deskA}/records/${kind}`);
      expect(res.status).toBe(404);
    }
  });
});

describe('help center identity', () => {
  it('marks requests filed under an existing customer as unverified', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Vic', email: 'vic@corp.io' });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'vic@corp.io', subject: 'x', description: 'y' }, ip(1));
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/${sent.id}`);
    expect(ticket.unverified).toBe(true);
    const fresh = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'new@person.io', subject: 'x', description: 'y' }, ip(2));
    expect((await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/${fresh.id}`)).ticket.unverified).toBe(false);
  });

  it('retires the help center link when an agent changes the requester', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const sent = await t.ok(STRANGER, 'POST', `/p/${desk}/requests`, { email: 'first@corp.io', subject: 'x', description: 'y' }, ip(6));
    const { user } = await t.ok(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Real Owner', email: 'real@corp.io' });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/${sent.id}`, { patch: { requester: user.id }, comment: { html: '<p>Your account number is 1234</p>', public: true } });
    expect((await t.call(null, 'GET', `/p/${desk}/requests/${sent.id}?key=${sent.key}`)).status).toBe(403);
    expect((await t.call(STRANGER, 'GET', `/p/${desk}/requests/${sent.id}`)).status).toBe(403);
    const mine = await t.ok(STRANGER, 'GET', `/p/${desk}/mine`);
    expect(JSON.stringify(mine)).not.toContain(`"id":${sent.id}`);
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/${sent.id}`);
    expect((await t.call(null, 'GET', `/p/${desk}/requests/${sent.id}?key=${ticket.key}`)).status).toBe(200);
  });

  it('drops replies from a suspended customer', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'spam@bad.io', subject: 'x', description: 'y' }, ip(7));
    const { ticket } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/${sent.id}`);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/${sent.id}`, { patch: { status: 'pending' } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/users/${ticket.requester}`, { suspended: true });
    await t.ok(null, 'POST', `/p/${desk}/requests/${sent.id}/comments`, { key: sent.key, body: 'more spam' }, ip(7));
    const after = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/${sent.id}`);
    expect(after.ticket.status).toBe('pending');
    expect(after.events.some((e) => e.text?.includes('more spam'))).toBe(false);
  });

  it('files a suspended customer\'s new requests in Suspended tickets, quietly', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    const P = `/api/d/${desk}`;
    const { user } = await t.ok(AGENT, 'POST', `${P}/users`, { name: 'Sam', email: 'sam@bad.io' });
    await t.ok(AGENT, 'POST', `${P}/users/${user.id}`, { suspended: true });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'sam@bad.io', subject: 'Buy now', description: 'Cheap' }, ip(8));
    expect(sent).toEqual({ id: null, key: null, accepted: true });
    const mail = await t.ok(OWNER, 'POST', `${P}/email/import`, { messages: [{ messageId: '<x@m>', from: { address: 'sam@bad.io' }, subject: 'Again', text: 'Cheap', date: new Date().toISOString() }] });
    expect(mail.results[0].status).toBe('skipped');
    const { items } = await t.ok(AGENT, 'GET', `${P}/records/tickets`);
    expect(items.map((x) => [x.subject, x.spam])).toEqual([['Buy now', true], ['Again', true]]);
    expect(t.sent).toEqual([]);
  });

  it('does not reveal a stored customer name to an unverified sender', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Victoria Q. Private', email: 'victim@corp.io' });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'victim@corp.io', name: 'Who', subject: 'x', description: 'y' }, ip(4));
    const view = await t.ok(null, 'GET', `/p/${desk}/requests/${sent.id}?key=${sent.key}`);
    expect(JSON.stringify(view)).not.toContain('Victoria');
    // Customers who are who they say they are still see their name.
    const fresh = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'new@person.io', name: 'Nia New', subject: 'x', description: 'y' }, ip(5));
    const own = await t.ok(null, 'GET', `/p/${desk}/requests/${fresh.id}?key=${fresh.key}`);
    expect(own.requester.name).toBe('Nia New');
  });

  it('never lets a signed-in visitor see requests they did not send', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    // The attacker files a request using the victim's address first.
    await t.ok(STRANGER, 'POST', `/p/${desk}/requests`, { email: 'victim@corp.io', subject: 'hi', description: 'hello' }, ip(3));
    // Later the real customer writes in through email.
    const imported = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, {
      messages: [{ messageId: '<m1@corp>', from: { name: 'Victim', address: 'victim@corp.io' }, subject: 'my secret', text: 'secret', date: new Date().toISOString() }],
    });
    const secretId = imported.results[0].ticket.id;
    const mine = await t.ok(STRANGER, 'GET', `/p/${desk}/mine`);
    expect(mine.requests.map((r) => r.id)).not.toContain(secretId);
    expect((await t.call(STRANGER, 'GET', `/p/${desk}/requests/${secretId}`)).status).toBe(403);
  });

  it('ignores Puter account links in agent input', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    const { user } = await t.ok(AGENT, 'POST', `/api/d/${desk}/users`, { name: 'Ceo', email: 'ceo@client.io', puter: STRANGER.uuid });
    expect(user.puter).toBe(null);
  });
});

describe('email abuse', () => {
  it('does not repeat the visitor text in the automatic confirmation', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'target@corp.io', subject: 'Buy cheap pills', description: 'Visit spam.example now' }, ip(4));
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].text).not.toContain('spam.example');
    expect(t.sent[0].subject).not.toContain('pills');
  });

  it('does not copy the CC list of an inbound email', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t);
    const res = await t.ok(OWNER, 'POST', `/api/d/${desk}/email/import`, {
      messages: [{ messageId: '<m2@x>', from: { address: 'a@x.io' }, cc: [{ address: 'b@x.io' }, { address: 'c@x.io' }], subject: 'Hi', text: 'Body' }],
    });
    expect(res.results[0].ticket.ccs).toEqual([]);
    expect(t.sent.every((m) => m.to.length === 1)).toBe(true);
  });
});

describe('cost amplification', () => {
  it('writes nothing for a repeated rating and limits rating changes', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t, { portal: true });
    const sent = await t.ok(null, 'POST', `/p/${desk}/requests`, { email: 'p@q.io', subject: 's', description: 'd' }, ip(5));
    await t.ok(null, 'POST', `/p/${desk}/requests/${sent.id}/solve`, { key: sent.key }, ip(5));
    await t.ok(null, 'POST', `/p/${desk}/requests/${sent.id}/rate`, { key: sent.key, score: 'good' }, ip(5));
    const rev = await t.kv.get(`hd:${desk}:rev`);
    await t.ok(null, 'POST', `/p/${desk}/requests/${sent.id}/rate`, { key: sent.key, score: 'good' }, ip(5));
    expect(await t.kv.get(`hd:${desk}:rev`)).toBe(rev);
    let limited = false;
    for (let i = 0; i < 8; i++) {
      const res = await t.call(null, 'POST', `/p/${desk}/requests/${sent.id}/rate`, { key: sent.key, score: i % 2 ? 'good' : 'bad', comment: String(i) }, ip(5));
      if (res.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});

describe('integrity', () => {
  it('rejects a merge of a closed ticket before writing anything', async () => {
    const t = makeBackend({ email: async () => ({ failed: [] }) });
    const desk = await makeDesk(t, { portal: true });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Target', requester: { email: 'a@b.io' } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'Source', requester: { email: 'c@d.io' } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/2/delete`);
    const sentBefore = t.sent.length;
    expect((await t.call(AGENT, 'POST', `/api/d/${desk}/tickets/2/merge`, { into: 1 })).status).toBe(409);
    expect(t.sent.length).toBe(sentBefore);
    const { events } = await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`);
    expect(events.some((e) => e.kind === 'comment' && e.text.includes('merged'))).toBe(false);
  });

  it('finishes deleting a large desk across several calls', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.kv.set(Array.from({ length: 2600 }, (_, i) => ({ key: `hd:${desk}:x:${i}`, value: i })));
    let res;
    let calls = 0;
    do {
      res = await t.ok(OWNER, 'DELETE', `/api/d/${desk}`);
      calls++;
    } while (res.remaining && calls < 5);
    expect(res.remaining).toBe(false);
    expect(await t.kv.list(`hd:${desk}:`)).toEqual([]);
  });

  it('treats prototype names as unknown members', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    expect((await t.call(OWNER, 'POST', `/api/d/${desk}/members/__proto__`, { role: 'admin' })).status).toBe(404);
    expect(({}).role).toBe(undefined);
  });

  it('does not auto-close solved tickets in the trash', async () => {
    const t = makeBackend();
    const desk = await makeDesk(t);
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets`, { subject: 'S', requester: { email: 'a@b.io' }, comment: { text: 'x' } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1`, { patch: { status: 'solved' } });
    await t.ok(AGENT, 'POST', `/api/d/${desk}/tickets/1/delete`);
    t.advance(6 * 86400000);
    await t.ok(AGENT, 'GET', `/api/d/${desk}/sync?since=0`);
    expect((await t.ok(AGENT, 'GET', `/api/d/${desk}/tickets/1`)).ticket.status).toBe('solved');
  });

  it('survives malformed escapes in the path', async () => {
    const t = makeBackend();
    const res = await t.call(OWNER, 'GET', '/api/d/%E0%A4%A/bootstrap');
    expect(res.status).toBe(404);
  });
});

describe('sanitizer budget', () => {
  it('never cuts output inside a tag', () => {
    const out = sanitizeHtml(`<p>${'<a href="https://x.io">l</a> '.repeat(100)}</p>`, { maxLength: 300 });
    expect(out.endsWith('</a></p>') || out.endsWith('</p>')).toBe(true);
    expect((out.match(/<a /g) || []).length).toBe((out.match(/<\/a>/g) || []).length);
  });
});

describe('sanitizer speed', () => {
  it('stays fast on unterminated tags and keeps long links', async () => {
    const { sanitizeHtml } = await import('../src/shared/html.js');
    for (const bad of ['<a'.repeat(60000), '<a "'.repeat(30000) + '>', '<b x=\''.repeat(30000) + '>']) {
      const t0 = performance.now();
      sanitizeHtml(bad, { maxLength: 120 * 1024 });
      expect(performance.now() - t0).toBeLessThan(1500);
    }
    const url = `https://example.com/?q=${'x'.repeat(3000)}`;
    expect(sanitizeHtml(`<p><a href="${url}">long</a></p>`)).toContain(`href="${url}"`);
    // An unclosed comment still hides the rest.
    expect(sanitizeHtml('<p>a</p><!-- secret <b')).toBe('<p>a</p>');
    expect(sanitizeHtml('<p>a</p><!-- secret <b>c</b> more')).toBe('<p>a</p>');
  });
});

describe('sanitizer links', () => {
  it('keeps web links and drops in-page anchors that cannot work', async () => {
    const { sanitizeHtml } = await import('../src/shared/html.js');
    expect(sanitizeHtml('<p><a href="#setup">Setup</a></p>')).toBe('<p><a>Setup</a></p>');
    expect(sanitizeHtml('<p><a href="https://x.io/a#b">x</a></p>')).toContain('href="https://x.io/a#b"');
  });
});
