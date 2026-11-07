/**
 * Tenth review pass, region C: invites, shared channels, integrations,
 * export/import/transfer, and the email worker. Each test here reproduces a
 * defect found in that pass and proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { importArchive } from '../src/lib/archive.js';
import { timeoutFor } from '../src/lib/api.js';

const { alice, bob, carol } = USERS;
const SERVER = 'teamchat-api.test';
let rt;

beforeEach(async () => {
  rt = await boot();
});

/** Share `name` (a fresh channel of `host`) with `partner`, whose admin `admin` records the entry; returns the host's channel id, the entry's id, and the connection. */
async function share(host, partner, admin, name) {
  const ch = (await as(alice).post(`/api/ws/${host.wsId}/channels`, { name })).data.channel.id;
  const inv = await as(alice).post(`/api/ws/${host.wsId}/channels/${ch}/connect/invites`, {});
  const acc = await as(admin).post('/api/connect/accept', { code: inv.data.code, partner: { ref: `${partner.wsId}@${SERVER}`, name: partner.name } });
  expect(acc.ok).toBe(true);
  const added = await as(admin).post(`/api/ws/${partner.wsId}/channels/shared`, { ref: `${host.wsId}@${SERVER}`, ch, conn: acc.data.conn, secret: acc.data.secret, name, host: 'Acme' });
  expect(added.ok).toBe(true);
  return { ch, entry: added.data.channel.id, conn: acc.data.conn };
}

/** `who` joins the entry on the partner and, with the attestation handed back, the channel on the host. */
async function joinShared(who, partner, entry) {
  const j = await as(who).post(`/api/ws/${partner.wsId}/channels/${entry}/join`);
  expect(j.ok).toBe(true);
  const res = await as(who).post('/api/connect/join', { conn: j.data.shared.conn, token: j.data.shared.token, profile: { name: who.username } });
  expect(res.ok).toBe(true);
  return res.data;
}

describe('a webhook call crossing its own revoke', () => {
  it('leaves no nameless integration behind: the trace it writes is dropped the next time admins list them', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const made = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' });
    const key = KEYS.ws(wsId);
    const kv = rt.kv;
    const get = kv.get.bind(kv);
    let release = null;
    let armed = true;
    // The call has read the workspace document (the webhook still on it) and
    // is held there while the admin revokes the token; then it goes on and
    // notes its "last used" under an entry that is no longer there.
    kv.get = async (k) => {
      const v = await get(k);
      if (armed && k === key) {
        armed = false;
        await new Promise((r) => { release = r; });
      }
      return v;
    };
    const call = as(null).post(`/webhook/${made.data.token}`, { text: 'in flight' });
    // Until the call is held at its read (a fixed pause passed before the
    // read under a loaded machine, and release() below was not yet a function).
    for (let i = 0; !release && i < 5000; i++) await new Promise((r) => setTimeout(r, 1));
    expect(release).toBeTypeOf('function');
    kv.get = get;
    expect((await as(alice).del(`/api/ws/${wsId}/webhooks/${made.data.id}`)).ok).toBe(true);
    release();
    expect((await call).ok).toBe(true); // authenticated before the revoke: the message lands
    expect((await rt.kv.get(key)).webhooks[made.data.id]).toEqual({ lastUsed: expect.any(Number) });
    // Listed to nobody, and gone from the document once listed; the token stays revoked.
    expect((await as(alice).get(`/api/ws/${wsId}/webhooks`)).data.webhooks).toEqual([]);
    expect((await rt.kv.get(key)).webhooks).toEqual({});
    expect((await as(null).post(`/webhook/${made.data.token}`, { text: 'again' })).status).toBe(401);
  });
});

describe('a member of two partner workspaces', () => {
  it('is counted out of the connection they came through when they leave, whichever workspace labelled them last', async () => {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = { ...(await workspaceWith(alice, [bob], 'Globex')), name: 'Globex' };
    const initech = { ...(await workspaceWith(alice, [bob], 'Initech')), name: 'Initech' };
    // Acme shares #design with Globex and #ops with Initech; bob is in both partners and joins both channels.
    const design = await share(acme, globex, alice, 'design');
    const ops = await share(acme, initech, alice, 'ops');
    await joinShared(bob, globex, design.entry);
    await joinShared(bob, initech, ops.entry);
    let a = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(a.members[bob.uuid].org.name).toBe('Initech'); // the last to vouch for him
    expect(a.channels[design.ch].connections[design.conn].count).toBe(1);
    // Leaving #design takes him off Globex's count there, though his card says Initech.
    expect((await as(bob).post(`/api/ws/${acme.wsId}/channels/${design.ch}/leave`)).ok).toBe(true);
    a = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(a.channels[design.ch].connections[design.conn].count).toBe(0);
    expect(a.channels[design.ch].count).toBe(1);
    // And an admin removing him takes him off Initech's count in #ops the same way.
    expect((await as(alice).del(`/api/ws/${acme.wsId}/members/${bob.uuid}`)).ok).toBe(true);
    a = (await as(alice).get(`/api/ws/${acme.wsId}`)).data.workspace;
    expect(a.channels[ops.ch].connections[ops.conn].count).toBe(0);
    expect(a.channels[ops.ch].count).toBe(1);
  });
});

