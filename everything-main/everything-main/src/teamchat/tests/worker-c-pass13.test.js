/**
 * Thirteenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { api, ApiError, isTransferring } from '../src/lib/api.js';
import { sendInviteEmails } from '../src/lib/email.js';
import { LIMITS } from '../src/shared/limits.js';
import { transferWorkspace, TRANSFER_RENEW_MS } from '../src/lib/archive.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

const BASE = 'https://teamchat-api.test';

describe('an admin outside a private channel', () => {
  it('cannot read it through a bot token, nor post into it through a webhook or a bot, as they cannot by the routes that take a session', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] });
    await as(carol).post(`/api/ws/${wsId}/conv/${secret}/messages`, { text: 'for the three of us' });
    // Bob is an admin, and not in #secret: the channel is no channel to him.
    expect((await as(bob).get(`/api/ws/${wsId}/conv/${secret}/messages`)).status).toBe(404);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${secret}`, { topic: 'x' })).status).toBe(404);
    // A bot he makes with the channel on its list does not get the channel.
    const bot = await as(bob).post(`/api/ws/${wsId}/bots`, { name: 'Reader', scopes: ['read', 'post'], channels: [secret] });
    expect(bot.ok).toBe(true);
    expect(bot.data.channels).toEqual([]);
    expect((await rt.kv.get(KEYS.bot(bot.data.id))).channels).toEqual([]);
    const read = await rt.dispatch(`${BASE}/bot/${bot.data.token}/channels/${secret}/messages`, { method: 'GET' }, null);
    expect(read.status).toBe(404);
    // Nor by changing a bot's list afterwards.
    expect((await as(bob).put(`/api/ws/${wsId}/bots/${bot.data.id}`, { channels: [secret] })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.bot(bot.data.id))).channels).toEqual([]);
    // A webhook bound to it is refused as the channel is: not found.
    const hook = await as(bob).post(`/api/ws/${wsId}/webhooks`, { channel: secret, name: 'Deploys' });
    expect(hook.status).toBe(404);
    expect(hook.data.code).toBe('not_found');
    // Someone in the channel may still set both up for it, admin as they are.
    await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [bob.uuid] });
    const ok = await as(bob).post(`/api/ws/${wsId}/bots`, { name: 'Reader 2', scopes: ['read'], channels: [secret] });
    expect(ok.data.channels).toEqual([secret]);
    const list = await rt.dispatch(`${BASE}/bot/${ok.data.token}/channels/${secret}/messages`, { method: 'GET' }, null);
    expect(list.status).toBe(200);
    expect((await list.json()).messages.some((m) => m.text === 'for the three of us')).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/webhooks`, { channel: secret, name: 'Deploys' })).ok).toBe(true);
  });
});

/** Upload `bytes` as `name` into a workspace; returns the file record the worker answers with. */
async function upload(u, wsId, name, type, bytes) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const res = await as(u).post(`/api/ws/${wsId}/files`, fd);
  expect(res.ok).toBe(true);
  return res.data;
}

