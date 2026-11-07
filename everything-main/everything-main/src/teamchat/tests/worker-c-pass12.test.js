/**
 * Twelfth review pass, region C: integrations, export/import/transfer, files,
 * link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { store } from '../src/lib/store.js';
import { api, ApiError } from '../src/lib/api.js';
import { tokenize, words, matchesWords, indexTokens } from '../src/shared/search.js';
import { parseEmails } from '../src/lib/email.js';
import { LIMITS } from '../src/shared/limits.js';
import { transferWorkspace } from '../src/lib/archive.js';
import { highlightSnippet } from '../src/lib/format.js';
import { deployOwnWorker, resetBundleCache } from '../src/lib/deploy.js';

/** A Puter account with no workspace server yet: the user document, the bundle the app ships, and a workers API that records what it creates. */
function accountWithoutWorker() {
  const tick = () => new Promise((r) => setTimeout(r, 5));
  const account = { saved: { v: 1, profile: {}, prefs: {}, workspaces: [], worker: null }, created: [], createCalls: 0, failFirstCreate: null };
  globalThis.fetch = async () => new Response('/* teamchat-worker build=abcabcabcabc at=2000 */\nconsole.log(1);', { status: 200 });
  globalThis.puter = {
    kv: {
      get: async () => { await tick(); return JSON.parse(JSON.stringify(account.saved)); },
      set: async (k, v) => { await tick(); account.saved = JSON.parse(JSON.stringify(v)); },
    },
    fs: { write: async (path) => ({ path }) },
    workers: {
      list: async () => account.created.map((name) => ({ name, url: `https://${name}.puter.work`, file_path: '/me/teamchat-worker.js' })),
      create: async (name) => {
        await tick();
        account.createCalls++;
        const fail = account.failFirstCreate;
        if (fail && account.createCalls === 1) {
          if (fail === 'made') account.created.push(name); // the worker exists; only the answer was lost
          throw new TypeError('answer lost');
        }
        account.created.push(name);
        return { url: `https://${name}.puter.work` };
      },
      exec: async () => json({ ok: true, build: 'abcabcabcabc' }),
    },
  };
  resetBundleCache();
  return account;
}

const { alice, bob, carol, dave } = USERS;
let rt;
let calls;
const realFetch = globalThis.fetch;

/** A small fake internet for the unfurler: two pages and a cover image. */
function fakeSite() {
  calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (u.pathname === '/notes') return html('<html><head><meta property="og:title" content="Release notes 2.0"><meta property="og:image" content="/cover.png"></head></html>');
    if (u.pathname === '/plain') return html('<html><head><title>Plain page</title></head></html>');
    if (u.pathname === '/cover.png') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
    return html('not found', 404);
  };
}

beforeEach(async () => {
  rt = await boot();
  fakeSite();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

/** Walk the export pages the way the client does. */
async function exportAll(u, wsId) {
  let res = await as(u).get(`/api/ws/${wsId}/export`);
  expect(res.ok).toBe(true);
  const archive = { header: res.data.header, pages: [...res.data.pages], files: [...res.data.files] };
  while (!res.data.done) {
    res = await as(u).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.data.cursor))}`);
    expect(res.ok).toBe(true);
    archive.pages.push(...res.data.pages);
    archive.files.push(...res.data.files);
  }
  return archive;
}

/** Upload `bytes` as `name` into a workspace; returns the file record the worker answers with. */
async function upload(u, wsId, name, type, bytes) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const res = await as(u).post(`/api/ws/${wsId}/files`, fd);
  expect(res.ok).toBe(true);
  return res.data;
}

/** The app's bridge to a worker, faked route by route (by the end of the path); returns the calls made. */
function fakeWorker(routes) {
  const made = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        made.push(`${init.method || 'GET'} ${u.pathname}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  return made;
}

