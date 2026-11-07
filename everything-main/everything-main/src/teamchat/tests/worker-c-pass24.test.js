/**
 * Twenty-fourth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { domainToUnicode } from 'node:url';
import { api } from '../src/lib/api.js';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, BLOCK_BYTES_HARD, jsonBytes } from '../src/shared/blocks.js';
import { VALUE_BYTES_MAX } from '../dev/worker-runtime.js';
import { parseHead } from '../worker/unfurl.js';
import { parseEmails } from '../src/lib/email.js';
import { exportWorkspace, writeArchiveToDrive, importArchive, transferWorkspace } from '../src/lib/archive.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('a bot token reacting on a message whose block is at the store\'s ceiling', () => {
  it('is refused with a word, as a member is, and may still take its own reaction back', async () => {
    rt = await boot({ strictSize: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'CI', scopes: ['post', 'react'], channels: [general.id] })).data;
    expect(bot.token).toMatch(/^tcb_/);
    // A block of forty-five long messages past the hard budget and just under
    // the store's ceiling, as a channel from before blocks were closed early
    // may hold; the bot already holds one reaction on the third message.
    const big = { m: [], x: {} };
    for (let s = 1; s <= 45; s++) big.m.push({ s, u: alice.uuid, t: 'x'.repeat(9000), ts: Date.now() - 1000 + s });
    big.x.s3 = { r: { thumbsup: { [`bot_${bot.id}`]: 1 } } };
    expect(jsonBytes(big)).toBeGreaterThan(BLOCK_BYTES_HARD);
    expect(JSON.stringify(big).length).toBeLessThan(VALUE_BYTES_MAX);
    await rt.kv.set(KEYS.block(general.id, 0), big);
    await rt.kv.set(KEYS.seq(general.id), 45);
    // A new reaction would grow the block past what the store holds: refused
    // with a word (the member route's), where the store refused it with none
    // and the token was answered a server error.
    const react = await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages/3/reactions`, { reaction: 'heart' });
    expect(react.status).toBe(400);
    expect(react.data.code).toBe('limit');
    expect(react.data.message).toMatch(/cannot take more reactions/);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).x.s3.r.heart).toBeUndefined();
    // Taking a reaction back frees room and still goes (the name comes off; the entry stays with nobody under it, see mergeBlock).
    const off = await as(null).post(`/bot/${bot.token}/channels/${general.id}/messages/3/reactions`, { reaction: 'thumbsup', on: false });
    expect(off.status).toBe(200);
    expect(off.data.on).toBe(false);
    expect(Object.keys((await rt.kv.get(KEYS.block(general.id, 0))).x.s3.r.thumbsup || {})).toEqual([]);
  });
});

describe('an upload', () => {
  /** Every read of the store since, in order: method and key. */
  function reads() {
    const kv = rt.kv;
    const orig = kv.get;
    const log = [];
    kv.get = async (k, ...rest) => {
      log.push(k);
      return orig.call(kv, k, ...rest);
    };
    return { log, restore: () => { kv.get = orig; } };
  }

  it('reads the workspace alone, not the uploader\'s own record, and is judged as before', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'clients', private: true })).data.channel;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, {})).data;
    expect((await as(USERS.carol).post('/api/join', { code: inv.code })).ok).toBe(true); // a guest
    const fd = () => {
      const f = new FormData();
      f.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'spec.pdf', { type: 'application/pdf' }));
      return f;
    };
    const r = reads();
    try {
      const up = await as(bob).post(`/api/ws/${wsId}/files`, fd());
      expect(up.status).toBe(200);
      expect(up.data).toMatchObject({ name: 'spec.pdf', size: 4, type: 'application/pdf' });
      // The workspace, and nothing of the member's own (the budget's counters are moved, not read).
      expect(r.log).toEqual([KEYS.ws(wsId)]);
      expect(await rt.kv.get(KEYS.file(up.data.id))).toMatchObject({ ws: wsId, u: bob.uuid, refs: 0 });
    } finally {
      r.restore();
    }
    // A guest may upload as before; someone outside the workspace may not; a copy that has moved takes none.
    expect((await as(USERS.carol).post(`/api/ws/${wsId}/files`, fd())).status).toBe(200);
    expect((await as(USERS.dave).post(`/api/ws/${wsId}/files`, fd())).status).toBe(403);
    await rt.kv.update(KEYS.ws(wsId), { movedTo: 'zzzzzz@teamchat-elsewhere' });
    expect((await as(bob).post(`/api/ws/${wsId}/files`, fd())).status).toBe(423);
  });
});

