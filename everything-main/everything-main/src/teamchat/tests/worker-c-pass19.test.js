/**
 * Nineteenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { LIMITS } from '../src/shared/limits.js';
import { sha256 } from '../worker/lib.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('the importer’s own account record after an import', () => {
  it('lists the new workspace once, as every other member’s does, so it counts once toward the twenty one may be in and this server names it once', async () => {
    // Alice already has a workspace here, so her record exists before the import (as an owner's does when they move or restore one).
    const { wsId } = await workspaceWith(alice, [bob]);
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Restored' },
      channels: { general001: { id: 'general001', name: 'general', def: true } },
      members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
      memberDocs: { [alice.uuid]: { channels: ['general001'] }, [bob.uuid]: { channels: ['general001'] } },
    };
    const res = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
    expect(res.status).toBe(200);
    const copy = res.data.workspace.id;
    expect((await rt.kv.get(KEYS.user(alice.uuid))).workspaces).toEqual([wsId, copy]);
    expect((await rt.kv.get(KEYS.user(bob.uuid))).workspaces).toEqual([wsId, copy]);
    await as(alice).post(`/api/ws/${copy}/import/finish`);
    // What this server answers as the workspaces she is in: each once.
    const me = (await as(alice).get('/api/me')).data;
    expect(me.workspaces.map((w) => w.id)).toEqual([wsId, copy]);
    // Restoring more archives counts each once toward the twenty: eighteen more imports of the same archive under new ids
    // leave room for exactly one workspace, not none (twenty in all).
    for (let i = 0; i < 17; i++) {
      const again = await as(alice).post('/api/workspaces/import', { header: { ...header, workspace: { id: `restore${String(i).padStart(3, '0')}`, name: `R${i}` } }, profile: { name: 'Alice' } });
      expect(again.status).toBe(200);
    }
    // Nineteen workspaces now: one more is allowed, the one after it is not.
    expect((await rt.kv.get(KEYS.user(alice.uuid))).workspaces).toHaveLength(19);
    const twentieth = await as(alice).post('/api/workspaces', { name: 'Twentieth' });
    expect(twentieth.status).toBe(200);
    const over = await as(alice).post('/api/workspaces', { name: 'One too many' });
    expect([over.status, over.data.code]).toEqual([400, 'limit']);
  });
});

describe('a channel bookmark in an archive whose address the channel route would refuse', () => {
  it('is left out of the copy rather than brought across cut short or with a mark that turns the address around', async () => {
    const long = `https://docs.example.com/${'a'.repeat(600)}`;
    const RLO = String.fromCharCode(0x202e); // right-to-left override
    const ZW = String.fromCharCode(0x200b); // zero-width space
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1237', name: 'Acme' },
      channels: {
        general001: {
          id: 'general001', name: 'general', def: true,
          bookmarks: [
            { id: 'bm000001', label: 'Docs', url: 'https://docs.example.com/handbook' },
            { id: 'bm000002', label: 'Too long', url: long },
            { id: 'bm000003', label: 'Turned', url: `https://docs.example.com/${RLO}evil` },
            { id: 'bm000004', label: 'Zero width', url: `https://docs.example.com/a${ZW}b` },
            { id: 'bm000005', label: 'Trimmed', url: '  https://docs.example.com/spaced  ' },
            { id: 'bm000006', label: 'Not a link', url: 'javascript:alert(1)' },
          ],
        },
      },
      members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: ['general001'] } },
    };
    const res = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
    expect(res.status).toBe(200);
    const ws = await rt.kv.get(KEYS.ws(res.data.workspace.id));
    expect(ws.channels.general001.bookmarks).toEqual([
      { id: 'bm000001', label: 'Docs', url: 'https://docs.example.com/handbook' },
      { id: 'bm000005', label: 'Trimmed', url: 'https://docs.example.com/spaced' },
    ]);
    // The same address is refused by the channel route, so the copy holds nothing the original could not.
    await as(alice).post(`/api/ws/${res.data.workspace.id}/import/finish`);
    for (const url of [long, `https://docs.example.com/${RLO}evil`]) {
      const put = await as(alice).put(`/api/ws/${res.data.workspace.id}/channels/general001`, { bookmarks: [{ label: 'x', url }] });
      expect([put.status, put.data.code]).toEqual([400, 'invalid']);
    }
  });
});

describe('a refusal the server answers after a long upload', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });

  it('is read in the worker’s own words, its small body given the plain time, rather than cut off as "Request failed (413)"', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { api, ApiError, timeoutFor } = await import('../src/lib/api.js');
    const file = new File([new Uint8Array(1000)], 'big.bin', { type: 'application/octet-stream' });
    const form = new FormData();
    form.append('file', file, file.name);
    const budget = timeoutFor(form);
    globalThis.puter = { workers: { exec: async (url, init) => {
      // The upload takes all but the last moment of its budget, and the
      // refusal's few bytes arrive a moment after that.
      await new Promise((r) => setTimeout(r, budget - 50));
      const body = new ReadableStream({
        start(c) {
          const t = setTimeout(() => {
            c.enqueue(new TextEncoder().encode(JSON.stringify({ error: 'too_large', code: 'too_large', message: 'Files can be up to 10 MB' })));
            c.close();
          }, 200);
          // A real fetch's body dies with the request when the controller aborts.
          init.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            try { c.error(init.signal.reason); } catch { /* already closed */ }
          });
        },
      });
      return new Response(body, { status: 413, headers: { 'content-type': 'application/json' } });
    } } };
    const p = api.upload('abcdef1234@teamchat-x', file);
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(budget - 50);
    await vi.advanceTimersByTimeAsync(300);
    const e = await p.catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.code, e.message]).toEqual([413, 'too_large', 'Files can be up to 10 MB']);
  });
});