describe('deleting a channel with integrations bound to it', () => {
  it('takes the channel\'s webhooks with it and drops it from every bot, as deleting the workspace does', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const ops = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'ops' })).data.channel.id;
    const hook = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: ops, name: 'CI' });
    const keep = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'Deploys' });
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Helper', channels: [ops, general.id], scopes: ['post', 'read'] });
    expect(hook.ok && keep.ok && bot.ok).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${ops}`)).ok).toBe(true);
    // The admins' list names no webhook for a channel that is gone, and the
    // one bound to #general is untouched.
    const list = (await as(alice).get(`/api/ws/${wsId}/webhooks`)).data;
    expect(list.webhooks.map((h) => h.id)).toEqual([keep.data.id]);
    expect(list.bots[0].channels).toEqual([general.id]);
    // Its record is gone from the store, so its token is refused like any revoked one.
    expect(await rt.kv.get(KEYS.hook(hook.data.id))).toBeNull();
    expect((await as(null).post(`/webhook/${hook.data.token}`, { text: 'x' })).status).toBe(401);
    expect((await as(null).post(`/webhook/${keep.data.token}`, { text: 'still here' })).ok).toBe(true);
    // The bot still works where it was left, and knows nothing of the deleted channel.
    expect((await rt.kv.get(KEYS.bot(bot.data.id))).channels).toEqual([general.id]);
    expect((await as(null).post(`/bot/${bot.data.token}/channels/${general.id}/messages`, { text: 'hi' })).ok).toBe(true);
    expect((await as(null).get(`/bot/${bot.data.token}/channels/${ops}/messages`)).status).toBe(404);
  });
});

describe('a copy of a workspace with shared channels', () => {
  it('keeps the names of the partners\' people on what they wrote, with their workspace\'s label, as a disconnect would', async () => {
    const acme = await workspaceWith(alice, [carol], 'Acme');
    const globex = { ...(await workspaceWith(alice, [bob], 'Globex')), name: 'Globex' };
    const design = await share(acme, globex, alice, 'design');
    await joinShared(bob, globex, design.entry);
    await as(alice).put('/api/me', { name: 'Alice A.' });
    expect((await as(bob).put('/api/me', { name: 'Bob B.' })).ok).toBe(true);
    const said = await as(bob).post(`/api/ws/${acme.wsId}/conv/${design.ch}/messages`, { text: 'from globex' });
    expect(said.ok).toBe(true);
    let res = await as(alice).get(`/api/ws/${acme.wsId}/export`);
    const header = res.data.header;
    const pages = [...res.data.pages];
    while (!res.data.done) {
      res = await as(alice).get(`/api/ws/${acme.wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
      pages.push(...res.data.pages);
    }
    expect(header.members[bob.uuid].role).toBe('external');
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    for (const p of pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: p.conv, seq: p.seq, messages: p.messages })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    // Not a member of the copy (the connection did not travel), but remembered by name and workspace.
    expect(copy.members[bob.uuid]).toBeUndefined();
    expect(copy.former[bob.uuid]).toMatchObject({ name: 'Bob B.', username: 'bob', org: { name: 'Globex' } });
    const ch = Object.values(copy.channels).find((c) => c.name === 'design');
    const line = (await as(alice).get(`/api/ws/${newId}/conv/${ch.id}/messages`)).data.messages.find((m) => m.text === 'from globex');
    expect(line.user).toBe(bob.uuid);
  });
});