describe('the pages of an export after the first, and the steps of an index rebuild after the first', () => {
  /** How many times each key was read since, counting the keys a batched read carries (see getMany). */
  function reads() {
    const kv = rt.kv;
    const orig = kv.get;
    const count = new Map();
    kv.get = async (k, ...rest) => {
      for (const one of Array.isArray(k) ? k : [k]) count.set(one, (count.get(one) || 0) + 1);
      return orig.call(kv, k, ...rest);
    };
    return { of: (k) => count.get(k) || 0, reset: () => count.clear(), restore: () => { kv.get = orig; } };
  }
  /** A workspace whose walk takes several pages: three channels with a message each, and a hundred and thirty direct messages never written in. */
  async function wide() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (const name of ['design', 'ops']) {
      const ch = (await as(alice).post(`/api/ws/${wsId}/channels`, { name })).data.channel;
      expect((await as(alice).post(`/api/ws/${wsId}/conv/${ch.id}/messages`, { text: `in ${name}` })).ok).toBe(true);
    }
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'in general' })).ok).toBe(true);
    const dms = {};
    for (let i = 0; i < 130; i++) dms[`dm_still${String(i).padStart(4, '0')}`] = { members: [alice.uuid, bob.uuid], createdAt: Date.now() };
    await rt.kv.update(KEYS.member(wsId, alice.uuid), { dms });
    return { wsId };
  }

  it('read nothing of the admin\'s own record, which only the first reads, once; the archive and the index are whole', async () => {
    const { wsId } = await wide();
    const mine = KEYS.member(wsId, alice.uuid);
    const r = reads();
    try {
      let res = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
      expect(r.of(mine)).toBe(1);
      r.reset();
      const pages = [...res.pages];
      let more = 0;
      while (!res.done && more++ < 50) {
        res = (await as(alice).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.cursor))}`)).data;
        pages.push(...res.pages);
      }
      expect(more).toBeGreaterThanOrEqual(1);
      expect(r.of(mine)).toBe(0);
      expect(pages.filter((p) => p.messages.length).flatMap((p) => p.messages.filter((m) => m.kind === 'msg').map((m) => m.text)).sort()).toEqual(['in design', 'in general', 'in ops']);
      // A non-admin is refused as before, and a cursor of no shape too.
      expect((await as(bob).get(`/api/ws/${wsId}/export`)).status).toBe(403);
      expect((await as(alice).get(`/api/ws/${wsId}/export?cursor=nonsense`)).status).toBe(400);
      r.reset();
      let step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null })).data;
      expect(r.of(mine)).toBe(1);
      r.reset();
      let steps = 0;
      while (!step.done && steps++ < 50) step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: step.state })).data;
      expect(steps).toBeGreaterThanOrEqual(1);
      expect(r.of(mine)).toBe(0);
      expect(step.progress).toMatchObject({ total: 133, messages: 3 });
      expect((await as(alice).get(`/api/ws/${wsId}/search?q=ops`)).data.results.map((m) => m.text)).toEqual(['in ops']);
      // A non-admin's step is refused before its state is looked at, as before.
      expect((await as(bob).post(`/api/ws/${wsId}/search/reindex`, { state: { convs: 'nonsense' } })).status).toBe(403);
      expect((await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: { convs: ['x'], i: -1, n: 0 } })).status).toBe(400);
    } finally {
      r.restore();
    }
  });
});

describe('a link to an internationalized domain', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('is credited on its card to the host as written, not to the punycode the parser keeps', async () => {
    // The pure reading first, against the platform's own decoder as the oracle.
    const hosts = ['xn--bcher-kva.example', 'www.xn--mnchen-3ya.de', 'xn--nxasmq6b.gr', 'xn--80ak6aa92e.com', 'xn--fsqu00a.xn--3lr804guic', 'plain.example.com', 'www.example.org'];
    for (const h of hosts) {
      const card = parseHead('<html><head><title>T</title></head></html>', `https://${h}/p`);
      expect(card.site, h).toBe(domainToUnicode(h).replace(/^www\./, ''));
    }
    // A page that names its site keeps that name.
    expect(parseHead('<html><head><title>T</title><meta property="og:site_name" content="Bücher"></head></html>', 'https://xn--bcher-kva.example/').site).toBe('Bücher');
    // And through the route: a page, and a bare picture, on such a host.
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/laden') return new Response('<html><head><title>Bücher für alle</title><meta name="description" content="Ein Laden"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (u.pathname === '/bild.png') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
      return new Response('no', { status: 404 });
    };
    const { wsId, general } = await workspaceWith(alice);
    const page = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'https://bücher.example/laden' })).data.message;
    const card = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${page.seq}/unfurl`)).data.unfurl;
    expect(card).toMatchObject({ title: 'Bücher für alle', site: 'bücher.example', url: 'https://bücher.example/laden' });
    const pic = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'https://www.bücher.example/bild.png' })).data.message;
    const picCard = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${pic.seq}/unfurl`)).data.unfurl;
    expect(picCard).toMatchObject({ kind: 'image', site: 'bücher.example' });
  });
});

