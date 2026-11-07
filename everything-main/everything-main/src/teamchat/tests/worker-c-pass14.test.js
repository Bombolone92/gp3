/**
 * Fourteenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { transferWorkspace, importArchive, TRANSFER_RENEW_MS } from '../src/lib/archive.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('the freeze around a move names the session that holds it', () => {
  const MIN = 60_000;
  async function nominated() {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    return { wsId, general };
  }
  const begin = (wsId, sid) => as(bob).post(`/api/ws/${wsId}/transfer/begin`, sid ? { sid } : undefined);

  it('refuses another session of the nominee while a named freeze stands, renews for the session that holds it, and takes over one that lapsed or was never named', async () => {
    const { wsId, general } = await nominated();
    const first = await begin(wsId, 'session-one-1');
    expect(first.ok).toBe(true);
    expect(first.data.transferring).toMatchObject({ by: bob.uuid, sid: 'session-one-1' });
    // A second session of the same nominee: refused, the freeze left as it is.
    const second = await begin(wsId, 'session-two-2');
    expect(second.status).toBe(423);
    expect(second.data.code).toBe('transferring');
    expect(second.data.message).toMatch(/another of your sessions/);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring.sid).toBe('session-one-1');
    // An app from before sessions were named asks without one: refused too, since the freeze is a named session's.
    expect((await begin(wsId)).status).toBe(423);
    // The holder renews, and the freeze moves on with the same name.
    const at = (await rt.kv.get(KEYS.ws(wsId))).transferring.at;
    await new Promise((r) => setTimeout(r, 5));
    const renewed = await begin(wsId, 'session-one-1');
    expect(renewed.ok).toBe(true);
    expect(renewed.data.transferring.sid).toBe('session-one-1');
    expect(renewed.data.transferring.at).toBeGreaterThan(at);
    // Members see the pause as before: who, and since when.
    const seen = (await as(carol).get(`/api/ws/${wsId}`)).data.workspace.transferring;
    expect(seen).toMatchObject({ by: bob.uuid, at: renewed.data.transferring.at });
    expect((await as(carol).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'during' })).status).toBe(423);
    // A freeze that lapsed (the holder's tab closed) is anyone's of the nominee's to take.
    await rt.kv.update(KEYS.ws(wsId), { 'transferring.at': Date.now() - 31 * MIN });
    const taken = await begin(wsId, 'session-two-2');
    expect(taken.ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring.sid).toBe('session-two-2');
    // One an old app left unnamed is taken over by a named session, and by another unnamed one.
    await rt.kv.update(KEYS.ws(wsId), { transferring: { by: bob.uuid, at: Date.now() } });
    expect((await begin(wsId, 'session-one-1')).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring.sid).toBe('session-one-1');
    await rt.kv.update(KEYS.ws(wsId), { transferring: { by: bob.uuid, at: Date.now() } });
    expect((await begin(wsId)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring.sid).toBeUndefined();
    // Cancelling and completing let the freeze go whoever named it, as before.
    expect((await begin(wsId, 'session-one-1')).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/cancel`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring).toBeFalsy();
    expect((await begin(wsId, 'session-two-2')).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/complete`, { to: `${wsId}@teamchat-new` })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring).toBeFalsy();
  });

  it('tells members who is moving the workspace and since when, and nothing of the session that holds the freeze', async () => {
    const { wsId } = await nominated();
    const granted = (await begin(wsId, 'session-one-1')).data;
    expect(granted.transferring).toEqual({ by: bob.uuid, at: granted.transferring.at, sid: 'session-one-1' });
    expect(granted.until).toBe(granted.transferring.at + 30 * 60_000);
    for (const who of [carol, alice, bob]) {
      const seen = (await as(who).get(`/api/ws/${wsId}`)).data.workspace.transferring;
      expect(seen).toEqual({ by: bob.uuid, at: granted.transferring.at });
    }
    // Lapsed, it is not shown at all, as before.
    await rt.kv.update(KEYS.ws(wsId), { 'transferring.at': Date.now() - 31 * MIN });
    expect((await as(carol).get(`/api/ws/${wsId}`)).data.workspace.transferring).toBeNull();
  });

  it('is only the nominee\'s to name', async () => {
    const { wsId } = await nominated();
    expect((await as(carol).post(`/api/ws/${wsId}/transfer/begin`, { sid: 'session-one-1' })).status).toBe(403);
    expect((await as(alice).post(`/api/ws/${wsId}/transfer/begin`, { sid: 'session-one-1' })).status).toBe(403);
    // A name of the wrong shape is no name: the freeze is unnamed, as an old app's.
    expect((await begin(wsId, 'x')).ok).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring.sid).toBeUndefined();
  });
});

describe('moving a workspace, from the nominee\'s side: the session named to the freeze', () => {
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

  /** Two faked servers answering route by route; `begin` sees each freeze request's body. Returns the calls made, in order. */
  function servers({ pages = 1, pageTakesMs = 0, begin = (body) => json({ ok: true, transferring: { by: 'me', at: 1, sid: body?.sid } }) } = {}) {
    const made = [];
    let served = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = init.method || 'GET';
      made.push({ call: `${method} ${path}`, body: init.body ? JSON.parse(init.body) : null });
      if (path === '/api/ws/abcdef1234') return json({ workspace: { id: 'abcdef1234', name: 'Acme', movedTo: null } });
      if (path.endsWith('/transfer/begin')) return begin(init.body ? JSON.parse(init.body) : null);
      if (path.endsWith('/transfer/cancel')) return json({ ok: true });
      if (path.endsWith('/transfer/complete')) return json({ ok: true, movedTo: 'copy0000001@teamchat-new' });
      if (path === '/api/ws/abcdef1234/export') {
        const n = served++;
        if (pageTakesMs) await new Promise((r) => setTimeout(r, pageTakesMs));
        return json({ ...(n === 0 ? { header: HEADER } : {}), pages: n === 0 ? [PAGE] : [], files: [], done: n + 1 >= pages, cursor: { k: 'abcdefghijkl', i: n + 1, n: 0 }, progress: { done: n + 1, total: pages } });
      }
      if (path === '/api/workspaces/import') return json({ workspace: { id: 'copy0000001', name: 'Acme' } });
      if (path === '/api/ws/copy0000001/import') return json({ ok: true, conv: 'c1', count: 1 });
      if (path === '/api/ws/copy0000001/import/finish') return json({ ok: true });
      if (method === 'DELETE') return json({ ok: true });
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    return made;
  }
  const begins = (made) => made.filter((x) => x.call.endsWith('/transfer/begin'));
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  it('names one session per dialog, on the first freeze and every renewal, and keeps the name for a retry from the same dialog', async () => {
    vi.useFakeTimers();
    const made = servers({ pages: 3, pageTakesMs: 7 * 60_000 });
    const state = { copy: null };
    const pending = transferWorkspace(OLD, NEW_URL, state, { profile: { name: 'Bob' } });
    await vi.advanceTimersByTimeAsync(3 * 7 * 60_000 + 1000);
    expect((await pending).mine).toBe(true);
    const named = begins(made).map((x) => x.body?.sid);
    expect(named.length).toBe(1 + Math.floor((3 * 7 * 60_000) / TRANSFER_RENEW_MS));
    expect(named[0]).toMatch(/^[a-z0-9]{16}$/);
    expect(new Set(named).size).toBe(1);
    expect(state.sid).toBe(named[0]);
    // The same dialog trying again (its copy forgotten, say) carries the name on rather than minting one the worker would refuse.
    vi.useRealTimers();
    const again = servers();
    await transferWorkspace(OLD, NEW_URL, { copy: null, sid: state.sid }, { profile: { name: 'Bob' } });
    expect(begins(again)[0].body).toEqual({ sid: state.sid });
  });

  it('stops at the next page, without cancelling, when a renewal finds another session holding the freeze', async () => {
    vi.useFakeTimers();
    let asked = 0;
    const made = servers({ pages: 4, pageTakesMs: 7 * 60_000, begin: (body) => (asked++ === 0
      ? json({ ok: true, transferring: { by: 'me', at: 1, sid: body?.sid } })
      : json({ code: 'transferring', message: 'This workspace is already being moved from another of your sessions; let that finish' }, 423)) });
    const pending = settle(transferWorkspace(OLD, NEW_URL, { copy: null }, { profile: { name: 'Bob' } }));
    await vi.advanceTimersByTimeAsync(4 * 7 * 60_000 + 1000);
    const out = await pending;
    expect(out.ok).toBe(false);
    expect(out.e.code).toBe('transferring');
    expect(out.e.message).toBe('this workspace is already being moved by another of your sessions; let it finish, then open the workspace again');
    // The export stopped short of its last pages, nothing was imported, and the other session's freeze was left alone.
    expect(made.filter((x) => x.call === 'GET /api/ws/abcdef1234/export').length).toBeLessThan(4);
    expect(made.some((x) => x.call === 'POST /api/workspaces/import')).toBe(false);
    expect(made.some((x) => x.call.endsWith('/transfer/cancel'))).toBe(false);
    expect(made.some((x) => x.call.endsWith('/transfer/complete'))).toBe(false);
  });

  it('is refused before exporting when another of the nominee\'s sessions holds the freeze on the worker itself', async () => {
    await as(alice).put('/api/server', { open: true });
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    // Bob's other tab holds the freeze.
    expect((await as(bob).post(`/api/ws/${wsId}/transfer/begin`, { sid: 'other-tab-0001' })).ok).toBe(true);
    const made = [];
    globalThis.puter = { workers: { exec: async (url, init) => {
      made.push(`${init?.method || 'GET'} ${new URL(url).pathname}`);
      return rt.dispatch(url, init, bob);
    } } };
    const out = await settle(transferWorkspace(`${wsId}@teamchat-x`, 'https://teamchat-x.puter.work', { copy: null }, { profile: { name: 'Bob' } }));
    expect(out.ok).toBe(false);
    expect(out.e.code).toBe('transferring');
    expect(made.some((x) => x.endsWith('/export'))).toBe(false);
    expect(made.some((x) => x.endsWith('/transfer/cancel'))).toBe(false);
    expect((await rt.kv.get(KEYS.ws(wsId))).transferring.sid).toBe('other-tab-0001');
    // That tab gone quiet for half an hour, this one's next try takes the move over and completes it.
    await rt.kv.update(KEYS.ws(wsId), { 'transferring.at': Date.now() - 31 * 60_000 });
    const moved = await transferWorkspace(`${wsId}@teamchat-x`, 'https://teamchat-x.puter.work', { copy: null }, { profile: { name: 'Bob' } });
    expect(moved.mine).toBe(true);
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe(moved.ref);
  });
});