describe('replaying an archive into a worker (the client side of an import or transfer)', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('goes on past a direct message the copy left out (one between people who did not travel), and still opens the workspace', async () => {
    const calls = [];
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    globalThis.puter = { workers: { exec: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push([path, body?.conv || null]);
      if (path === '/api/workspaces/import') return json({ workspace: { id: 'copy000001', name: 'Acme' } });
      if (path === '/api/ws/copy000001/import') {
        // The worker: a direct message none of the copy's members are in is not part of it (nor is a channel it does not have).
        if (body.conv.startsWith('dm_') || body.conv === 'nochan0001') return json({ error: 'not_found', code: 'not_found', message: 'That conversation is not part of this workspace' }, 404);
        return json({ ok: true, conv: body.conv, count: body.messages.length });
      }
      if (path === '/api/ws/copy000001/import/finish') return json({ ok: true });
      return json({ error: 'not_found', code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    const msg = (seq) => ({ seq, user: 'u-x', text: 'x', ts: 1 });
    const archive = {
      header: { format: 'teamchat-export', version: 1, workspace: { id: 'orig000001', name: 'Acme' }, channels: {}, members: {} },
      pages: [
        { conv: 'chan000001', seq: 2, messages: [msg(1), msg(2)] },
        { conv: 'dm_externals', seq: 1, messages: [msg(1)] },
        { conv: 'dm_externals_t1', seq: 1, messages: [msg(1)] },
        { conv: 'chan000002', seq: 1, messages: [msg(1)] },
      ],
      files: [],
    };
    const ref = await importArchive('https://teamchat-x.puter.work', archive, { profile: { name: 'A' } });
    expect(ref).toBe('copy000001@teamchat-x');
    expect(calls.map(([p, c]) => c || p)).toEqual(['/api/workspaces/import', 'chan000001', 'dm_externals', 'dm_externals_t1', 'chan000002', '/api/ws/copy000001/import/finish']);
    // A channel's page being refused is another matter: that stops the import
    // where it is, and the copy made so far is taken down with the failure.
    calls.length = 0;
    const stopped = await importArchive('https://teamchat-x.puter.work', { ...archive, pages: [{ conv: 'nochan0001', seq: 1, messages: [msg(1)] }, archive.pages[0]] }, { profile: { name: 'A' } })
      .then(() => 'finished', (e) => e.code);
    expect(stopped).toBe('not_found');
    expect(calls.map(([p, c]) => c || p)).toEqual(['/api/workspaces/import', 'nochan0001', '/api/ws/copy000001']);
  });
});

describe('the request timeout', () => {
  it('gives a large JSON body (an archive\'s header or page) the time an upload of that size gets, and plain calls the short one', () => {
    expect(timeoutFor(null, JSON.stringify({ text: 'hello' }))).toBe(20_000 + 1);
    const header = JSON.stringify({ members: 'm'.repeat(2_500_000) });
    expect(timeoutFor(null, header)).toBe(20_000 + Math.ceil(header.length / 50));
    expect(timeoutFor(null, 'x'.repeat(20 * 1024 * 1024))).toBe(5 * 60_000);
    expect(timeoutFor(null, null)).toBe(20_000);
    expect(timeoutFor(null)).toBe(20_000);
    // A multipart body is measured by its files, as before, whatever else is passed.
    const form = new FormData();
    form.append('file', new Blob(['x'.repeat(1000)]), 'a.txt');
    expect(timeoutFor(form, 'y'.repeat(100_000))).toBe(20_020);
  });
});

describe('an archive naming ids every object inherits', () => {
  it('admits none of them: no phantom member, no channel on a member document that is not one, and a later removal grows nothing', async () => {
    const conv = 'impgen0001';
    // JSON.parse, unlike an object literal, makes "__proto__" an own key.
    const header = JSON.parse(`{"format":"teamchat-export","version":1,"workspace":{"id":"imp0000001","name":"Old"},
      "channels":{"${conv}":{"name":"general","def":true}},
      "members":{"${alice.uuid}":{"name":"alice","username":"alice","role":"owner"},"${bob.uuid}":{"name":"bob","username":"bob","role":"member"},
        "constructor":{"name":"c","username":"c","role":"member"},"__proto__":{"name":"p","username":"p","role":"admin"}},
      "memberDocs":{"${bob.uuid}":{"channels":["${conv}","constructor","__proto__"],"dms":{},"reads":{},"notify":{}}},
      "dms":{},"pins":{},
      "sched":[{"id":"sched00001","kind":"message","u":"constructor","conv":"${conv}","dueAt":${Date.now() + 3600_000},"text":"hi"},
               {"id":"sched00002","kind":"message","u":"${bob.uuid}","conv":"constructor","dueAt":${Date.now() + 3600_000},"text":"hi"}]}`);
    const created = await as(alice).post('/api/workspaces/import', { header, from: 'imp0000001@old' });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const ws = await rt.kv.get(KEYS.ws(newId));
    expect(Object.keys(ws.members).sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect((await rt.kv.get(KEYS.member(newId, bob.uuid))).channels).toEqual([conv]);
    expect(await rt.kv.get(KEYS.member(newId, 'constructor'))).toBeNull();
    expect(await rt.kv.get(KEYS.sched(newId))).toBeNull();
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    // Removing bob counts him out of the channel he was in, and out of nothing that is not one.
    expect((await as(alice).del(`/api/ws/${newId}/members/${bob.uuid}`)).ok).toBe(true);
    const after = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    expect(Object.keys(after.channels)).toEqual([conv]);
    expect(after.channels[conv].count).toBe(1);
  });
});