describe('a webhook payload whose text stands beside blocks or attachments', () => {
  it('posts the blocks as the message (the text being the notification fallback) and the attachments under the message, rather than the summary line alone', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const post = async (body) => { const r = await as(null).post(`/webhook/${hook.token}`, body); return [r.status, r.data.text ?? r.data.code]; };
    // The shape a deploy tool sends: a one-line summary for notifications, the notice itself in blocks.
    expect(await post({ text: 'Deploy finished', blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*Deploy* of `api` finished &amp; verified' } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'by <https://ci.example.com/u/alice|alice>' }] },
    ] })).toEqual([200, '*Deploy* of `api` finished & verified\nby alice (https://ci.example.com/u/alice)']);
    // Text with attachments: the text is shown and the attachments under it, so both post, the text first.
    expect(await post({ text: 'Build 42', attachments: [{ color: '#36a64f', title: 'Passed', text: 'All 120 tests green', fields: [{ title: 'Branch', value: 'main', short: true }] }] }))
      .toEqual([200, 'Build 42\nPassed\nAll 120 tests green\nBranch: main']);
    // All three: the blocks lead, the attachments follow, the text stands aside.
    expect(await post({ text: 'summary', blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Release 1.2' } }], attachments: [{ text: 'notes' }] })).toEqual([200, 'Release 1.2\nnotes']);
    // Blocks that say nothing leave the text to stand in; a text that says nothing leaves the blocks, as before.
    expect(await post({ text: 'only the words', blocks: [{ type: 'divider' }, { type: 'image', image_url: 'https://x.io/a.png', alt_text: 'a' }] })).toEqual([200, 'only the words']);
    expect(await post({ text: '  ', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'from blocks' } }] })).toEqual([200, 'from blocks']);
    // Our own shape, and attachments with nothing to say beside a text, post as they did.
    expect(await post({ text: 'plain **bold**' })).toEqual([200, 'plain **bold**']);
    expect(await post({ text: 'hi', attachments: [{ color: '#36a64f' }] })).toEqual([200, 'hi']);
    expect(await post({ text: '', blocks: [{ type: 'divider' }], attachments: [{ color: 'good' }] })).toEqual([400, 'invalid']);
    // A bot token reads a payload the same way.
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Robo', channels: [general.id], scopes: ['post'] })).data;
    const viaBot = await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages`, { text: 'fallback', blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'the notice' } }] });
    expect([viaBot.status, viaBot.data.text]).toEqual([200, 'the notice']);
    // What is stored is what was answered.
    const msgs = (await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages;
    expect(msgs.at(-1)).toMatchObject({ text: 'the notice', bot: { name: 'Robo' } });
  });
});

describe('two links to one page at different places in it', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('share one preview: the page is fetched and remembered once, each card keeping the link its message carries', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const asked = [];
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      const u = new URL(url);
      if (u.pathname === '/gone') return new Response('no', { status: 404, headers: { 'Content-Type': 'text/html' } });
      return new Response('<html><head><title>The handbook</title><meta property="og:description" content="All of it"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    };
    const card = async (user, text) => {
      const m = (await as(user).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text })).data.message;
      return (await as(user).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl;
    };
    const first = await card(alice, 'see https://docs.example.com/handbook#hiring');
    const second = await card(bob, 'and https://docs.example.com/handbook#expenses');
    const bare = await card(alice, 'or https://docs.example.com/handbook');
    expect(asked).toEqual(['https://docs.example.com/handbook']);
    expect(first).toMatchObject({ url: 'https://docs.example.com/handbook#hiring', title: 'The handbook', desc: 'All of it' });
    expect(second).toMatchObject({ url: 'https://docs.example.com/handbook#expenses', title: 'The handbook' });
    expect(bare).toMatchObject({ url: 'https://docs.example.com/handbook', title: 'The handbook' });
    // Remembered under the page's address alone.
    expect(await rt.kv.get(KEYS.unfurl(await sha256('https://docs.example.com/handbook')))).toMatchObject({ title: 'The handbook' });
    expect(await rt.kv.get(KEYS.unfurl(await sha256('https://docs.example.com/handbook#hiring')))).toBeFalsy();
    // A page found to have no preview is not asked for again under another place in it.
    expect(await card(alice, 'dead https://docs.example.com/gone#a')).toBeNull();
    expect(await card(bob, 'dead https://docs.example.com/gone#b')).toBeNull();
    expect(asked.filter((u) => u.endsWith('/gone'))).toHaveLength(1);
    // A different query is a different page, as before.
    await card(alice, 'see https://docs.example.com/handbook?v=2#hiring');
    expect(asked.at(-1)).toBe('https://docs.example.com/handbook?v=2');
  });
});

describe('a file shared nowhere a guest can read', () => {
  const upload = async (user, wsId, name, bytes = 'x') => {
    const form = new FormData();
    form.append('file', new File([bytes], name, { type: 'text/plain' }), name);
    return (await as(user).post(`/api/ws/${wsId}/files`, form)).data;
  };

  it('is its uploader’s alone until it is attached or bookmarked where the guest is; what is shared where they read, and a record from before files were counted, stay theirs to take', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'priv', private: true })).data.channel;
    const invite = (await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, {})).data;
    await as(carol).post('/api/join', { code: invite.code, profile: { name: 'Carol' } });
    const status = async (user, id) => (await as(user).get(`/api/ws/${wsId}/files/${id}`)).status;
    const answers = async (id) => [await status(alice, id), await status(bob, id), await status(carol, id)];
    // Uploaded and not yet attached: the uploader's and every member's, no guest's.
    const fresh = await upload(alice, wsId, 'fresh.txt');
    expect(await answers(fresh.id)).toEqual([200, 200, 404]);
    // Waiting with a scheduled message: the same, until it is sent.
    const later = await upload(alice, wsId, 'later.txt');
    expect((await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: priv.id, text: 'soon', attachments: [{ id: later.id }], dueAt: Date.now() + 3600_000 })).status).toBe(200);
    expect(await answers(later.id)).toEqual([200, 200, 404]);
    // Attached where the guest reads: theirs. Attached where they do not: not.
    const inPriv = await upload(alice, wsId, 'priv.txt');
    await as(alice).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'here', attachments: [{ id: inPriv.id }] });
    expect(await answers(inPriv.id)).toEqual([200, 200, 200]);
    const inGeneral = await upload(alice, wsId, 'gen.txt');
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'there', attachments: [{ id: inGeneral.id }] });
    expect(await answers(inGeneral.id)).toEqual([200, 200, 404]);
    // Bookmarked, never attached: theirs in a channel of theirs, not in one they are not in.
    const markedPriv = await upload(alice, wsId, 'mark-priv.txt');
    const markedGeneral = await upload(alice, wsId, 'mark-gen.txt');
    await as(alice).put(`/api/ws/${wsId}/channels/${priv.id}`, { bookmarks: [{ label: 'Priv', file: markedPriv.id, name: 'mark-priv.txt' }] });
    await as(alice).put(`/api/ws/${wsId}/channels/${general.id}`, { bookmarks: [{ label: 'Gen', file: markedGeneral.id, name: 'mark-gen.txt' }] });
    expect(await rt.kv.get(KEYS.file(markedPriv.id))).toMatchObject({ refs: 0 });
    expect(await answers(markedPriv.id)).toEqual([200, 200, 200]);
    expect(await answers(markedGeneral.id)).toEqual([200, 200, 404]);
    // A bookmark's hold outlives the message that shared the file: still the guest's, in that channel.
    const held = await upload(alice, wsId, 'held.txt');
    const hm = (await as(alice).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'hold', attachments: [{ id: held.id }] })).data.message;
    await as(alice).put(`/api/ws/${wsId}/channels/${priv.id}`, { bookmarks: [{ label: 'Priv', file: markedPriv.id, name: 'mark-priv.txt' }, { label: 'Held', file: held.id, name: 'held.txt' }] });
    await as(alice).del(`/api/ws/${wsId}/conv/${priv.id}/messages/${hm.seq}`);
    expect(await rt.kv.get(KEYS.file(held.id))).toMatchObject({ refs: 0, cs: { [priv.id]: 0 } });
    expect(await answers(held.id)).toEqual([200, 200, 200]);
    // The guest's own upload is theirs wherever it is (or is not) shared.
    const own = await upload(carol, wsId, 'mine.txt');
    expect(await status(carol, own.id)).toBe(200);
    // A record from before files were counted (no count, no sharing record) is open, as it was.
    await rt.kv.set(KEYS.file('legacyfile000001'), { ws: wsId, u: alice.uuid, name: 'old.txt', size: 1, type: 'text/plain', ts: 1 });
    await rt.fs.write(`teamchat-files/${wsId}/legacyfile000001`, new Blob(['old']), { createMissingParents: true });
    expect(await answers('legacyfile000001')).toEqual([200, 200, 200]);
    // Attaching follows the same rule: a guest cannot share a member's unattached file into a conversation by its id.
    const smuggle = await as(carol).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: '', attachments: [{ id: fresh.id }] });
    expect([smuggle.status, smuggle.data.code]).toEqual([400, 'invalid']);
    const withWords = await as(carol).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'see', attachments: [{ id: fresh.id }, { id: inPriv.id }] });
    expect(withWords.data.message.attachments.map((f) => f.id)).toEqual([inPriv.id]);
  });
});

describe('a token past its sixty calls a minute', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is told when to try again in a Retry-After header beside the words, and the minute runs from its first call', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { wsId, general } = await workspaceWith(alice);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'CI' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Robo', channels: [general.id], scopes: ['read'] })).data;
    const raw = (path, body) => rt.dispatch(`https://teamchat-api.test${path}`, body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, null);
    for (let i = 0; i < LIMITS.hookRatePerMinute; i++) expect((await raw(`/webhook/${hook.token}`, { text: `n${i}` })).status).toBe(200);
    vi.setSystemTime(Date.now() + 30_000);
    const over = await raw(`/webhook/${hook.token}`, { text: 'one more' });
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).toBe('60');
    expect(await over.json()).toMatchObject({ code: 'rate_limited', message: 'This token may make 60 calls a minute; try again shortly' });
    // A bot token's reads count against a minute of its own, begun with its first call, the same way.
    for (let i = 0; i < LIMITS.hookRatePerMinute; i++) expect((await raw(`/bot/${bot.token}/channels/${general.id}/messages`)).status).toBe(200);
    const overBot = await raw(`/bot/${bot.token}/channels/${general.id}/messages`);
    expect([overBot.status, overBot.headers.get('retry-after')]).toEqual([429, '60']);
    // The minute runs from the first call: past the webhook's, the webhook is answered again and a fresh minute begins, while the bot's minute, begun thirty seconds later, still runs.
    vi.setSystemTime(Date.now() + 31_000);
    expect((await raw(`/webhook/${hook.token}`, { text: 'again' })).status).toBe(200);
    expect((await raw(`/bot/${bot.token}/channels/${general.id}/messages`)).status).toBe(429);
    vi.setSystemTime(Date.now() + 30_000);
    expect((await raw(`/bot/${bot.token}/channels/${general.id}/messages`)).status).toBe(200);
    // Every other refusal carries no such header.
    const plain = await rt.dispatch(`https://teamchat-api.test/webhook/${hook.token}`, { method: 'GET' }, null);
    expect([plain.status, plain.headers.get('retry-after')]).toEqual([405, null]);
  });
});