describe('a scheduled message that was not sent, carried by an export', () => {
  const MIN = 60_000;
  const due = async (wsId, id) => {
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
  };

  /** Bob's message refused at its time (the channel archived), marked, and the channel then opened again. */
  async function notSent() {
    const { wsId } = await workspaceWith(alice, [bob]);
    const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'temp' })).data.channel.id;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${ch}/join`)).ok).toBe(true);
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ch, text: 'the words', dueAt: Date.now() + 5 * MIN })).data.scheduled.id;
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: true })).ok).toBe(true);
    await due(wsId, id);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const marked = (await rt.kv.get(KEYS.sched(wsId))).m[id];
    expect(marked.failed).toMatchObject({ code: 'archived', message: 'This channel is archived' });
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${ch}`, { archived: false })).ok).toBe(true);
    return { wsId, ch, id, marked };
  }

  it('arrives on the copy still marked, listed to its author as not sent, and is not sent by the copy\'s first poll', async () => {
    const { wsId, id, marked } = await notSent();
    const page = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect(page.header.sched.map((e) => [e.id, e.failed?.code])).toEqual([[id, 'archived']]);
    const newId = (await as(alice).post('/api/workspaces/import', { header: page.header })).data.workspace.id;
    const copy = (await rt.kv.get(KEYS.sched(newId))).m[id];
    expect(copy.failed).toEqual(marked.failed);
    expect(copy.text).toBe('the words');
    // Nothing is due for the poll: the message is its author's to send.
    expect((await rt.kv.get(KEYS.activity(newId))).nd).toBeUndefined();
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const list = (await as(bob).get(`/api/ws/${newId}/scheduled`)).data.scheduled;
    expect(list.map((s) => [s.id, s.failed?.code])).toEqual([[id, 'archived']]);
    // A poll made to look leaves it, with the channel open again on the copy as on the original.
    await rt.kv.update(KEYS.activity(newId), { nd: Date.now() - 1 });
    expect((await as(alice).get(`/api/ws/${newId}/sync?since=0`)).ok).toBe(true);
    const temp = Object.values((await as(alice).get(`/api/ws/${newId}`)).data.workspace.channels).find((c) => c.name === 'temp');
    const texts = (await as(alice).get(`/api/ws/${newId}/conv/${temp.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts).not.toContain('the words');
    expect((await rt.kv.get(KEYS.sched(newId))).m[id].failed.code).toBe('archived');
  });

  it('is due on the copy once its author has moved it, as on the original, and a message that was waiting is due as before', async () => {
    const { wsId, ch, id } = await notSent();
    const at = Date.now() + 5 * MIN;
    const waiting = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: ch, text: 'still to come', dueAt: at })).data.scheduled.id;
    const page = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    const newId = (await as(alice).post('/api/workspaces/import', { header: page.header })).data.workspace.id;
    expect((await rt.kv.get(KEYS.sched(newId))).m[waiting].failed).toBeUndefined();
    expect((await rt.kv.get(KEYS.activity(newId))).nd).toBe(at);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const later = Date.now() + 10 * MIN;
    expect((await as(bob).put(`/api/ws/${newId}/scheduled/${id}`, { dueAt: later })).ok).toBe(true);
    const e = (await rt.kv.get(KEYS.sched(newId))).m[id];
    expect(e.failed).toBeUndefined();
    expect(e.dueAt).toBe(later);
  });
});

describe('a token rotated in the same moment it was revoked', () => {
  const BASE = 'https://teamchat-api.test';
  const post = (path, body) => rt.dispatch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, null);

  /** Rotate, then revoke, then let the rotation's write land after the revocation's deletion, as the race leaves it: a record of the hash alone. */
  async function leftover(wsId, kind, id) {
    const rotated = await as(alice).post(`/api/ws/${wsId}/${kind}/${id}/rotate`);
    expect(rotated.ok).toBe(true);
    const key = kind === 'webhooks' ? KEYS.hook(id) : KEYS.bot(id);
    const { hash } = await rt.kv.get(key);
    expect((await as(alice).del(`/api/ws/${wsId}/${kind}/${id}`)).ok).toBe(true);
    expect(await rt.kv.get(key)).toBeFalsy();
    await rt.kv.update(key, { hash });
    expect(Object.keys(await rt.kv.get(key))).toEqual(['hash']);
    return rotated.data.token;
  }

  it('is invalid, for a webhook as for a bot, rather than "the channel is gone" or a server error', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'Deploys' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Bot', scopes: ['post', 'read', 'react'], channels: [general.id] })).data;
    const hookToken = await leftover(wsId, 'webhooks', hook.id);
    const botToken = await leftover(wsId, 'bots', bot.id);
    const viaHook = await post(`/webhook/${hookToken}`, { text: 'after the revocation' });
    expect(viaHook.status).toBe(401);
    expect((await viaHook.json()).code).toBe('unauthorized');
    const viaBot = await post(`/bot/${botToken}/channels/${general.id}/messages`, { text: 'after the revocation' });
    expect(viaBot.status).toBe(401);
    expect((await viaBot.json()).code).toBe('unauthorized');
    const read = await rt.dispatch(`${BASE}/bot/${botToken}/channels/${general.id}/messages`, { method: 'GET' }, null);
    expect(read.status).toBe(401);
    const react = await post(`/bot/${botToken}/channels/${general.id}/messages/1/reactions`, { reaction: 'thumbsup' });
    expect(react.status).toBe(401);
    // Nothing was posted under either.
    const texts = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.map((m) => m.text);
    expect(texts).not.toContain('after the revocation');
    // A token whose record stands is taken as before.
    const live = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'Alerts' })).data;
    expect((await post(`/webhook/${live.token}`, { text: 'still here' })).status).toBe(200);
  });
});

describe('importing a messages.json whose pages are damaged', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const HEADER = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { c1: { name: 'general', def: true } }, members: {}, memberDocs: {} };
  function server() {
    const made = [];
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      made.push(`${init.method || 'GET'} ${path}`);
      if (path === '/api/workspaces/import') return json({ workspace: { id: 'copy0000001', name: 'Acme' } });
      if (path === '/api/ws/copy0000001/import') return json({ ok: true, conv: 'c1', count: 1 });
      if (path === '/api/ws/copy0000001/import/finish') return json({ ok: true });
      if ((init.method || 'GET') === 'DELETE') return json({ ok: true });
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    return made;
  }

  it('stops with a plain word before anything is made, where it used to make the workspace, fail in the middle and take it down', async () => {
    const damaged = [
      { header: HEADER },
      { header: HEADER, pages: null },
      { header: HEADER, pages: { c1: [] } },
      { header: HEADER, pages: [{ conv: 'c1', seq: 1 }] },
      { header: HEADER, pages: [{ conv: 'c1', seq: 1, messages: 'gone' }] },
      { header: HEADER, pages: [null] },
      { header: HEADER, pages: [], files: 'none' },
    ];
    for (const archive of damaged) {
      const made = server();
      const out = await importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Bob' } }).then(() => null, (e) => e);
      expect(out, JSON.stringify(archive)).toBeInstanceOf(Error);
      expect(out.message).toMatch(/^this messages\.json is damaged/);
      expect(made, JSON.stringify(archive)).toEqual([]);
    }
    // A sound archive still goes in whole: created, its page written, opened.
    const made = server();
    const ref = await importArchive('https://teamchat-new.puter.work', { header: HEADER, pages: [{ conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'hi', ts: 1 }] }], files: [] }, { profile: { name: 'Bob' } });
    expect(ref).toBe('copy0000001@teamchat-new');
    expect(made).toEqual(['POST /api/workspaces/import', 'POST /api/ws/copy0000001/import', 'POST /api/ws/copy0000001/import/finish']);
  });
});

describe('the pins an import brings across', () => {
  it('are counted for the header and the details pane, as the pin route counts them', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const one = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'first' })).data.message.seq;
    const two = (await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'second' })).data.message.seq;
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: one })).ok).toBe(true);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/pins`, { seq: two })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(wsId))).c[general.id].pc).toBe(2);
    const page = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect(page.header.pins[general.id]).toHaveLength(2);
    const newId = (await as(alice).post('/api/workspaces/import', { header: page.header })).data.workspace.id;
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    const gen = Object.values(copy.channels).find((c) => c.name === 'general');
    expect(gen.id).not.toBe(general.id); // the original's channel is in use on this server, so the copy's got a fresh id
    // The count the header's pin bar and the details pane draw from (the client hides both at nothing).
    expect((await rt.kv.get(KEYS.activity(newId))).c[gen.id]?.pc).toBe(2);
    for (const p of page.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: p.conv, seq: p.seq, messages: p.messages })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const pins = (await as(alice).get(`/api/ws/${newId}/conv/${gen.id}/pins`)).data.pins;
    expect(pins.map((p) => p.message?.text).sort()).toEqual(['first', 'second']);
    // Unpinning one on the copy counts down from two, not from a count that was never there.
    expect((await as(alice).del(`/api/ws/${newId}/conv/${gen.id}/pins/${one}`)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.activity(newId))).c[gen.id].pc).toBe(1);
  });
});