describe('a bookmarked file', () => {
  const post = (u, wsId, conv, text, attachments) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, attachments });
  const fetchAs = async (u, wsId, id) => (await as(u).get(`/api/ws/${wsId}/files/${id}`)).status;
  const bytesOf = (wsId, id) => rt.fs.read(`teamchat-files/${wsId}/${id}`).then((b) => b.text(), () => null);

  it('keeps its bytes when the message that carried it is deleted, for as long as the bookmark stands, and goes with the bookmark', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(alice, wsId, 'roadmap.pdf', 'application/pdf', 'roadmap');
    const m = (await post(alice, wsId, general.id, 'the plan', [{ id: file.id }])).data.message;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Roadmap', file: file.id }] })).ok).toBe(true);
    // The author tidies up their message: the bookmark still leads to the file.
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`)).ok).toBe(true);
    expect(await fetchAs(bob, wsId, file.id)).toBe(200);
    expect(await bytesOf(wsId, file.id)).toBe('roadmap');
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels[general.id].bookmarks[0]).toMatchObject({ file: file.id, name: 'roadmap.pdf' });
    // The bookmark is taken down: nothing holds the file now, and its bytes go rather than sit in the owner's drive for good.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [] })).ok).toBe(true);
    expect(await fetchAs(bob, wsId, file.id)).toBe(404);
    expect(await bytesOf(wsId, file.id)).toBeNull();
    expect(await rt.kv.get(KEYS.file(file.id))).toBeFalsy();
  });

  it('is left alone by a bookmark taken down while a message still carries it, and by a channel deleted while another channel bookmarks it', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const plans = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'plans' })).data.channel.id;
    const file = await upload(alice, wsId, 'notes.txt', 'text/plain', 'notes');
    await post(alice, wsId, plans, 'notes', [{ id: file.id }]);
    // Bookmarked in two channels; one bookmark down, the message standing: the file stays, held by the message.
    await as(alice).put(`/api/ws/${wsId}/channels/${plans}`, { bookmarks: [{ label: 'Notes', file: file.id }] });
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Notes', file: file.id }] });
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${plans}`, { bookmarks: [] })).ok).toBe(true);
    expect(await fetchAs(bob, wsId, file.id)).toBe(200);
    expect((await rt.kv.get(KEYS.file(file.id))).refs).toBe(1);
    // The channel with the message goes: its hold goes with it, and #general's bookmark keeps the bytes.
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${plans}`)).ok).toBe(true);
    expect(await fetchAs(bob, wsId, file.id)).toBe(200);
    expect(await bytesOf(wsId, file.id)).toBe('notes');
    // A channel deleted with a bookmark of its own, to a file nothing else holds, takes the file with it.
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel.id;
    const lone = await upload(alice, wsId, 'lone.txt', 'text/plain', 'lone');
    const lm = (await post(alice, wsId, other, 'lone', [{ id: lone.id }])).data.message;
    await as(alice).put(`/api/ws/${wsId}/channels/${other}`, { bookmarks: [{ label: 'Lone', file: lone.id }] });
    await as(alice).del(`/api/ws/${wsId}/conv/${other}/messages/${lm.seq}`);
    expect(await bytesOf(wsId, lone.id)).toBe('lone');
    expect((await as(alice).del(`/api/ws/${wsId}/channels/${other}`)).ok).toBe(true);
    expect(await bytesOf(wsId, lone.id)).toBeNull();
    expect(await rt.kv.get(KEYS.file(lone.id))).toBeFalsy();
    // And #general's bookmark, taken down at last, lets the first file go.
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [] })).ok).toBe(true);
    expect(await bytesOf(wsId, file.id)).toBeNull();
  });
});

describe('an integration\'s name', () => {
  it('is cleaned as a display name is: bidi overrides and control characters out, and one that shows as nothing refused', async () => {
    const { wsId, general } = await workspaceWith(alice);
    // The name is the author line of every post the integration makes: a
    // right-to-left override in it turned the time beside it around.
    const hook = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'Deploys\u202E\u0007 bot' });
    expect(hook.ok).toBe(true);
    expect(hook.data.name).toBe('Deploys bot');
    expect((await rt.kv.get(KEYS.hook(hook.data.id))).name).toBe('Deploys bot');
    const bot = await as(alice).post(`/api/ws/${wsId}/bots`, { name: '\u202EReleases', scopes: ['post'], channels: [general.id] });
    expect(bot.data.name).toBe('Releases');
    for (const name of ['\u0007', '\u202E\u200D', '   ']) {
      const refused = await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name });
      expect(refused.status, JSON.stringify(name)).toBe(400);
      expect(refused.data.message).toBe('Give it a name');
      expect((await as(alice).post(`/api/ws/${wsId}/bots`, { name, channels: [general.id] })).status, JSON.stringify(name)).toBe(400);
    }
    // What the webhook posts carries the clean name.
    const posted = await rt.dispatch(`${BASE}/webhook/${hook.data.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'deployed' }) }, null);
    expect(posted.status).toBe(200);
    const line = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.find((m) => m.text === 'deployed');
    expect(line.bot).toEqual({ name: 'Deploys bot', color: hook.data.color });
    // An app's line brought in with an archive is cleaned the same way.
    const conv = 'botnameconv';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'botnameimp0', name: 'Old' },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv] } },
    };
    const newId = (await as(alice).post('/api/workspaces/import', { header })).data.workspace.id;
    const page = await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 2, messages: [
      { seq: 1, user: 'hook_abcdefghij', text: 'built', ts: 1000, bot: { name: '\u202ECI\u0007', color: 3 } },
      { seq: 2, user: 'hook_abcdefghij', text: 'shipped', ts: 2000, bot: { name: '\u0007', color: 3 } },
    ] });
    expect(page.ok).toBe(true);
    const block = await rt.kv.get(KEYS.block(conv, 0));
    expect(block.m[0].bot).toEqual({ name: 'CI', color: 3 });
    expect(block.m[1].bot).toEqual({ name: 'App', color: 3 });
  });
});