describe('addresses pasted out of prose or off a web page', () => {
  it('lose a mailto: scheme, the punctuation glued to them, and a full-width @', () => {
    expect(parseEmails('mailto:pat@example.com')).toEqual({ emails: ['pat@example.com'], bad: [] });
    expect(parseEmails('Write to pat@example.com. Or (ann@example.com), or "bob@example.com"; maybe [carol@example.com]?')).toEqual({
      emails: ['pat@example.com', 'ann@example.com', 'bob@example.com', 'carol@example.com'], bad: ['Write', 'to', 'Or', 'or', 'maybe'],
    });
    // Bracketed entries are read first (as a paste out of a mail client is), then the bare addresses.
    expect(parseEmails('pat＠example.com, Ann <ann＠example.com>')).toEqual({ emails: ['ann@example.com', 'pat@example.com'], bad: [] });
    expect(parseEmails('MAILTO:Pat@Example.com')).toEqual({ emails: ['pat@example.com'], bad: [] });
    // What was read before still is, and what is no address still is not.
    expect(parseEmails('Ellis Fry <ellis@example.com>, pat@example.com,').emails).toEqual(['ellis@example.com', 'pat@example.com']);
    expect(parseEmails('first.last+tag@sub.example.co.uk').emails).toEqual(['first.last+tag@sub.example.co.uk']);
    expect(parseEmails('pat@localhost notanemail').bad).toEqual(['pat@localhost', 'notanemail']);
  });
});