describe('a workspace restored from its export after being deleted, on the same server', () => {
  async function upload(u, wsId, name = 'a.txt') {
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), name);
    const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
    expect(r.ok).toBe(true);
    return r.data.id;
  }
  const there = (wsId, id) => rt.fs._files.has(`teamchat-files/${wsId}/${id}`);
  const sendBytes = async (wsId, file, bytes, name = 'plan.txt') => {
    const fd = new FormData();
    fd.append('file', bytes, name);
    fd.append('id', file);
    fd.append('name', name);
    return as(alice).post(`/api/ws/${wsId}/import/file`, fd);
  };

  /** Alice's workspace with one file in one message, exported whole, then deleted; returns what a restore needs. */
  async function exportedAndDeleted() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(bob, wsId, 'plan.txt');
    const sent = await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'the plan', attachments: [{ id: file }] });
    expect(sent.ok).toBe(true);
    expect((await rt.kv.get(KEYS.file(file))).refs).toBe(1);
    const page = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect(page.done).toBe(true);
    const bytes = await (await rt.dispatch(`https://teamchat-api.test/api/ws/${wsId}/files/${file}`, { method: 'GET' }, alice)).blob();
    const record = await rt.kv.get(KEYS.file(file));
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    // The deletion takes the file's record with the bytes now (see DELETE
    // /api/ws/:ws); one it could not reach stays (a file named only in a
    // stretch of history past the blocks one deletion reads, an upload that
    // never reached a message), and a restore under the same id must still
    // tell such a record from its own: the record is put back here as one such.
    expect(await rt.kv.get(KEYS.file(file))).toBeFalsy();
    await rt.kv.set(KEYS.file(file), record);
    expect(there(wsId, file)).toBe(false);
    return { wsId, general, file, page, bytes };
  }

  const pagesInto = async (newId, page) => {
    for (const p of page.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: p.conv, seq: p.seq, messages: p.messages })).ok).toBe(true);
  };

  it('counts its files by the messages restored, so the last message\'s deletion lets the bytes go', async () => {
    const { wsId, general, file, page, bytes } = await exportedAndDeleted();
    const newId = (await as(alice).post('/api/workspaces/import', { header: page.header })).data.workspace.id;
    expect(newId).toBe(wsId); // the id was free again, and old permalinks keep their shape
    await pagesInto(newId, page);
    expect((await sendBytes(newId, file, bytes)).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const meta = await rt.kv.get(KEYS.file(file));
    expect(meta.refs).toBe(1);
    expect(meta.cs).toEqual({ [general.id]: 1 });
    expect(there(newId, file)).toBe(true);
    const msgs = (await as(alice).get(`/api/ws/${newId}/conv/${general.id}/messages`)).data.messages;
    const m = msgs.find((x) => x.text === 'the plan');
    expect(m.attachments.map((a) => a.id)).toEqual([file]);
    expect((await as(alice).del(`/api/ws/${newId}/conv/${general.id}/messages/${m.seq}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(file))).toBeFalsy();
    expect(there(newId, file)).toBe(false);
  });

  it('tells the deleted copy\'s records from this import\'s by the import they name, not by the clock, so a machine whose clock runs behind the one that made the workspace loses no count', async () => {
    const { wsId, general, file, page, bytes } = await exportedAndDeleted();
    const newId = (await as(alice).post('/api/workspaces/import', { header: page.header })).data.workspace.id;
    expect(newId).toBe(wsId);
    // The workspace was made on a machine whose clock stands five seconds ahead of the ones taking the pages and the bytes.
    const ahead = Date.now() + 5000;
    await rt.kv.update(KEYS.ws(newId), { importedAt: ahead });
    // The app's order, then the same file's bytes once more (a retry): the
    // second sending found a record of the import's own that the clock
    // called older than the workspace, and counted the file from nothing.
    await pagesInto(newId, page);
    expect((await sendBytes(newId, file, bytes)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file(file))).imp).toBe(ahead);
    expect((await sendBytes(newId, file, bytes)).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const meta = await rt.kv.get(KEYS.file(file));
    expect(meta.refs).toBe(1);
    expect(meta.cs).toEqual({ [general.id]: 1 });
    // And the deleted copy's record, however young, is still told apart: one written a moment ago by a plain upload names no import.
    const other = await workspaceWith(alice, [bob], 'Globex');
    const young = await upload(bob, other.wsId, 'young.txt');
    await as(bob).post(`/api/ws/${other.wsId}/conv/${other.general.id}/messages`, { text: 'young', attachments: [{ id: young }] });
    const exported = (await as(alice).get(`/api/ws/${other.wsId}/export`)).data;
    expect((await as(alice).del(`/api/ws/${other.wsId}`)).ok).toBe(true);
    const restored = (await as(alice).post('/api/workspaces/import', { header: exported.header })).data.workspace.id;
    expect(restored).toBe(other.wsId);
    for (const p of exported.pages) expect((await as(alice).post(`/api/ws/${restored}/import`, { conv: p.conv, seq: p.seq, messages: p.messages })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file(young))).refs).toBe(1);
  });

  it('counts the same when the bytes arrive before the pages, and a file sent twice in one import is still counted once per message', async () => {
    const { wsId, general, file, page, bytes } = await exportedAndDeleted();
    const newId = (await as(alice).post('/api/workspaces/import', { header: page.header })).data.workspace.id;
    expect(newId).toBe(wsId);
    expect((await sendBytes(newId, file, bytes)).ok).toBe(true);
    await pagesInto(newId, page);
    expect((await sendBytes(newId, file, bytes)).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const meta = await rt.kv.get(KEYS.file(file));
    expect(meta.refs).toBe(1);
    expect(meta.cs).toEqual({ [general.id]: 1 });
    expect(there(newId, file)).toBe(true);
  });
});