describe('telling which of an archive’s channel ids are in use here', () => {
  it('reads them together rather than two at a time per channel, and still gives a channel whose id is taken a fresh one while the rest keep theirs', async () => {
    const channels = {};
    for (let i = 0; i < 40; i++) {
      const id = `arch${String(i).padStart(6, '0')}`;
      channels[id] = { id, name: `c${i}`, def: i === 0 };
    }
    // Three of the ids already hold a conversation on this server (another workspace's, or a copy's original).
    const taken = ['arch000003', 'arch000017', 'arch000039'];
    await rt.kv.set(KEYS.seq(taken[0]), 5);
    await rt.kv.set(KEYS.block(taken[1], 0), { m: [{ s: 1, u: bob.uuid, t: 'x', ts: 1 }], x: {} });
    await rt.kv.set(KEYS.seq(taken[2]), 0); // a counter at nothing is still a conversation's
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1240', name: 'Many' }, channels,
      members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: Object.keys(channels), reads: { arch000003: 4, arch000017: 1 } } },
    };
    const get = rt.kv.get.bind(rt.kv);
    // How many of the conversation counters were read at once: the keys one
    // batched read carries, or the reads in flight together on a store that
    // takes one key at a time.
    let inflight = 0;
    let peak = 0;
    rt.kv.get = async (key, ...rest) => {
      const convs = (Array.isArray(key) ? key : [key]).filter((k) => String(k).startsWith('tc:conv:')).length;
      if (convs) {
        inflight += convs;
        peak = Math.max(peak, inflight);
      }
      try {
        return await get(key, ...rest);
      } finally {
        inflight -= convs;
      }
    };
    let copy;
    try {
      const res = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
      expect(res.status).toBe(200);
      copy = res.data.workspace.id;
    } finally {
      rt.kv.get = get;
    }
    expect(peak).toBeGreaterThanOrEqual(12);
    const ws = await rt.kv.get(KEYS.ws(copy));
    const ids = Object.keys(ws.channels);
    expect(ids).toHaveLength(40);
    for (const t of taken) expect(ids).not.toContain(t);
    expect(ids.filter((id) => id.startsWith('arch'))).toHaveLength(37);
    expect(Object.keys(ws.importMap).sort()).toEqual(taken.sort());
    for (const t of taken) expect(ws.channels[ws.importMap[t]]).toMatchObject({ id: ws.importMap[t], name: channels[t].name });
    // The owner's document follows the new ids, cursors included.
    const doc = await rt.kv.get(KEYS.member(copy, alice.uuid));
    expect(doc.channels).toHaveLength(40);
    expect(doc.reads[ws.importMap.arch000003]).toBe(4);
    expect(doc.reads[ws.importMap.arch000017]).toBe(1);
    // The conversations that were in use are untouched.
    expect(await rt.kv.get(KEYS.seq(taken[0]))).toBe(5);
  });
});