describe('an export or a move answered by the platform in place of the worker', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** The app's bridge to the (real) worker as `who`, with `hook(path, init)` given each request first: what it returns stands for the answer. */
  function bridge(hook = null, who = alice) {
    const exec = async (url, init = {}) => {
      const out = hook ? await hook(new URL(url).pathname + new URL(url).search, init) : undefined;
      return out === undefined ? rt.dispatch(url, init, who) : out;
    };
    return { workers: { exec } };
  }
  /** A gateway's page in place of the worker's JSON. */
  const platform = (status) => new Response(`<html><body>${status}</body></html>`, { status, headers: { 'Content-Type': 'text/html' } });
  const isPage = (path) => /^\/api\/ws\/[^/]+\/export\?cursor=/.test(path);
  const isFile = (path) => /^\/api\/ws\/[^/]+\/files\//.test(path);
  /** A workspace whose export takes four requests (a dozen conversations a page): forty channels beyond the defaults, and one attachment. */
  async function wide() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 40; i++) expect((await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` })).ok).toBe(true);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'spec.pdf', { type: 'application/pdf' }));
    const file = (await as(bob).post(`/api/ws/${wsId}/files`, fd)).data;
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'the last word', attachments: [{ id: file.id }] })).ok).toBe(true);
    return { wsId, general, file };
  }

  it('asks the page again, as for a lost answer; the worker\'s own refusals and errors are answered at once', async () => {
    const { wsId } = await wide();
    let plain = 0;
    globalThis.puter = bridge(() => { plain++; });
    const whole = await exportWorkspace(`${wsId}@teamchat-old`);
    expect(whole.pages.length).toBeGreaterThan(40);
    expect(plain).toBe(4);
    // A gateway's 502 on one page, a 503 on the next, a 429 on the third, each the first time that page is asked for: each asked again, and the archive is whole.
    const served = [502, 503, 429];
    const seen = new Set();
    let asked = 0;
    globalThis.puter = bridge((path) => {
      asked++;
      if (isPage(path) && served.length && !seen.has(path)) { seen.add(path); return platform(served.shift()); }
    });
    const archive = await exportWorkspace(`${wsId}@teamchat-old`, { pause: 1 });
    expect(served).toEqual([]);
    expect(archive.pages.map((p) => [p.conv, p.messages.length]).sort()).toEqual(whole.pages.map((p) => [p.conv, p.messages.length]).sort());
    expect(asked).toBe(plain + 3);
    // The worker's own server error carries its JSON and says the work failed: answered at once, not asked again.
    let internal = 0;
    globalThis.puter = bridge((path) => {
      if (isPage(path)) { internal++; return new Response(JSON.stringify({ code: 'internal', message: 'Something went wrong on the server' }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
    });
    await expect(exportWorkspace(`${wsId}@teamchat-old`, { pause: 1 })).rejects.toMatchObject({ code: 'internal', status: 500 });
    expect(internal).toBe(1);
    // A platform page that does not go away is given up on after the tries, with its status in the error.
    let gateway = 0;
    globalThis.puter = bridge((path) => { if (isPage(path)) { gateway++; return platform(504); } });
    await expect(exportWorkspace(`${wsId}@teamchat-old`, { pause: 1 })).rejects.toMatchObject({ code: 'http_504', status: 504 });
    expect(gateway).toBe(3);
  });

  it('an attachment\'s bytes answered by the platform once are asked again and land in the drive folder', async () => {
    const { wsId, file } = await wide();
    globalThis.puter = bridge();
    const archive = await exportWorkspace(`${wsId}@teamchat-old`);
    expect(archive.files.map((f) => f.id)).toEqual([file.id]);
    const written = [];
    let served = 0;
    globalThis.puter = { ...bridge((path) => { if (isFile(path) && !served) { served++; return platform(503); } }), fs: { write: async (path, blob) => { written.push([path, blob.size]); return { path }; } } };
    const reports = [];
    const folder = await writeArchiveToDrive(`${wsId}@teamchat-old`, archive, { pause: 1, onProgress: (p) => reports.push(p) });
    expect(served).toBe(1);
    expect(written.filter(([p]) => p.startsWith(`${folder}/files/`))).toEqual([[`${folder}/files/${file.id}-spec.pdf`, 4]]);
    expect(reports[reports.length - 1]).toMatchObject({ phase: 'files', done: 1, total: 1, missing: 0 });
  });

  it('a move whose completion is answered by the platform keeps its copy for the next try, rather than taking it down as refused', async () => {
    await as(alice).put('/api/server', { open: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'before the move' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    const oldRef = `${wsId}@teamchat-x`;
    const copies = async () => (await rt.kv.list('tc:ws:*')).filter((k) => /^tc:ws:[a-z0-9]+$/.test(k)).length;
    let once = true;
    const calls = [];
    globalThis.puter = bridge((path, init) => {
      calls.push(`${init?.method || 'GET'} ${path}`);
      if (once && path.endsWith('/transfer/complete')) { once = false; return platform(429); }
    }, bob);
    const state = { copy: null };
    await expect(transferWorkspace(oldRef, 'https://teamchat-x.puter.work', state, { profile: { name: 'Bob' } })).rejects.toMatchObject({ code: 'http_429' });
    // The copy stands, remembered for the next try; the original is not yet closed.
    expect(state.copy?.ref).toMatch(/^[a-z0-9]{6,20}@teamchat-x$/);
    expect(await copies()).toBe(2);
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBeUndefined();
    calls.length = 0;
    const moved = await transferWorkspace(oldRef, 'https://teamchat-x.puter.work', state, { profile: { name: 'Bob' } });
    expect(moved).toEqual({ ref: state.copy.ref, icon: null, mine: true });
    expect(calls.filter((c) => c.includes('/import') || c.includes('/export'))).toEqual([]);
    expect(await copies()).toBe(2);
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe(state.copy.ref);
  });
});

describe('what the app says when the platform answers in place of the server, or a request runs out of time', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const answering = (fn) => { globalThis.puter = { workers: { exec: fn } }; };
  const page = (status) => new Response(`<html><body>${status}</body></html>`, { status, headers: { 'Content-Type': 'text/html' } });
  const URL_ = 'https://teamchat-x.puter.work';

  it('names what happened and what to do, keeps the status in the code, and leaves the server\'s own words alone', async () => {
    answering(async () => page(502));
    await expect(api.health(URL_)).rejects.toMatchObject({ status: 502, code: 'http_502', message: 'The workspace server did not answer (502); try again in a moment' });
    answering(async () => page(504));
    await expect(api.health(URL_)).rejects.toMatchObject({ code: 'http_504', message: /did not answer \(504\)/ });
    answering(async () => page(429));
    await expect(api.health(URL_)).rejects.toMatchObject({ status: 429, code: 'http_429', message: 'The workspace server is busy right now (429); try again in a moment' });
    // A bare 404 is no server at the address, as before; the worker's own JSON keeps its words; another page keeps the plain line.
    answering(async () => page(404));
    await expect(api.health(URL_)).rejects.toMatchObject({ code: 'no_backend', message: 'No Teamchat server answers at this address' });
    answering(async () => new Response(JSON.stringify({ code: 'internal', message: 'Something went wrong on the server' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
    await expect(api.health(URL_)).rejects.toMatchObject({ status: 500, code: 'internal', message: 'Something went wrong on the server' });
    answering(async () => page(403));
    await expect(api.health(URL_)).rejects.toMatchObject({ code: 'http_403', message: 'Request failed (403)' });
  });

  it('an abort that is this request\'s own timer reads as the server taking too long, on a runtime that drops the reason too; one the page cut short reads as the network', async () => {
    vi.useFakeTimers();
    // A runtime that rejects with a plain AbortError when the signal fires, the reason lost.
    answering((url, init) => new Promise((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));
    const slow = api.health(URL_);
    const settled = slow.then(() => 'answered', (e) => e);
    await vi.advanceTimersByTimeAsync(20_001);
    const e = await settled;
    expect(e).toMatchObject({ code: 'timeout', message: 'The server took too long to answer' });
    // Aborted with nobody's timer having fired (the page going): the network, as before.
    answering(async () => { throw new DOMException('The user aborted a request.', 'AbortError'); });
    await expect(api.health(URL_)).rejects.toMatchObject({ code: 'network', message: 'Could not reach the workspace server' });
  });
});

/** An archive header for one channel, alice its owner, both alice and bob in the channel. */
const headerFor = (wsId, ch) => ({
  format: 'teamchat-export', version: 1, workspace: { id: wsId, name: 'Acme' },
  channels: { [ch]: { id: ch, name: 'general', def: true } },
  members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
  memberDocs: { [alice.uuid]: { channels: [ch] }, [bob.uuid]: { channels: [ch] } },
});

describe('an import page of long messages that were edited', () => {
  const CH = 'chedited0001';
  const WS = 'wsedited0001';

  it('writes each message\'s text once, so a block the original held lands within what the store holds', async () => {
    rt = await boot({ strictSize: true });
    expect((await as(alice).post('/api/workspaces/import', { header: headerFor(WS, CH), profile: { name: 'Alice' } })).status).toBe(200);
    // Fifty messages of a block as an export carries them: each at the
    // length a message may have, edited (its first words replaced by the
    // long text), naming a few people. On the original, the block held each
    // message's first words and its new text; written back with the new
    // text twice over, it did not fit the store.
    const names = Array.from({ length: 20 }, (_, i) => `u-m${String(i).padStart(2, '0')}-0000`);
    const messages = [];
    for (let s = 1; s <= 50; s++) messages.push({ seq: s, user: alice.uuid, text: 'x'.repeat(4000), ts: Date.UTC(2026, 0, 1) + s, editedAt: Date.UTC(2026, 0, 2) + s, kind: 'msg', mentions: names });
    const res = await as(alice).post(`/api/ws/${WS}/import`, { conv: CH, seq: 50, messages });
    expect(res.status).toBe(200);
    const block = await rt.kv.get(KEYS.block(CH, 0));
    expect(block.m).toHaveLength(50);
    expect(jsonBytes(block)).toBeLessThanOrEqual(VALUE_BYTES_MAX);
    // What the copy shows is what the archive said: the text, marked edited.
    expect((await as(alice).post(`/api/ws/${WS}/import/finish`)).ok).toBe(true);
    const shown = (await as(alice).get(`/api/ws/${WS}/conv/${CH}/messages?from=49&to=50`)).data.messages;
    expect(shown.map((m) => [m.text.length, m.editedAt, m.mentions.length])).toEqual([[4000, Date.UTC(2026, 0, 2) + 49, 20], [4000, Date.UTC(2026, 0, 2) + 50, 20]]);
    // An edit on the copy reads the text it edits from, and a preview asks after the link the message carries, as before.
    const edit = await as(alice).put(`/api/ws/${WS}/conv/${CH}/messages/50`, { text: 'shorter now' });
    expect(edit.status).toBe(200);
    expect((await as(alice).get(`/api/ws/${WS}/conv/${CH}/messages?from=50&to=50`)).data.messages[0]).toMatchObject({ text: 'shorter now', editedAt: edit.data.editedAt });
  });
});