describe('the names an imported archive carries', () => {
  it('are cleaned as names written here are: the workspace\'s, a former member\'s and that of the workspace they came from', async () => {
    const conv = 'nameimpconv';
    const header = (workspaceName, formerName) => ({
      format: 'teamchat-export', version: 1, workspace: { id: 'nameimp0000', name: workspaceName },
      channels: { [conv]: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv] } },
      former: { 'u-old-0000': { username: 'old', name: formerName, color: 2, at: 5, org: { name: '\u202EGlobex', ref: 'abc123def0@teamchat-x' } } },
    });
    // A right-to-left override at the head of a name turned the rest of its line around.
    const one = await as(alice).post('/api/workspaces/import', { header: header('\u202EAcme', 'Old\u202E Hand') });
    expect(one.ok).toBe(true);
    expect(one.data.workspace.name).toBe('Acme');
    const ws = await rt.kv.get(KEYS.ws(one.data.workspace.id));
    expect(ws.name).toBe('Acme');
    expect(ws.former['u-old-0000']).toMatchObject({ name: 'Old Hand', org: { name: 'Globex', ref: 'abc123def0@teamchat-x' } });
    // A name that shows as nothing is no name: the fallbacks stand in, as they do for a name missing altogether.
    const two = await as(alice).post('/api/workspaces/import', { header: header('\u202E\u200D', '') });
    expect(two.ok).toBe(true);
    expect(two.data.workspace.name).toBe('Imported workspace');
    expect((await rt.kv.get(KEYS.ws(two.data.workspace.id))).former['u-old-0000'].name).toBe('Former member');
  });
});

describe('a large answer arriving slowly', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  /** A worker whose answer begins at once and whose body comes in `chunks` pieces, one every `every` ms, then stops for `stall` ms before the last. */
  function slowJson(chunks, every, stall = 0) {
    const seen = { signal: null };
    let i = 0;
    let ctrl = null;
    const stream = new ReadableStream({
      start(c) {
        ctrl = c;
      },
      pull(c) {
        const wait = i === chunks.length - 1 && stall ? stall : every;
        return new Promise((r) => setTimeout(() => {
          if (i < chunks.length) c.enqueue(new TextEncoder().encode(chunks[i++]));
          if (i >= chunks.length) c.close();
          r();
        }, wait));
      },
    });
    globalThis.puter = { workers: { exec: async (url, init) => {
      seen.signal = init.signal;
      // As fetch has it: an aborted request tears its body down, and a read in flight fails with the reason.
      init.signal.addEventListener('abort', () => { try { ctrl.error(init.signal.reason); } catch { /* closed already */ } });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } } };
    return seen;
  }
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  it('is read to the end for as long as it keeps coming, past the plain timeout, and given up on only once it stops', async () => {
    vi.useFakeTimers();
    // Four pieces, fifteen seconds apart: a minute of body after the answer began, as an export page of a few megabytes takes on a slow link.
    const page = JSON.stringify({ pages: [{ conv: 'c1', messages: Array.from({ length: 50 }, (_, k) => ({ seq: k + 1, text: 'x'.repeat(200) })) }], done: false });
    const cut = Math.ceil(page.length / 4);
    const seen = slowJson([page.slice(0, cut), page.slice(cut, 2 * cut), page.slice(2 * cut, 3 * cut), page.slice(3 * cut)], 15_000);
    const pending = settle(api.exportPage('abcdef@teamchat-x', null));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(seen.signal.aborted).toBe(false);
    const out = await pending;
    expect(out.ok).toBe(true);
    expect(out.v.pages[0].messages).toHaveLength(50);
    // A body that stops coming is given up on after the plain timeout, as before.
    const stalled = slowJson(['{"ok":', 'true}'], 1_000, 25_000);
    const hung = settle(api.exportPage('abcdef@teamchat-x', null));
    await vi.advanceTimersByTimeAsync(1_000 + 19_000);
    expect(stalled.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(stalled.signal.aborted).toBe(true);
    const res = await hung;
    expect(res.ok).toBe(false);
    expect(res.e.code).toBe('timeout');
  });
});