describe('editing a message that carries a link preview', () => {
  const post = (u, wsId, conv, text) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
  const unfurl = (u, wsId, conv, seq) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages/${seq}/unfurl`);
  const edit = (u, wsId, conv, seq, text) => as(u).put(`/api/ws/${wsId}/conv/${conv}/messages/${seq}`, { text });
  const cardOf = async (u, wsId, conv, seq) => (await as(u).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.find((x) => x.seq === seq).unfurl;

  it('keeps the card while the link stays, drops it when the link changes or goes, and lets the new link have its own', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'see https://docs.example.com/notes')).data.message;
    expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl.title).toBe('Release notes 2.0');
    const fetched = calls.length;
    // Only the words change: the card stays, nothing is fetched again.
    const same = await edit(alice, wsId, general.id, m.seq, 'see https://docs.example.com/notes, everyone');
    expect(same.ok).toBe(true);
    expect(same.data.relink).toBeFalsy();
    expect((await cardOf(bob, wsId, general.id, m.seq)).title).toBe('Release notes 2.0');
    expect(calls).toHaveLength(fetched);
    // The link changes: the old page's card goes with it, at once and for every reader.
    const changed = await edit(alice, wsId, general.id, m.seq, 'see https://docs.example.com/plain instead');
    expect(changed.ok).toBe(true);
    expect(changed.data.relink).toBe(true);
    expect(await cardOf(bob, wsId, general.id, m.seq)).toBeNull();
    // The new link gets a card of its own when the author's client asks.
    expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl).toMatchObject({ url: 'https://docs.example.com/plain', title: 'Plain page' });
    expect((await cardOf(bob, wsId, general.id, m.seq)).title).toBe('Plain page');
    // The link is taken out: the card goes, and there is nothing to fetch.
    const gone = await edit(alice, wsId, general.id, m.seq, 'never mind');
    expect(gone.data.relink).toBe(true);
    expect(await cardOf(bob, wsId, general.id, m.seq)).toBeNull();
    const before = calls.length;
    expect((await unfurl(alice, wsId, general.id, m.seq)).data).toEqual({ unfurl: null });
    expect(calls).toHaveLength(before);
    // A link added by an edit to a message that had none is one the client is told to ask about.
    const plain = (await post(alice, wsId, general.id, 'no link here')).data.message;
    const added = await edit(alice, wsId, general.id, plain.seq, 'now there is https://docs.example.com/plain');
    expect(added.data.relink).toBe(true);
    expect((await unfurl(alice, wsId, general.id, plain.seq)).data.unfurl.title).toBe('Plain page');
  });

  it('keeps a card the author removed off for as long as its link stays, and drops the removal with the link', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await post(alice, wsId, general.id, 'https://docs.example.com/notes')).data.message;
    await unfurl(alice, wsId, general.id, m.seq);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).ok).toBe(true);
    const fetched = calls.length;
    // Same link, other words: still off, nothing fetched.
    expect((await edit(alice, wsId, general.id, m.seq, 'read https://docs.example.com/notes')).data.relink).toBeFalsy();
    expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl).toBeNull();
    expect(calls).toHaveLength(fetched);
    expect((await rt.kv.get(KEYS.block(general.id, 0))).x[`s${m.seq}`].uf).toEqual({ off: 1 });
    // Another link: the removal was about the old one, and the new one previews.
    expect((await edit(alice, wsId, general.id, m.seq, 'read https://docs.example.com/plain')).data.relink).toBe(true);
    expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl.title).toBe('Plain page');
  });
});

describe('the client after an edit', () => {
  const REF = 'abc123def0@teamchat-test';
  const open = () => {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Globex', channels: { c1: { id: 'c1', name: 'ops' } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
  };
  afterEach(() => {
    store.stopPolling();
    store.wsId = null;
    store.ws = null;
    store.me = null;
    store.profile = null;
    store.convs.clear();
    delete globalThis.puter;
  });

  it('takes the old card off the message the moment the worker says the link changed, and asks for the new link\'s', async () => {
    const made = fakeWorker({
      '/messages/1': async (q, init) => json({ ok: true, text: JSON.parse(init.body).text, editedAt: 5000, relink: true }),
      '/messages/1/unfurl': async () => json({ unfurl: { url: 'https://b.example.com/y', title: 'New page', desc: '', site: 'b.example.com', image: null, kind: 'page', ts: 1 } }),
      '/messages/2': async (q, init) => json({ ok: true, text: JSON.parse(init.body).text, editedAt: 5000 }),
    });
    open();
    const c = store.conv('c1');
    const old = { url: 'https://a.example.com/x', title: 'Old page', desc: '', site: 'a.example.com', image: null, kind: 'page', ts: 1 };
    Object.assign(c, { loaded: true, seq: 2, messages: [
      { seq: 1, text: 'see https://a.example.com/x', user: 'u-me', ts: 1000, unfurl: { ...old } },
      { seq: 2, text: 'see https://a.example.com/x too', user: 'u-me', ts: 1001, unfurl: { ...old } },
    ] });
    await store.edit('c1', 1, 'see https://b.example.com/y');
    expect(c.messages[0].unfurl).toBeNull();
    await tick(10);
    expect(c.messages[0].unfurl?.title).toBe('New page');
    expect(made.filter((x) => x.endsWith('/unfurl'))).toEqual(['POST /api/ws/abc123def0/conv/c1/messages/1/unfurl']);
    // A worker that says nothing about the link (an older build, or the link unchanged) leaves the card as it is.
    await store.edit('c1', 2, 'see https://a.example.com/x as well');
    await tick(10);
    expect(c.messages[1].unfurl?.title).toBe('Old page');
    expect(made.filter((x) => x.endsWith('/unfurl'))).toHaveLength(1);
  });
});

describe('an address that answers with a web page instead of a worker', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const answers = (res) => { globalThis.puter = { workers: { exec: async () => res } }; };
  const failure = (p) => p.then(() => null, (e) => e);

  it('is reported as no backend, the way a bare 404 is, not as a parsing error over the page', async () => {
    answers(new Response('<!doctype html><html><body>This domain is parked</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const e = await failure(api.health('https://parked.example.com'));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ code: 'no_backend', status: 200 });
    expect(e.message).toBe('No Teamchat server answers at this address');
    // An empty 200 is no worker's answer either.
    answers(new Response('', { status: 200 }));
    expect((await failure(api.server('https://parked.example.com'))).code).toBe('no_backend');
  });

  it('tells a body cut off by the timer, or by the network, from a page: the failure the rest of the app already knows', async () => {
    answers({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new DOMException('The request timed out', 'TimeoutError'); } });
    expect(await failure(api.health('https://slow.example.com'))).toMatchObject({ code: 'timeout', status: 0 });
    answers({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new TypeError('terminated'); } });
    expect(await failure(api.health('https://cut.example.com'))).toMatchObject({ code: 'network', status: 0 });
    // A worker's real answer is untouched.
    answers(json({ ok: true, build: 'dev' }));
    expect(await api.health('https://teamchat-x.puter.work')).toEqual({ ok: true, build: 'dev' });
  });
});

describe('a scheduled message with a file, moved with the workspace', () => {
  it('arrives with its file: the export names what the queue holds, so the copy is fed the bytes like a bookmark\'s', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(alice, wsId, 'agenda.txt', 'text/plain', 'agenda');
    const sched = await as(alice).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: '', attachments: [{ id: file.id }], dueAt: Date.now() + 60_000 });
    expect(sched.ok).toBe(true);
    const archive = await exportAll(alice, wsId);
    // Named in the manifest, as a bookmark's file is, though no message carries it yet.
    expect(archive.files.find((f) => f.id === file.id)).toMatchObject({ id: file.id, name: 'agenda.txt', size: 6, type: 'text/plain', sched: true });
    // A transfer: the copy, its pages, then the bytes of every file the
    // manifest names (on another server the record is not there; here the
    // original still holds it, so it is cleared to stand in for that).
    const created = await as(alice).post('/api/workspaces/import', { header: archive.header, from: `${wsId}@old-server` });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    for (const page of archive.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    const bytes = await rt.fs.read(`teamchat-files/${wsId}/${file.id}`);
    await rt.kv.del(KEYS.file(file.id));
    for (const f of archive.files) {
      const upf = new FormData();
      upf.append('file', bytes, f.name);
      upf.append('id', f.id);
      upf.append('name', f.name);
      expect((await as(alice).post(`/api/ws/${newId}/import/file`, upf)).ok).toBe(true);
    }
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    // Its time comes on the copy: the next poll delivers it, file and all.
    const queue = await rt.kv.get(KEYS.sched(newId));
    const [id] = Object.keys(queue.m);
    await rt.kv.update(KEYS.sched(newId), { [`m.${id}.dueAt`]: Date.now() - 1000 });
    await rt.kv.update(KEYS.activity(newId), { nd: Date.now() - 1000 });
    expect((await as(alice).get(`/api/ws/${newId}/sync?since=0`)).ok).toBe(true);
    const copy = (await as(alice).get(`/api/ws/${newId}`)).data.workspace;
    const ch = Object.values(copy.channels).find((c) => c.name === 'general');
    const list = (await as(bob).get(`/api/ws/${newId}/conv/${ch.id}/messages`)).data.messages;
    const delivered = list.find((m) => m.user === alice.uuid && m.kind !== 'sys');
    expect(delivered?.attachments).toEqual([{ id: file.id, name: 'agenda.txt', size: 6, type: 'text/plain' }]);
    const got = await as(bob).get(`/api/ws/${newId}/files/${file.id}`);
    expect(got.status).toBe(200);
    expect(await got.data.text()).toBe('agenda');
  });
});

describe('searching Chinese and Japanese', () => {
  it('reads a run of ideographs or kana by its pairs of characters, so a word inside a clause is found', () => {
    // A clause is not a word: by its pairs, a query for any two or more characters of it matches.
    expect(tokenize('我喜欢猫')).toEqual(['我喜', '喜欢', '欢猫']);
    expect(matchesWords('我喜欢猫和狗', words('喜欢'))).toBe(true);
    expect(matchesWords('我喜欢猫和狗', words('喜欢猫'))).toBe(true);
    expect(matchesWords('我喜欢猫和狗', words('狗猫'))).toBe(false);
    // A clause longer than a token used to be indexed as nothing at all.
    const long = '今天我们讨论了新版本的发布计划以及下个季度的路线图安排';
    expect(long.length).toBeGreaterThan(24);
    expect(tokenize(long).length).toBe(long.length - 1);
    expect(matchesWords(long, words('发布计划'))).toBe(true);
    // A voiced kana is one character with its mark, and pairs whole; what stands beside a run is a word of its own.
    expect(tokenize('ガラス')).toEqual(['ガラ', 'ラス'].map((w) => w.normalize('NFKD')));
    expect(matchesWords('ガラスの器', words('ガラス'))).toBe(true);
    expect(tokenize('iPhone用アプリ v2')).toEqual(['用ア', 'アプ', 'プリ', 'iphone', 'v2'].map((w) => w.normalize('NFKD')));
    // The prolonged sound mark and the iteration marks belong to no script of their own: read with the kana and ideographs they stand among, a run holds together.
    expect(tokenize('コーヒー')).toEqual(['コー', 'ーヒ', 'ヒー']);
    expect(tokenize('データベース')).toEqual(['デー', 'ータ', 'タベ', 'ベー', 'ース'].map((w) => w.normalize('NFKD')));
    expect(tokenize('サーバーが落ちた')).toEqual(['サー', 'ーバ', 'バー', 'ーが', 'が落', '落ち', 'ちた'].map((w) => w.normalize('NFKD')));
    expect(matchesWords('サーバーが落ちた', words('サーバー'))).toBe(true);
    expect(tokenize('人々')).toEqual(['人々']);
    // One character alone is below the shortest word, as one letter is; Korean, written with spaces, is left to the split.
    expect(tokenize('猫')).toEqual([]);
    expect(tokenize('안녕하세요 세계')).toEqual(['안녕하세요', '세계'].map((w) => w.normalize('NFKD')));
    expect(indexTokens('日本語 https://例え.jp/x')).toEqual(['日本', '本語', 'https', '例え', 'jp', '_link']);
  });

  it('finds a message by a word of its clause through the worker, not only by the whole clause', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const post = (text) => as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text });
    await post('今天我们讨论了新版本的发布计划');
    await post('猫の写真を送ります');
    await post('unrelated english words');
    const search = async (q) => (await as(bob).get(`/api/ws/${wsId}/search?q=${encodeURIComponent(q)}`)).data.results.map((m) => m.text);
    expect(await search('发布')).toEqual(['今天我们讨论了新版本的发布计划']);
    expect(await search('发布计划')).toEqual(['今天我们讨论了新版本的发布计划']);
    expect(await search('今天我们讨论了新版本的发布计划')).toEqual(['今天我们讨论了新版本的发布计划']);
    expect(await search('写真')).toEqual(['猫の写真を送ります']);
    expect(await search('计划 写真')).toEqual([]);
  });
});

describe('a pasted recipient list with unquoted "Last, First" display names', () => {
  it('reads each name whole, whether entries are separated by semicolons or commas, reporting nothing as unreadable', () => {
    // A mail client's To line, copied as it stands.
    expect(parseEmails('Fry, Ellis <ellis@example.com>; Doe, Jane <jane@example.com>')).toEqual({ emails: ['ellis@example.com', 'jane@example.com'], bad: [] });
    expect(parseEmails('Fry, Ellis <ellis@example.com>, Doe, Jane <jane@example.com>')).toEqual({ emails: ['ellis@example.com', 'jane@example.com'], bad: [] });
    // A bare address before the comma is a recipient of its own, not the front of the next name.
    expect(parseEmails('pat@x.com, Fry, Ellis <e@x.com>')).toEqual({ emails: ['e@x.com', 'pat@x.com'], bad: [] });
    // And a malformed one there is still reported.
    expect(parseEmails('bob@example, Ann <ann@y.com>')).toEqual({ emails: ['ann@y.com'], bad: ['bob@example'] });
    // Nothing else moved: bare, quoted and space-separated forms as before.
    expect(parseEmails('pat@example.com Ellis Fry <ellis@example.com>')).toEqual({ emails: ['ellis@example.com', 'pat@example.com'], bad: [] });
    expect(parseEmails('"Fry, Ellis" <ellis@example.com>, ann@y.org')).toEqual({ emails: ['ellis@example.com', 'ann@y.org'], bad: [] });
    expect(parseEmails('ellis@example.com, notanemail, maria@example.com').bad).toEqual(['notanemail']);
  });
});

describe('the files an imported page holds', () => {
  it('are counted a dozen at a time, and a count that failed once is tried again rather than lost', async () => {
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'holdimp000', name: 'Old' },
      channels: { holdconv01: { name: 'general', def: true } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: ['holdconv01'] } },
    };
    const newId = (await as(alice).post('/api/workspaces/import', { header })).data.workspace.id;
    // Thirty files over six messages; the store is watched for how many
    // counts are in flight at once, and made to refuse one count one time.
    const files = Array.from({ length: 30 }, (_, i) => `holdfile${String(i).padStart(4, '0')}`);
    const messages = Array.from({ length: 6 }, (_, k) => ({ seq: k + 1, user: alice.uuid, text: `m${k}`, ts: 1000 + k, attachments: files.slice(k * 5, k * 5 + 5).map((id) => ({ id, name: `${id}.txt`, size: 1, type: 'text/plain' })) }));
    const realIncr = rt.kv.incr;
    let inFlight = 0;
    let most = 0;
    let failed = false;
    rt.kv.incr = async function (k, ...rest) {
      if (k === KEYS.file('holdfile0007') && !failed) {
        failed = true;
        throw new Error('store hiccup');
      }
      inFlight++;
      most = Math.max(most, inFlight);
      try {
        return await realIncr.call(this, k, ...rest);
      } finally {
        inFlight--;
      }
    };
    try {
      expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: 'holdconv01', seq: 6, messages })).ok).toBe(true);
    } finally {
      rt.kv.incr = realIncr;
    }
    expect(failed).toBe(true);
    expect(most).toBeLessThanOrEqual(12);
    for (const id of files) expect((await rt.kv.get(KEYS.file(id)))?.refs, id).toBe(1);
    expect((await rt.kv.get(KEYS.file('holdfile0007'))).cs).toEqual({ holdconv01: 1 });
  });
});

describe('a file forwarded into a guest\'s channel and deleted there again', () => {
  it('is no longer theirs to download or attach, while another copy still shared, or a bookmark, keeps it so', async () => {
    const { wsId } = await workspaceWith(alice, [bob, carol]);
    const project = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'project' })).data.channel.id;
    await as(bob).post(`/api/ws/${wsId}/channels/${project}/join`);
    const secret = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'secret', private: true })).data.channel.id;
    await as(alice).post(`/api/ws/${wsId}/channels/${secret}/members`, { uuids: [carol.uuid, bob.uuid] });
    const inv = await as(alice).post(`/api/ws/${wsId}/channels/${project}/invites`, { inviteTtl: '7d' });
    expect((await as(dave).post('/api/join', { code: inv.data.code })).ok).toBe(true);
    const post = (u, conv, text, attachments) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text, attachments });
    const fetchAs = async (u) => (await as(u).get(`/api/ws/${wsId}/files/${hidden.id}`)).status;
    const hidden = await upload(carol, wsId, 'secret.txt', 'text/plain', 'bytes');
    await post(carol, secret, 'for members only', [{ id: hidden.id }]);
    expect(await fetchAs(dave)).toBe(404);
    // Forwarded into the guest's channel twice: theirs while either copy stands.
    const one = (await post(bob, project, 'fyi', [{ id: hidden.id }])).data.message;
    const two = (await post(bob, project, 'again', [{ id: hidden.id }])).data.message;
    expect(await fetchAs(dave)).toBe(200);
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${project}/messages/${one.seq}`)).ok).toBe(true);
    expect(await fetchAs(dave)).toBe(200);
    // The last copy gone, the file has left the channel: not theirs to download, nor to attach.
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${project}/messages/${two.seq}`)).ok).toBe(true);
    expect(await fetchAs(dave)).toBe(404);
    expect((await post(dave, project, '', [{ id: hidden.id }])).status).toBe(400);
    // The file itself stays, held by the message in the private channel.
    expect(await fetchAs(bob)).toBe(200);
    expect((await rt.kv.get(KEYS.file(hidden.id))).refs).toBe(1);
    // A bookmark in their channel shares it again, and taking the bookmark down takes that back.
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${project}`, { bookmarks: [{ label: 'Plans', file: hidden.id }] })).ok).toBe(true);
    expect(await fetchAs(dave)).toBe(200);
    expect((await as(bob).put(`/api/ws/${wsId}/channels/${project}`, { bookmarks: [] })).ok).toBe(true);
    expect(await fetchAs(dave)).toBe(404);
  });
});