describe('creating the copy of a large workspace from its archive', () => {
  it('writes the members’ documents, their account records and the pinned lists a dozen at a time rather than one after another, and all of them', async () => {
    // Forty members with accounts here (so each has a record to file the workspace on), two direct messages among them, and pins in every channel.
    const people = Array.from({ length: 40 }, (_, i) => `u-many-${String(i).padStart(4, '0')}`);
    for (const u of people) await rt.kv.set(KEYS.user(u), { uuid: u, username: `m${u.slice(-4)}`, name: `M ${u.slice(-4)}`, title: '', color: 1, workspaces: ['elsewhere01'], createdAt: 1 });
    const channels = {};
    const pins = {};
    for (let i = 0; i < 30; i++) {
      const id = `chan${String(i).padStart(6, '0')}`;
      channels[id] = { id, name: `c${i}`, def: i === 0 };
      pins[id] = [{ seq: 1, by: people[0], ts: 1 }];
    }
    const members = Object.fromEntries(people.map((u, i) => [u, { username: `m${u.slice(-4)}`, name: `M ${i}`, role: 'member' }]));
    const dm = { members: [people[0], people[1]], createdAt: 1 };
    const memberDocs = Object.fromEntries(people.map((u, i) => [u, { channels: Object.keys(channels), dms: i < 2 ? { dm_oldold: dm } : {}, reads: { chan000000: 1, dm_oldold: 1 } }]));
    const header = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1235', name: 'Big' }, channels, members, memberDocs, pins };
    // How many writes the store sees at once: one at a time was the whole of the create step's cost, a round trip per document.
    const set = rt.kv.set.bind(rt.kv);
    const add = rt.kv.add.bind(rt.kv);
    let inflight = 0;
    let peakSet = 0;
    let peakAdd = 0;
    const gauge = (fn, note) => async (...args) => {
      inflight++;
      note(inflight);
      try {
        return await fn(...args);
      } finally {
        inflight--;
      }
    };
    rt.kv.set = gauge(set, (n) => { peakSet = Math.max(peakSet, n); });
    rt.kv.add = gauge(add, (n) => { peakAdd = Math.max(peakAdd, n); });
    let copy;
    try {
      const res = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'Alice' } });
      expect(res.status).toBe(200);
      copy = res.data.workspace.id;
    } finally {
      rt.kv.set = set;
      rt.kv.add = add;
    }
    expect(peakSet).toBeGreaterThanOrEqual(12);
    expect(peakAdd).toBeGreaterThanOrEqual(12);
    // Every document all the same, in the order the archive gave them, the direct message under one id for both of its people.
    const docs = await Promise.all(people.map((u) => rt.kv.get(KEYS.member(copy, u))));
    expect(docs.every((d) => d && d.channels.length === 30 && d.reads.chan000000 === 1)).toBe(true);
    const [first, second] = docs;
    const dmId = Object.keys(first.dms)[0];
    expect(dmId).toMatch(/^dm_/);
    expect(Object.keys(second.dms)).toEqual([dmId]);
    expect(first.reads[dmId]).toBe(1);
    expect(docs[2].dms).toEqual({});
    expect(docs[2].reads[dmId]).toBe(1); // a read of it travels under the new id whoever holds it
    // Each account record names the copy once; the importer's too.
    for (const u of people) expect((await rt.kv.get(KEYS.user(u))).workspaces).toEqual(['elsewhere01', copy]);
    expect((await rt.kv.get(KEYS.user(alice.uuid))).workspaces.filter((w) => w === copy)).toHaveLength(1);
    // Every channel's pinned list and count.
    for (const id of Object.keys(channels)) expect((await rt.kv.get(KEYS.pins(copy, id))).items).toHaveLength(1);
    const act = await rt.kv.get(KEYS.activity(copy));
    expect(Object.keys(act.c).filter((c) => act.c[c].pc === 1)).toHaveLength(30);
  });
});