describe('emailing invitations to a service that does not answer', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const invite = { kind: 'workspace', server: 'teamchat-x', code: 'ABCD-EFGH-IJKL', workspace: 'Acme', inviter: 'Alice', emails: ['pat@example.com'] };
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  it('gives up after a minute with a word on what to do, rather than leaving the dialog sending for good; the signal it sends ends the request', async () => {
    vi.useFakeTimers();
    globalThis.location = globalThis.location || { origin: 'https://puter.com', pathname: '/app/teamchat' };
    let signal = null;
    globalThis.puter = { workers: { exec: (url, init) => new Promise((resolve, reject) => {
      signal = init.signal;
      init.signal?.addEventListener('abort', () => reject(init.signal.reason));
    }) } };
    const pending = settle(sendInviteEmails(invite));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(signal?.aborted).toBeFalsy();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(signal?.aborted).toBe(true);
    const out = await pending;
    expect(out.ok).toBe(false);
    expect(out.e.message).toBe('The email service took too long to answer; if nothing arrives, copy the link and share it directly.');
    // An answer in time is taken as before.
    globalThis.puter = { workers: { exec: async () => new Response(JSON.stringify({ ok: true, sent: 1, failed: 0, suppressed: 0, results: [{ email: 'pat@example.com', status: 'sent' }] }), { status: 200 }) } };
    expect((await sendInviteEmails(invite)).sent).toBe(1);
  });
});

describe('a webhook payload of exactly the size allowed', () => {
  it('is taken, as the size limit says; one byte more is refused', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'Deploys' })).data;
    const post = (body) => rt.dispatch(`${BASE}/webhook/${hook.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, null);
    // {"text":"…"} is eleven bytes around the text.
    const ofSize = (bytes) => JSON.stringify({ text: 'a'.repeat(bytes - 11) });
    expect(new TextEncoder().encode(ofSize(LIMITS.webhookBodyBytes)).byteLength).toBe(LIMITS.webhookBodyBytes);
    const exact = await post(ofSize(LIMITS.webhookBodyBytes));
    expect(exact.status).toBe(200);
    const over = await post(ofSize(LIMITS.webhookBodyBytes + 1));
    expect(over.status).toBe(413);
    expect((await over.json()).message).toBe(`Payloads can be up to ${LIMITS.webhookBodyBytes / 1024} KB`);
    // Said with a length as well as without one.
    const declared = await rt.dispatch(`${BASE}/webhook/${hook.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': String(LIMITS.webhookBodyBytes) }, body: ofSize(LIMITS.webhookBodyBytes) }, null);
    expect(declared.status).toBe(200);
  });
});

describe('an imported channel\'s topic, description and bookmark labels', () => {
  it('are cleaned as the channel routes clean them: overrides and control characters out, a description keeping its line breaks, a label that shows as nothing dropping its bookmark', async () => {
    const conv = 'chanimpconv';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'chanimp0000', name: 'Old' },
      channels: { [conv]: {
        name: 'general', def: true,
        topic: '\u202EShip it\u0007 by Friday',
        description: 'Line one\r\nLine two \n\n\u202ELine three',
        bookmarks: [
          { id: 'bkmk0001', label: 'Road\u202Emap', url: 'https://example.com/roadmap' },
          { id: 'bkmk0002', label: '\u202E\u200D', url: 'https://example.com/nothing' },
          { id: 'bkmk0003', label: 'Plan', file: 'chanimpfile1', name: 'plan.pdf' },
        ],
      } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv] } },
    };
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const ch = (await rt.kv.get(KEYS.ws(created.data.workspace.id))).channels[conv];
    expect(ch.topic).toBe('Ship it by Friday');
    // Line breaks stay (only the carriage returns and the override go); the ends are trimmed as before.
    expect(ch.description).toBe('Line one\nLine two \n\nLine three');
    expect(ch.bookmarks.map((b) => b.label)).toEqual(['Roadmap', 'Plan']);
    expect(ch.bookmarks[0]).toMatchObject({ id: 'bkmk0001', url: 'https://example.com/roadmap' });
    expect(ch.bookmarks[1]).toMatchObject({ id: 'bkmk0003', file: 'chanimpfile1', name: 'plan.pdf' });
  });
});