describe('a bot token past its budget', () => {
  it('is told what the budget is, for a read as for a post', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const reader = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Reader', scopes: ['read'], channels: [general.id] })).data;
    const read = () => rt.dispatch(`https://teamchat-api.test/bot/${reader.token}/channels/${general.id}/messages`, { method: 'GET' }, null);
    for (let i = 0; i < LIMITS.hookRatePerMinute; i++) expect((await read()).status).toBe(200);
    const over = await read();
    expect(over.status).toBe(429);
    const body = await over.json();
    expect(body.code).toBe('rate_limited');
    expect(body.message).toBe(`This token may make ${LIMITS.hookRatePerMinute} calls a minute; try again shortly`);
    expect(body.message).not.toMatch(/post/);
  });
});

describe('a bot whose channel list names a channel more than once', () => {
  it('holds it once, when the bot is created and when it is changed', async () => {
    const { wsId, general } = await workspaceWith(alice);
    const other = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'other' })).data.channel.id;
    const created = await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Deploys', scopes: ['post'], channels: [general.id, general.id, other, general.id] });
    expect(created.ok).toBe(true);
    expect(created.data.channels).toEqual([general.id, other]);
    expect((await rt.kv.get(KEYS.bot(created.data.id))).channels).toEqual([general.id, other]);
    expect((await as(alice).put(`/api/ws/${wsId}/bots/${created.data.id}`, { channels: [other, other] })).ok).toBe(true);
    expect((await rt.kv.get(KEYS.bot(created.data.id))).channels).toEqual([other]);
    expect((await as(alice).get(`/api/ws/${wsId}/webhooks`)).data.bots.find((b) => b.id === created.data.id).channels).toEqual([other]);
  });
});

describe('a file name that reads as something else', () => {
  it('is cleaned when uploaded or imported: bidi and zero-width marks out, control characters one space, clamped', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const cases = [
      ['invoice_\u202Efdp.exe', 'invoice_fdp.exe'],
      ['\u200Bhidden\u200D.txt', 'hidden.txt'],
      ['a\nb\r\n\tc.txt', 'a b c.txt'],
      ['   ', 'file'],
      [`${'x'.repeat(300)}.txt`, 'x'.repeat(120)],
      ['résumé ☃️ (final)*.pdf', 'résumé ☃️ (final)*.pdf'],
    ];
    for (const [given, shown] of cases) {
      const f = await upload(alice, wsId, given, 'text/plain', 'x');
      expect(f.name, JSON.stringify(given.slice(0, 20))).toBe(shown);
      const got = await as(bob).get(`/api/ws/${wsId}/files/${f.id}`);
      expect(got.data.headers.get('content-disposition'), shown).toContain(`filename*=UTF-8''${encodeURIComponent(shown).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
      // What a message shows is the name as stored.
      const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: '', attachments: [{ id: f.id }] })).data.message;
      expect(m.attachments[0].name).toBe(shown);
    }
    // An archive's names go the same way: the attachments its pages carry, the bytes sent for them, a bookmark's file.
    const conv = 'fnameconv1';
    const header = {
      format: 'teamchat-export', version: 1, workspace: { id: 'fnameimp00', name: 'Old' },
      channels: { [conv]: { name: 'general', def: true, bookmarks: [{ id: 'bkmk0001', label: 'Plan', file: 'fnamefile001', name: 'plan_\u202Efdp.exe' }] } },
      members: { [alice.uuid]: { name: 'alice', username: 'alice', role: 'owner' } },
      memberDocs: { [alice.uuid]: { channels: [conv] } },
    };
    const newId = (await as(alice).post('/api/workspaces/import', { header })).data.workspace.id;
    expect((await rt.kv.get(KEYS.ws(newId))).channels[conv].bookmarks[0].name).toBe('plan_fdp.exe');
    const page = await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 1, messages: [{ seq: 1, user: alice.uuid, text: 'see', ts: 1000, attachments: [{ id: 'fnamefile001', name: 'plan_\u202Efdp.exe', size: 1, type: 'text/plain' }] }] });
    expect(page.ok).toBe(true);
    expect((await rt.kv.get(KEYS.block(conv, 0))).m[0].a[0].name).toBe('plan_fdp.exe');
    const upf = new FormData();
    upf.append('file', new Blob(['x'], { type: 'text/plain' }), 'plan_\u202Efdp.exe');
    upf.append('id', 'fnamefile001');
    upf.append('name', 'plan_\u202Efdp.exe');
    expect((await as(alice).post(`/api/ws/${newId}/import/file`, upf)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file('fnamefile001'))).name).toBe('plan_fdp.exe');
  });
});

describe('a transfer whose completion the original refuses', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const copies = async () => (await rt.kv.list('tc:ws:*')).filter((k) => /^tc:ws:[a-z0-9]+$/.test(k)).length;

  it('takes the copy it made down rather than leaving a second workspace nobody is sent to, while a failure to reach the original keeps it', async () => {
    await as(alice).put('/api/server', { open: true });
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await as(alice).post(`/api/ws/${wsId}/members/${bob.uuid}/role`, { role: 'admin' });
    await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'before the move' });
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    const oldRef = `${wsId}@teamchat-x`;
    let onComplete = null;
    globalThis.puter = { workers: { exec: async (url, init) => {
      const path = new URL(url).pathname;
      if (onComplete && path.endsWith('/transfer/complete')) await onComplete();
      return rt.dispatch(url, init, bob);
    } } };
    // The owner withdraws the nomination while bob's app is copying: the completion is refused for good.
    onComplete = async () => { expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { cancel: true })).ok).toBe(true); onComplete = null; };
    const state = { copy: null };
    const e = await transferWorkspace(oldRef, 'https://teamchat-x.puter.work', state, { profile: { name: 'Bob' } }).then(() => null, (err) => err);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(403);
    expect(state.copy).toBeNull();
    expect(await copies()).toBe(1); // the original alone: the copy is gone
    expect((await as(bob).get('/api/me')).data.workspaces.map((w) => w.id)).toEqual([wsId]);
    // Nominated again, the network failing at the completion: the copy stays for the next try, and the next try finishes with it.
    expect((await as(alice).post(`/api/ws/${wsId}/transfer`, { to: bob.uuid })).ok).toBe(true);
    let drop = true;
    onComplete = async () => { if (drop) { drop = false; throw new TypeError('connection dropped'); } };
    const again = { copy: null };
    expect(await transferWorkspace(oldRef, 'https://teamchat-x.puter.work', again, { profile: { name: 'Bob' } }).then(() => null, (err) => err.code)).toBe('network');
    expect(again.copy?.ref).toMatch(/@teamchat-x$/);
    expect(await copies()).toBe(2);
    const moved = await transferWorkspace(oldRef, 'https://teamchat-x.puter.work', again, { profile: { name: 'Bob' } });
    expect(moved).toEqual({ ref: again.copy.ref, icon: null, mine: true });
    expect((await rt.kv.get(KEYS.ws(wsId))).movedTo).toBe(again.copy.ref);
  });
});

describe('a search snippet over a word written half in Latin letters and half in ideographs or kana', () => {
  it('marks the Latin part when it is the word searched for, the run by its pairs, and opens the window around whichever matches first', () => {
    expect(highlightSnippet('the iPhone用アプリ shipped', ['iphone'])).toBe('the <mark>iPhone</mark>用アプリ shipped');
    expect(highlightSnippet('the iPhone用アプリ shipped', words('アプリ'))).toBe('the iPhone用<mark>アプリ</mark> shipped');
    expect(highlightSnippet('the iPhone用アプリ shipped', ['iphone', ...words('アプ')])).toBe('the <mark>iPhone</mark>用<mark>アプ</mark>リ shipped');
    // Combining marks stay with their letters on either side of the run.
    expect(highlightSnippet('at café東京 tonight', ['cafe'])).toBe('at <mark>café</mark>東京 tonight');
    expect(highlightSnippet('東京café tonight', ['cafe'])).toBe('東京<mark>café</mark> tonight');
    // The window opens around the Latin part deep in a long text, as it does around a whole word.
    const long = `${'filler '.repeat(40)}v2 iPhone用アプリ shipped ${'tail '.repeat(40)}`;
    const out = highlightSnippet(long, ['iphone']);
    expect(out.startsWith('…')).toBe(true);
    expect(out).toContain('<mark>iPhone</mark>用アプリ');
    // Nothing else moved: a whole-word match, and a run on its own.
    expect(highlightSnippet('Hello world', ['world'])).toBe('Hello <mark>world</mark>');
    expect(highlightSnippet('今天我们讨论了发布计划', words('发布'))).toBe('今天我们讨论了<mark>发布</mark>计划');
  });
});

describe('two tabs creating their first workspace at once', () => {
  afterEach(() => {
    store.user = null;
    store.identity = null;
    store._ensuringWorker = null;
    delete globalThis.puter;
    resetBundleCache();
  });

  it('deploy one server between them, and a server another tab recorded meanwhile is taken as it is', async () => {
    const account = accountWithoutWorker();
    store.user = JSON.parse(JSON.stringify(account.saved));
    store.identity = { uuid: 'me', username: 'me' };
    const [a, b] = await Promise.all([store.ensureOwnWorker(), store.ensureOwnWorker()]);
    expect(account.created).toHaveLength(1);
    expect(a.url).toBe(`https://${account.created[0]}.puter.work`);
    expect(b.url).toBe(a.url);
    expect(account.saved.worker.url).toBe(a.url);
    expect(store.user.worker.url).toBe(a.url);
    // Another tab recorded a server while this one still knew of none: nothing is deployed, theirs is used and kept.
    const other = accountWithoutWorker();
    other.saved.worker = { name: 'teamchat-other', url: 'https://teamchat-other.puter.work', path: '/me/teamchat-worker.js', build: 'x' };
    store.user = { v: 1, profile: {}, prefs: {}, workspaces: [], worker: null };
    const c = await store.ensureOwnWorker();
    expect(other.created).toHaveLength(0);
    expect(c.url).toBe('https://teamchat-other.puter.work');
    expect(store.user.worker.url).toBe('https://teamchat-other.puter.work');
    expect(other.saved.worker.url).toBe('https://teamchat-other.puter.work');
  });
});

describe('a worker whose creation call failed after the worker was made', () => {
  afterEach(() => {
    delete globalThis.puter;
    resetBundleCache();
  });

  it('is taken as the server rather than a second one made beside it; one truly not made gives way to another name', async () => {
    const made = accountWithoutWorker();
    made.failFirstCreate = 'made';
    const w = await deployOwnWorker();
    expect(made.createCalls).toBe(1);
    expect(made.created).toEqual([w.name]);
    expect(w.url).toBe(`https://${w.name}.puter.work`);
    expect(w.path).toBe('/me/teamchat-worker.js');
    expect(w.build).toBe('abcabcabcabc');
    // The call failed and nothing was made: another name is tried, and that one is the server.
    const none = accountWithoutWorker();
    none.failFirstCreate = 'lost';
    const v = await deployOwnWorker();
    expect(none.createCalls).toBe(2);
    expect(none.created).toEqual([v.name]);
  });
});

describe('an archive naming an inherited property where an id goes', () => {
  it('admits none as an author, a mention, a maker, a direct message\'s member or a file\'s owner; an app\'s author id passes', async () => {
    const conv = 'authimp001';
    // JSON.parse, unlike an object literal, makes "__proto__" an own key.
    const header = JSON.parse(`{"format":"teamchat-export","version":1,"workspace":{"id":"authimp000","name":"Old"},
      "channels":{"${conv}":{"name":"general","def":true,"createdBy":"constructor"}},
      "members":{"${alice.uuid}":{"name":"alice","username":"alice","role":"owner"},"${bob.uuid}":{"name":"bob","username":"bob","role":"member"}},
      "memberDocs":{"${alice.uuid}":{"channels":["${conv}"],"dms":{"dm_old":{"members":["${alice.uuid}","__proto__","toString"],"createdAt":1}}},"${bob.uuid}":{"channels":["${conv}"]}},
      "pins":{"${conv}":[{"seq":1,"by":"constructor","ts":1}]}}`);
    const created = await as(alice).post('/api/workspaces/import', { header });
    expect(created.ok).toBe(true);
    const newId = created.data.workspace.id;
    const page = await as(alice).post(`/api/ws/${newId}/import`, { conv, seq: 2, messages: [
      { seq: 1, user: 'constructor', text: 'from nowhere', ts: 1000, mentions: ['constructor', '__proto__', bob.uuid] },
      { seq: 2, user: 'hook_abcdefghij', text: 'from an app', ts: 2000, bot: { name: 'Deploys', color: 3 } },
    ] });
    expect(page.ok).toBe(true);
    const block = await rt.kv.get(KEYS.block(conv, 0));
    expect(block.m[0].u).toBe('');
    expect(block.m[0].mn).toEqual([bob.uuid]);
    expect(block.m[1].u).toBe('hook_abcdefghij');
    expect((await rt.kv.get(KEYS.activity(newId))).c[conv].u).toBe('hook_abcdefghij');
    expect((await rt.kv.get(KEYS.ws(newId))).channels[conv].createdBy).toBeNull();
    expect((await rt.kv.get(KEYS.pins(newId, conv))).items).toEqual([{ seq: 1, by: alice.uuid, ts: 1 }]);
    // The direct message keeps the people who can be in it, and nobody else.
    const dms = (await rt.kv.get(KEYS.member(newId, alice.uuid))).dms;
    expect(Object.values(dms).map((d) => d.members)).toEqual([[alice.uuid]]);
    // A file's owner, sent with its bytes, is the importer when the name given is no one's.
    const upf = new FormData();
    upf.append('file', new Blob(['x'], { type: 'text/plain' }), 'x.txt');
    upf.append('id', 'authfile0001');
    upf.append('owner', 'constructor');
    expect((await as(alice).post(`/api/ws/${newId}/import/file`, upf)).ok).toBe(true);
    expect((await rt.kv.get(KEYS.file('authfile0001'))).u).toBe(alice.uuid);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    // What the members see: a line by nobody, and one by an app, each with its text.
    const list = (await as(bob).get(`/api/ws/${newId}/conv/${conv}/messages`)).data.messages;
    expect(list.map((m) => [m.user, m.text])).toEqual([['', 'from nowhere'], ['hook_abcdefghij', 'from an app']]);
  });
});