describe('the integrations list, for an admin outside a private channel', () => {
  it('names no private channel they are not in, refuses them a token into it, and keeps the channel on a bot they change', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid] });
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: secret, name: 'Deploys' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Reader', scopes: ['read'], channels: [general.id, secret] })).data;
    // Alice, in the channel, sees both as they are.
    const mine = (await as(alice).get(`/api/ws/${wsId}/webhooks`)).data;
    expect(mine.webhooks.find((h) => h.id === hook.id).ch).toBe(secret);
    expect(mine.bots.find((b) => b.id === bot.id)).toMatchObject({ channels: [general.id, secret] });
    expect(mine.bots.find((b) => b.id === bot.id).hidden).toBeUndefined();
    // Bob, an admin outside it, is shown the webhook without the channel, and the bot without that channel (but told one is kept from him).
    const his = (await as(bob).get(`/api/ws/${wsId}/webhooks`)).data;
    expect(his.webhooks.find((h) => h.id === hook.id)).toMatchObject({ id: hook.id, name: 'Deploys', ch: null, private: true });
    expect(his.bots.find((b) => b.id === bot.id)).toMatchObject({ channels: [general.id], hidden: 1 });
    expect(JSON.stringify(his)).not.toContain(secret);
    // A fresh token would post into, or read, the channel for him: refused; Alice may rotate both.
    const rh = await as(bob).post(`/api/ws/${wsId}/webhooks/${hook.id}/rotate`);
    expect(rh.status).toBe(403);
    expect(rh.data.message).toBe('This webhook posts to a private channel you are not in; an admin in it can rotate its token');
    const rb = await as(bob).post(`/api/ws/${wsId}/bots/${bot.id}/rotate`);
    expect(rb.status).toBe(403);
    expect(rb.data.message).toBe('This bot is in a private channel you are not in; an admin in it can rotate its token');
    expect((await as(alice).post(`/api/ws/${wsId}/webhooks/${hook.id}/rotate`)).data.token).toMatch(/^tch_/);
    expect((await as(alice).post(`/api/ws/${wsId}/bots/${bot.id}/rotate`)).data.token).toMatch(/^tcb_/);
    // Bob changes the bot from what he sees: the channel he cannot see stays on it.
    expect((await as(bob).put(`/api/ws/${wsId}/bots/${bot.id}`, { channels: [general.id] })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.bot(bot.id))).channels).toEqual([general.id, secret]);
    expect((await as(bob).put(`/api/ws/${wsId}/bots/${bot.id}`, { channels: [] })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.bot(bot.id))).channels).toEqual([secret]);
    expect((await rt.kv.get(KEYS.ws(wsId))).bots[bot.id].channels).toEqual([secret]);
    // Someone in the channel takes it off the bot as before.
    expect((await as(alice).put(`/api/ws/${wsId}/bots/${bot.id}`, { channels: [general.id] })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.bot(bot.id))).channels).toEqual([general.id]);
    // Revoking is not a way in, and stays any admin's.
    expect((await as(bob).del(`/api/ws/${wsId}/webhooks/${hook.id}`)).ok).toBe(true);
  });
});

describe('a link preview of a page whose head closes in capitals', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('stops reading at </HEAD> as it does at </head>, rather than taking the body to the cap', async () => {
    const enc = (s) => new TextEncoder().encode(s);
    let pulls = 0;
    globalThis.fetch = async () => new Response(new ReadableStream({
      pull(c) {
        pulls++;
        if (pulls === 1) c.enqueue(enc('<HTML><HEAD><META PROPERTY="og:title" CONTENT="Upper case head"></HEAD><BODY>'));
        else if (pulls > 400) c.close();
        else c.enqueue(enc('x'.repeat(1024)));
      },
    }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const { wsId, general } = await workspaceWith(alice);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'https://docs.example.com/upper' })).data.message;
    const res = await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`);
    expect(res.ok).toBe(true);
    expect(res.data.unfurl.title).toBe('Upper case head');
    // The head was in the first piece; the two hundred kilobytes behind it were not read.
    expect(pulls).toBeLessThan(5);
  });
});

describe('an incoming-webhook markup payload', () => {
  it('has its links, mentions and escapes read as the payload writes them, so the channel shows a link and not its markup', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = (body) => rt.dispatch(`${BASE}/webhook/${hook.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, null);
    const texts = async () => (await as(bob).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.filter((m) => m.bot).map((m) => m.text);
    // What a CI server or a script sends by incoming-webhook rules: <url|label>, <url>, <!channel>, <@id|name>, <#id|name>, and & < > escaped.
    expect((await post({ text: 'Build <https://ci.example.com/42|#42> passed &amp; deployed &lt;3 <!channel> see <https://ci.example.com> by <@U1|bob> in <#C1|general>, mail <mailto:ops@example.com|ops>' })).status).toBe(200);
    expect((await post({ blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Release <https://example.com/notes|notes> are out' } }] })).status).toBe(200);
    // Our own shape is untouched: a stray angle bracket, or an ampersand, is just text.
    expect((await post({ text: 'a <b> and b & c, 1 < 2' })).status).toBe(200);
    expect(await texts()).toEqual([
      'Build #42 (https://ci.example.com/42) passed & deployed <3 @channel see https://ci.example.com by @bob in #general, mail ops (ops@example.com)',
      'Release notes (https://example.com/notes) are out',
      'a <b> and b & c, 1 < 2',
    ]);
  });
});

describe('a bookmark coming down while the last message carrying its file is deleted', () => {
  it('lets the file go, whichever of the two lands first, rather than leaving its bytes held by nothing', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const bytesOf = (id) => rt.fs.read(`teamchat-files/${wsId}/${id}`).then(() => true, () => false);
    const fd = new FormData();
    fd.append('file', new Blob(['plan'], { type: 'text/plain' }), 'plan.txt');
    const file = (await as(alice).post(`/api/ws/${wsId}/files`, fd)).data;
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'plan', attachments: [{ id: file.id }] })).data.message;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Plan', file: file.id }] })).ok).toBe(true);
    // The deletion has read the workspace (the bookmark stands) and is about
    // to count the file down when the bookmark is taken off the list: that
    // request reads the file still held by the message and leaves it. Both
    // are then done, and each saw the other's hold standing.
    const realIncr = rt.kv.incr;
    let release = null;
    const gate = new Promise((r) => { release = r; });
    rt.kv.incr = async function (k, ...rest) {
      if (k === KEYS.file(file.id)) {
        rt.kv.incr = realIncr;
        await gate;
      }
      return realIncr.call(this, k, ...rest);
    };
    try {
      const deleting = as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`);
      await new Promise((r) => setTimeout(r, 20));
      expect((await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [] })).ok).toBe(true);
      expect(await bytesOf(file.id)).toBe(true); // still held by the message at that moment
      release();
      expect((await deleting).ok).toBe(true);
    } finally {
      rt.kv.incr = realIncr;
    }
    expect(await bytesOf(file.id)).toBe(false);
    expect(await rt.kv.get(KEYS.file(file.id))).toBeFalsy();
    // And a bookmark still standing keeps the file, as before.
    const fd2 = new FormData();
    fd2.append('file', new Blob(['kept'], { type: 'text/plain' }), 'kept.txt');
    const kept = (await as(alice).post(`/api/ws/${wsId}/files`, fd2)).data;
    const k = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'kept', attachments: [{ id: kept.id }] })).data.message;
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Kept', file: kept.id }] });
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${k.seq}`)).ok).toBe(true);
    expect(await bytesOf(kept.id)).toBe(true);
  });
});

describe('moving a workspace, from the nominee\'s side: the freeze', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const OLD = 'abcdef1234@teamchat-old';
  const NEW_URL = 'https://teamchat-new.puter.work';
  const HEADER = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { c1: { name: 'general', def: true } }, members: {}, memberDocs: {} };
  const PAGE = { conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'hi', ts: 1 }] };

  /** Two faked servers (the old copy's and the nominee's own), answering route by route; returns the calls made, in order. */
  function servers({ pages = 1, pageTakesMs = 0, failExportAt = null, failImportPage = false, begin = () => json({ ok: true, transferring: { by: 'me', at: 1 } }) } = {}) {
    const made = [];
    let served = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const u = new URL(url);
      const path = u.pathname;
      const method = init.method || 'GET';
      made.push(`${method} ${path}`);
      if (path === '/api/ws/abcdef1234') return json({ workspace: { id: 'abcdef1234', name: 'Acme', movedTo: null } });
      if (path.endsWith('/transfer/begin')) return begin();
      if (path.endsWith('/transfer/cancel')) return json({ ok: true });
      if (path.endsWith('/transfer/complete')) return json({ ok: true, movedTo: 'copy0000001@teamchat-new' });
      if (path === '/api/ws/abcdef1234/export') {
        const n = served++;
        if (failExportAt === n) return json({ code: 'internal', message: 'the store failed' }, 500);
        if (pageTakesMs) await new Promise((r) => setTimeout(r, pageTakesMs));
        return json({ ...(n === 0 ? { header: HEADER } : {}), pages: n === 0 ? [PAGE] : [], files: [], done: n + 1 >= pages, cursor: { k: 'abcdefghijkl', i: n + 1, n: 0 }, progress: { done: n + 1, total: pages } });
      }
      if (path === '/api/workspaces/import') return json({ workspace: { id: 'copy0000001', name: 'Acme' } });
      if (path === '/api/ws/copy0000001/import') return failImportPage ? json({ code: 'internal', message: 'the store failed' }, 500) : json({ ok: true, conv: 'c1', count: 1 });
      if (path === '/api/ws/copy0000001/import/finish') return json({ ok: true });
      if (method === 'DELETE') return json({ ok: true });
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    return made;
  }
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  it('pauses the old copy before the first page is read, and completes as before, which lets the pause go', async () => {
    const made = servers();
    const state = { copy: null };
    const out = await transferWorkspace(OLD, NEW_URL, state, { profile: { name: 'Bob' } });
    expect(out).toEqual({ ref: 'copy0000001@teamchat-new', icon: null, mine: true });
    const at = (s) => made.findIndex((x) => x === s);
    expect(at('POST /api/ws/abcdef1234/transfer/begin')).toBeGreaterThan(at('GET /api/ws/abcdef1234'));
    expect(at('POST /api/ws/abcdef1234/transfer/begin')).toBeLessThan(at('GET /api/ws/abcdef1234/export'));
    expect(at('GET /api/ws/abcdef1234/export')).toBeLessThan(at('POST /api/workspaces/import'));
    expect(at('POST /api/ws/copy0000001/import/finish')).toBeLessThan(at('POST /api/ws/abcdef1234/transfer/complete'));
    expect(made.filter((x) => x.endsWith('/transfer/begin'))).toHaveLength(1);
    expect(made.some((x) => x.endsWith('/transfer/cancel'))).toBe(false);
  });

  it('renews the pause every ten minutes while a long export runs', async () => {
    vi.useFakeTimers();
    const made = servers({ pages: 4, pageTakesMs: 7 * 60_000 }); // twenty-eight minutes of export
    const pending = transferWorkspace(OLD, NEW_URL, { copy: null }, { profile: { name: 'Bob' } });
    await vi.advanceTimersByTimeAsync(4 * 7 * 60_000 + 1000);
    expect((await pending).mine).toBe(true);
    const begins = made.filter((x) => x.endsWith('/transfer/begin'));
    expect(begins.length).toBe(1 + Math.floor((4 * 7 * 60_000) / TRANSFER_RENEW_MS)); // the first, then at 10 and 20 minutes
    // Nothing renews once the move is done.
    const before = made.length;
    await vi.advanceTimersByTimeAsync(3 * TRANSFER_RENEW_MS);
    expect(made.length).toBe(before);
  });

  it('calls the pause off when the export fails, and when the import into the new copy fails, and says what went wrong as before', async () => {
    const onExport = servers({ pages: 3, failExportAt: 1 });
    const s1 = { copy: null };
    const a = await settle(transferWorkspace(OLD, NEW_URL, s1, { profile: { name: 'Bob' } }));
    expect(a.ok).toBe(false);
    expect(a.e).toBeInstanceOf(ApiError);
    expect(a.e.message).toBe('the store failed');
    expect(onExport.some((x) => x === 'POST /api/ws/abcdef1234/transfer/cancel')).toBe(true);
    expect(onExport.some((x) => x === 'POST /api/workspaces/import')).toBe(false);
    expect(s1.copy).toBeNull();
    const onImport = servers({ failImportPage: true });
    const s2 = { copy: null };
    const b = await settle(transferWorkspace(OLD, NEW_URL, s2, { profile: { name: 'Bob' } }));
    expect(b.ok).toBe(false);
    expect(b.e.message).toBe('the store failed');
    // The copy stopped short is taken down, the pause called off, and nothing completed.
    expect(onImport.indexOf('DELETE /api/ws/copy0000001')).toBeGreaterThan(onImport.indexOf('POST /api/ws/copy0000001/import'));
    expect(onImport.some((x) => x === 'POST /api/ws/abcdef1234/transfer/cancel')).toBe(true);
    expect(onImport.some((x) => x.endsWith('/transfer/complete'))).toBe(false);
    expect(s2.copy).toBeNull();
  });

  it('stops before exporting when another session holds the pause, or the server predates it, leaving that session\'s pause alone', async () => {
    const held = servers({ begin: () => json({ code: 'transferring', message: 'This workspace is being moved to another server; try again in a few minutes.' }, 423) });
    const a = await settle(transferWorkspace(OLD, NEW_URL, { copy: null }, { profile: { name: 'Bob' } }));
    expect(a.ok).toBe(false);
    expect(a.e.code).toBe('transferring');
    expect(a.e.message).toBe('this workspace is already being moved by another of your sessions; let it finish, then open the workspace again');
    expect(held.some((x) => x.endsWith('/export'))).toBe(false);
    expect(held.some((x) => x.endsWith('/transfer/cancel'))).toBe(false);
    const old = servers({ begin: () => json({ code: 'not_found', message: 'No such endpoint' }, 404) });
    const b = await settle(transferWorkspace(OLD, NEW_URL, { copy: null }, { profile: { name: 'Bob' } }));
    expect(b.ok).toBe(false);
    expect(b.e.message).toMatch(/server is out of date/);
    expect(old.some((x) => x.endsWith('/export'))).toBe(false);
    // The code travels through ApiError as `moved` does.
    expect(isTransferring(new ApiError(423, 'transferring', 'x'))).toBe(true);
    expect(isTransferring(new ApiError(423, 'moved', 'x'))).toBe(false);
  });

  it('holds the old copy read-only for the members while the move runs, and lets it go with the completion, or at once when the move fails', async () => {
    await as(alice).put('/api/server', { open: true });
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'before the move' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    const oldRef = `${wsId}@teamchat-x`;
    // The nominee's app, its calls landing on the in-memory worker as Bob;
    // the moment the pause is granted, a member tries to post and to read.
    let during = null;
    let failImport = false;
    globalThis.puter = { workers: { exec: async (url, init) => {
      const path = new URL(url).pathname;
      if (failImport && path.endsWith('/import') && init?.method === 'POST') return json({ code: 'internal', message: 'the store failed' }, 500);
      const res = await rt.dispatch(url, init, bob);
      if (path.endsWith('/transfer/begin') && !during) {
        during = {
          post: await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'during the move' }),
          read: await as(carol).get(`/api/ws/${wsId}/conv/${general.id}/messages`),
          bootstrap: (await as(carol).get(`/api/ws/${wsId}`)).data.workspace,
        };
      }
      return res;
    } } };
    const state = { copy: null };
    const moved = await transferWorkspace(oldRef, 'https://teamchat-x.puter.work', state, { profile: { name: 'Bob' } });
    expect(moved.mine).toBe(true);
    expect(during.post.status).toBe(423);
    expect(during.post.data.code).toBe('transferring');
    expect(during.post.data.message).toBe('This workspace is being moved to another server; try again in a few minutes');
    expect(during.read.status).toBe(200);
    expect(during.read.data.messages.some((m) => m.text === 'before the move')).toBe(true);
    expect(during.bootstrap.transferring).toMatchObject({ by: bob.uuid });
    // Completed: the old copy is moved, the pause gone with it, and the copy takes writes.
    const old = await rt.kv.get(KEYS.ws(wsId));
    expect(old.movedTo).toBe(moved.ref);
    expect(old.transferring).toBeFalsy();
    const copyId = moved.ref.split('@')[0];
    const copy = (await as(carol).get(`/api/ws/${copyId}`)).data.workspace;
    expect(copy.transferring).toBeFalsy();
    const ch = Object.values(copy.channels).find((c) => c.name === 'general');
    expect((await as(carol).post(`/api/ws/${copyId}/conv/${ch.id}/messages`, { text: 'after the move' })).ok).toBe(true);
    // A move that fails partway: the pause is called off at once, and the members write again.
    const second = await workspaceWith(alice, [bob, carol], 'Globex');
    await as(alice).post(`/api/ws/${second.wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    expect((await as(alice).post(`/api/ws/${second.wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    during = null;
    failImport = true;
    const failed = await transferWorkspace(`${second.wsId}@teamchat-x`, 'https://teamchat-x.puter.work', { copy: null }, { profile: { name: 'Bob' } }).then(() => null, (e) => e);
    expect(failed?.message).toBe('the store failed');
    expect((await rt.kv.get(KEYS.ws(second.wsId))).transferring).toBeFalsy();
    expect((await as(carol).post(`/api/ws/${second.wsId}/conv/${second.general.id}/messages`, { text: 'writing again' })).ok).toBe(true);
  });
});
