/**
 * Twenty-second review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { LIMITS } from '../src/shared/limits.js';
import { parseHead } from '../worker/unfurl.js';
import { importArchive } from '../src/lib/archive.js';
import { SEARCH_VERSION, SEARCH_SHARDS, shardOf, encodePosting, bucketOf, authorToken, scopedToken } from '../src/shared/search.js';

const { alice, bob } = USERS;

/** Upload a small file as `who` into the workspace; answers the file record the route hands back. */
async function upload(who, wsId, name = 'spec.pdf', type = 'application/pdf') {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([1, 2, 3, 4])], name, { type }));
  const res = await as(who).post(`/api/ws/${wsId}/files`, fd);
  expect(res.status).toBe(200);
  return res.data;
}
let rt;

beforeEach(async () => {
  rt = await boot();
});

/** An archive header for one channel, alice its owner, both alice and bob in the channel. */
const headerFor = (wsId, ch) => ({
  format: 'teamchat-export', version: 1, workspace: { id: wsId, name: 'Acme' },
  channels: { [ch]: { id: ch, name: 'general', def: true } },
  members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
  memberDocs: { [alice.uuid]: { channels: [ch] }, [bob.uuid]: { channels: [ch] } },
});

/** Bring an archive across: create, one page for the channel, finish. */
async function restore(wsId, ch, page) {
  expect((await as(alice).post('/api/workspaces/import', { header: headerFor(wsId, ch), profile: { name: 'Alice' } })).status).toBe(200);
  expect((await as(alice).post(`/api/ws/${wsId}/import`, { conv: ch, ...page })).ok).toBe(true);
  expect((await as(alice).post(`/api/ws/${wsId}/import/finish`)).ok).toBe(true);
}

describe('the blocks a restored conversation posts into next', () => {
  // A store that refuses to append into a block that is not there: the
  // worker's fallback then reads and rewrites the block whole, and two such
  // rewrites at once keep one message each (see appendToBlock). Blocks are
  // made ahead so that never happens to a live conversation.
  beforeEach(async () => {
    rt = await boot({ strictAdd: true });
  });

  it('are there when the page ended short of the counter (its last messages deleted before the export), so two first posts at once both land', async () => {
    const CH = 'chshort0001';
    // 101 messages were written; the 101st was deleted, so the page carries
    // 1..100 under a counter of 101. The next post is number 102, in the
    // third block, which no page wrote.
    const messages = [];
    for (let s = 1; s <= 100; s++) messages.push({ seq: s, user: alice.uuid, text: `line ${s}`, ts: Date.UTC(2026, 0, 1) + s, kind: 'msg' });
    await restore('wsshort0001', CH, { seq: 101, messages });
    expect(await rt.kv.get(KEYS.block(CH, 2))).toBeTruthy();
    const [a, b] = await Promise.all([
      as(alice).post(`/api/ws/wsshort0001/conv/${CH}/messages`, { text: 'alice first' }),
      as(bob).post(`/api/ws/wsshort0001/conv/${CH}/messages`, { text: 'bob first' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const after = (await as(alice).get(`/api/ws/wsshort0001/conv/${CH}/messages?after=101`)).data.messages;
    expect(after.map((m) => m.text).sort()).toEqual(['alice first', 'bob first']);
  });

  it('are there one block on from a page that carried no message at all, so the first two posts into that block both land', async () => {
    const CH = 'chempty0001';
    // Every message was deleted before the export: a page of nothing under a
    // counter of 149. Number 150 fills the block; 151 and 152 open the next.
    await restore('wsempty0001', CH, { seq: 149, messages: [] });
    expect(await rt.kv.get(KEYS.block(CH, 2))).toBeTruthy();
    expect(await rt.kv.get(KEYS.block(CH, 3))).toBeTruthy();
    expect((await as(alice).post(`/api/ws/wsempty0001/conv/${CH}/messages`, { text: 'one fifty' })).status).toBe(200);
    const [a, b] = await Promise.all([
      as(alice).post(`/api/ws/wsempty0001/conv/${CH}/messages`, { text: 'alice opens' }),
      as(bob).post(`/api/ws/wsempty0001/conv/${CH}/messages`, { text: 'bob opens' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const after = (await as(alice).get(`/api/ws/wsempty0001/conv/${CH}/messages?after=150`)).data.messages;
    expect(after.map((m) => m.text).sort()).toEqual(['alice opens', 'bob opens']);
  });

  it('a page that wrote the head block still gets the block past it, as a live conversation has it', async () => {
    const CH = 'chfull00001';
    const messages = [];
    for (let s = 1; s <= 120; s++) messages.push({ seq: s, user: alice.uuid, text: `line ${s}`, ts: Date.UTC(2026, 0, 1) + s, kind: 'msg' });
    await restore('wsfull00001', CH, { seq: 120, messages });
    expect(await rt.kv.get(KEYS.block(CH, 2))).toBeTruthy();
    expect(await rt.kv.get(KEYS.block(CH, 3))).toBeTruthy();
  });
});

describe('a file both bookmarked in a channel and waiting with a scheduled message', () => {
  /** Bob uploads a file and schedules it into #proj; alice bookmarks it there before any message carries it. */
  async function heldTwice() {
    const { wsId } = await workspaceWith(alice, [bob]);
    const proj = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'proj' })).data.channel;
    expect((await as(bob).post(`/api/ws/${wsId}/channels/${proj.id}/join`)).ok).toBe(true);
    const file = await upload(bob, wsId);
    const sched = await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: proj.id, text: 'the spec, as promised', attachments: [{ id: file.id }], dueAt: Date.now() + 3600_000 });
    expect([sched.status, sched.data.scheduled.attachments]).toEqual([200, [{ id: file.id }]]);
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${proj.id}`, { bookmarks: [{ label: 'Spec', file: file.id }] })).ok).toBe(true);
    return { wsId, proj, file, entry: sched.data.scheduled };
  }

  it('stays for the bookmark when the scheduled message is deleted', async () => {
    const { wsId, file, entry } = await heldTwice();
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${entry.id}`)).ok).toBe(true);
    // The record and the bytes are still there, and the bookmark opens onto them.
    expect(await rt.kv.get(KEYS.file(file.id))).toMatchObject({ ws: wsId, u: bob.uuid });
    expect((await as(alice).get(`/api/ws/${wsId}/files/${file.id}`)).status).toBe(200);
  });

  it('stays for the scheduled message when the bookmark comes down, and goes out with it', async () => {
    const { wsId, proj, file, entry } = await heldTwice();
    expect((await as(alice).put(`/api/ws/${wsId}/channels/${proj.id}`, { bookmarks: [] })).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(file.id))).toMatchObject({ ws: wsId, u: bob.uuid });
    const sent = await as(bob).put(`/api/ws/${wsId}/scheduled/${entry.id}`, { sendNow: true });
    expect([sent.status, sent.data.sent]).toEqual([200, true]);
    const posted = (await as(alice).get(`/api/ws/${wsId}/conv/${proj.id}/messages`)).data.messages.find((m) => m.text === 'the spec, as promised');
    expect(posted.attachments.map((a) => a.id)).toEqual([file.id]);
    // Now carried by the message alone: deleting the message lets the file go, as ever.
    expect((await as(bob).del(`/api/ws/${wsId}/conv/${proj.id}/messages/${posted.seq}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(file.id))).toBeFalsy();
  });

  it('a scheduled file nothing else holds still goes with its message, as before', async () => {
    const { wsId } = await workspaceWith(alice, [bob]);
    const { general } = await (async () => ({ general: Object.values((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.channels).find((c) => c.name === 'general') }))();
    const file = await upload(bob, wsId);
    const sched = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', attachments: [{ id: file.id }], dueAt: Date.now() + 3600_000 })).data.scheduled;
    expect((await as(bob).del(`/api/ws/${wsId}/scheduled/${sched.id}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(file.id))).toBeFalsy();
  });
});

describe('a page head whose comments, scripts and styles carry tags of their own', () => {
  const at = (html) => parseHead(html, 'https://x.io/a/b');

  it('reads the live tags, not a commented-out block above them', () => {
    const page = '<html><head><!-- <title>Old title</title><meta property="og:image" content="/old.png"><meta name="description" content="stale"> -->'
      + '<title>New title</title><meta property="og:description" content="real words"><meta property="og:image" content="new.png"></head><body><title>body</title></body></html>';
    expect(at(page)).toEqual({ title: 'New title', desc: 'real words', site: 'x.io', image: 'https://x.io/a/new.png' });
  });

  it('passes over a title a script writes from a string, and one in a style comment', () => {
    expect(at('<head><script type="text/javascript">document.title = "<title>Scripted</title>";</script><title>Real</title></head>').title).toBe('Real');
    expect(at('<head><STYLE>/* <title>styled</title> */</STYLE><title>Real too</title></head>').title).toBe('Real too');
    // A </head> inside a script string is no end of the head.
    expect(at('<head><script>var s = "</head>";</script><meta property="og:title" content="Kept"></head>').title).toBe('Kept');
  });

  it('a comment or script left open hides the rest, as a browser reads it; an ordinary head is read as before', () => {
    expect(at('<head><title>Shown</title><!-- <title>Hidden</title>')).toMatchObject({ title: 'Shown' });
    expect(at('<head><script><title>Hidden</title>')).toMatchObject({ title: '' });
    expect(at('<head><meta property="og:title" content="A &amp; B"><meta property="og:image" content="//cdn.x.io/i.png"></head>')).toMatchObject({ title: 'A & B', image: 'https://cdn.x.io/i.png' });
  });

  it('reads a head built of thousands of comments and unclosed openers in linear time', () => {
    const comments = '<!-- x -->'.repeat(LIMITS.unfurlBodyBytes / 10);
    const scripts = '<script>'.repeat(LIMITS.unfurlBodyBytes / 8);
    const t0 = performance.now();
    expect(at(`${comments}<title>Late</title>`).title).toBe('Late');
    expect(at(`<title>First</title>${scripts}`).title).toBe('First');
    expect(at(`${'<!--'.repeat(LIMITS.unfurlBodyBytes / 4)}`).title).toBe('');
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('an import whose opening request is answered but whose answer is lost', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** The app's bridge to the (real) worker, with the opening request handled by `onFinish`. */
  const bridge = (onFinish) => ({ workers: { exec: async (url, init = {}) => {
    if (new URL(url).pathname.endsWith('/import/finish')) return onFinish(url, init);
    return rt.dispatch(url, init, alice);
  } } });
  /** An export of a small workspace, to be brought back under a fresh id on the same worker. */
  async function exported() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'carried across' })).ok).toBe(true);
    const ex = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    return { header: { ...ex.header, workspace: { ...ex.header.workspace, id: 'copylost001' } }, pages: ex.pages, files: ex.files };
  }

  it('keeps the copy the worker had opened and answers its reference, rather than taking it down', async () => {
    const archive = await exported();
    let finishes = 0;
    globalThis.puter = bridge(async (url, init) => {
      finishes++;
      await rt.dispatch(url, init, alice); // the worker opens the copy...
      throw new TypeError('Failed to fetch'); // ...and the answer never arrives
    });
    const ref = await importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Alice' } });
    expect([finishes, ref]).toEqual([1, 'copylost001@teamchat-new']);
    const doc = await rt.kv.get(KEYS.ws('copylost001'));
    expect(doc).toBeTruthy();
    expect(doc.importing).toBeUndefined();
    const gen = Object.values(doc.channels).find((c) => c.name === 'general');
    expect((await as(alice).get(`/api/ws/copylost001/conv/${gen.id}/messages`)).data.messages.some((m) => m.text === 'carried across')).toBe(true);
  });

  it('still takes down a copy whose opening never reached the worker', async () => {
    const archive = await exported();
    globalThis.puter = bridge(async () => { throw new TypeError('Failed to fetch'); });
    await expect(importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Alice' } })).rejects.toMatchObject({ code: 'network' });
    expect(await rt.kv.get(KEYS.ws('copylost001'))).toBeFalsy();
  });
});

describe('an import whose page or file request loses its answer', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** A page of the copy (`POST /api/ws/:ws/import`), not the creation (`POST /api/workspaces/import`). */
  const isPage = (path) => /^\/api\/ws\/[^/]+\/import$/.test(path);
  async function exported() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(bob, wsId);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'with the spec', attachments: [{ id: file.id }] })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'and words after it' })).ok).toBe(true);
    const ex = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    // Brought back under a fresh id; the file is read from the original, so it travels as a move's files do.
    return { wsId, file, archive: { header: { ...ex.header, workspace: { ...ex.header.workspace, id: 'copyretry01' } }, pages: ex.pages, files: ex.files } };
  }

  it('asks again after a lost answer, and the page and the file land once each', async () => {
    const { wsId, file, archive } = await exported();
    // The original's file is not the copy's on the same worker: the archive's file id is
    // renamed so the copy takes it as its own (as it does on another server).
    const FILE = 'copiedfile01';
    const renamed = JSON.parse(JSON.stringify(archive).split(file.id).join(FILE));
    let blobs = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === `/api/ws/${wsId}/files/${FILE}`) { blobs++; return rt.dispatch(url.replace(FILE, file.id), init, alice); }
      return rt.dispatch(url, init, alice);
    } } };
    // Every page and the file lose their first answer: once as the connection dropping, once as the address answering nothing.
    const base = globalThis.puter.workers.exec;
    const lost = {};
    globalThis.puter.workers.exec = async (url, init) => {
      const path = new URL(url).pathname;
      const res = await base(url, init);
      const kind = path.endsWith('/import/file') ? 'file' : isPage(path) ? `page:${JSON.parse(init.body).conv}` : null;
      if (kind && !lost[kind]) {
        lost[kind] = true;
        if (kind === 'file') return new Response('', { status: 404 });
        throw new TypeError('Failed to fetch');
      }
      return res;
    };
    const ref = await importArchive('https://teamchat-new.puter.work', renamed, { from: `${wsId}@teamchat-old`, fromRef: `${wsId}@teamchat-old`, profile: { name: 'Alice' }, pause: 1 });
    expect(ref).toBe('copyretry01@teamchat-new');
    expect(Object.keys(lost).length).toBeGreaterThanOrEqual(2);
    const doc = await rt.kv.get(KEYS.ws('copyretry01'));
    expect(doc.importing).toBeUndefined();
    const gen = Object.values(doc.channels).find((c) => c.name === 'general');
    const msgs = (await as(alice).get(`/api/ws/copyretry01/conv/${gen.id}/messages`)).data.messages.filter((m) => m.kind === 'msg');
    // Each message once, in order; the file once on its message, held once.
    expect(msgs.map((m) => m.text)).toEqual(['with the spec', 'and words after it']);
    expect(msgs[0].attachments.map((a) => a.id)).toEqual([FILE]);
    expect(await rt.kv.get(KEYS.file(FILE))).toMatchObject({ ws: 'copyretry01', refs: 1, cs: { [gen.id]: 1 } });
    expect(blobs).toBe(2);
  });

  it('gives up after its tries, and takes the copy down as before; a refusal is not asked again', async () => {
    const { archive } = await exported();
    let pages = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      if (isPage(new URL(url).pathname)) { pages++; throw new TypeError('Failed to fetch'); }
      return rt.dispatch(url, init, alice);
    } } };
    await expect(importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Alice' }, pause: 1 })).rejects.toMatchObject({ code: 'network' });
    expect(pages).toBe(3);
    expect(await rt.kv.get(KEYS.ws('copyretry01'))).toBeFalsy();
    // A page the worker refuses (a direct message none of the copy's members are in is passed over; a channel refused stops the import) is answered as before, at once.
    let asked = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      if (isPage(new URL(url).pathname)) { asked++; return new Response(JSON.stringify({ code: 'invalid', message: 'Bad conversation id' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      return rt.dispatch(url, init, alice);
    } } };
    await expect(importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Alice' }, pause: 1 })).rejects.toMatchObject({ code: 'invalid' });
    expect(asked).toBe(1);
  });
});

describe('an import whose creating request loses its answer', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const isCreate = (path) => path === '/api/workspaces/import';
  async function exported(id) {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'kept through the loss' })).ok).toBe(true);
    const ex = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    return { header: { ...ex.header, workspace: { ...ex.header.workspace, id } }, pages: ex.pages, files: ex.files };
  }
  const listed = async (id) => ((await rt.kv.get(KEYS.user(alice.uuid)))?.workspaces || []).filter((w) => w === id).length;

  it('goes on into the copy that request made, rather than leaving it behind and failing', async () => {
    const archive = await exported('copystub001');
    let created = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const res = await rt.dispatch(url, init, alice);
      if (isCreate(new URL(url).pathname)) { created++; throw new TypeError('Failed to fetch'); } // made, and the answer lost
      return res;
    } } };
    const made = [];
    const ref = await importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Alice' }, pause: 1, onCreated: (r) => made.push(r) });
    expect([ref, created, made]).toEqual(['copystub001@teamchat-new', 1, ['copystub001@teamchat-new']]);
    const doc = await rt.kv.get(KEYS.ws('copystub001'));
    expect(doc.importing).toBeUndefined();
    const gen = Object.values(doc.channels).find((c) => c.name === 'general');
    expect((await as(alice).get(`/api/ws/copystub001/conv/${gen.id}/messages`)).data.messages.some((m) => m.text === 'kept through the loss')).toBe(true);
    // One copy, listed once on the importer's record; no stub beside it.
    expect(await listed('copystub001')).toBe(1);
    expect((await as(alice).get('/api/me')).data.workspaces.filter((w) => w.name === 'Acme')).toHaveLength(2); // the original and the copy
  });

  it('asks once more where the request never reached the worker; a refusal is not asked again', async () => {
    const archive = await exported('copystub002');
    let attempts = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      if (isCreate(new URL(url).pathname) && attempts++ === 0) throw new TypeError('Failed to fetch'); // never arrived
      return rt.dispatch(url, init, alice);
    } } };
    const ref = await importArchive('https://teamchat-new.puter.work', archive, { profile: { name: 'Alice' }, pause: 1 });
    expect([ref, attempts]).toEqual(['copystub002@teamchat-new', 2]);
    expect((await rt.kv.get(KEYS.ws('copystub002'))).importing).toBeUndefined();
    let refused = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      if (isCreate(new URL(url).pathname)) { refused++; return new Response(JSON.stringify({ code: 'invalid', message: 'That is not a Teamchat export' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }
      return rt.dispatch(url, init, alice);
    } } };
    await expect(importArchive('https://teamchat-new.puter.work', await exported('copystub003'), { profile: { name: 'Alice' }, pause: 1 })).rejects.toMatchObject({ code: 'invalid' });
    expect(refused).toBe(1);
  });
});

describe('a search index built on the current layout before the CJK tokenizer', () => {
  // The layout (SEARCH_VERSION 3: month buckets sharded by token, a log, a
  // meta document) did not change with the tokenizer; what a posting is
  // filed under did. An index built before it holds a run of ideographs or
  // kana as one token, where the tokenizer now writes and asks for its
  // overlapping pairs. SEARCH_VERSION was deliberately left at 3 (a bump
  // would read every existing index as the legacy layout it is not).
  it('still answers a Latin query as it is, and answers a CJK query once an admin rebuilds', async () => {
    expect(SEARCH_VERSION).toBe(3);
    const { wsId, general } = await workspaceWith(alice, []);
    const seqs = [];
    const ordinal = ['one', 'two', 'three'];
    for (const n of [0, 1, 2]) seqs.push((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `サーバーが落ちた after deploy ${ordinal[n]}` })).data.message.seq);
    // What the live posts wrote is replaced by what the old tokenizer would have
    // written, one message filed under each of three months (two are as many as
    // one rebuild step drops).
    const months = ['202601', '202602', '202603'];
    const live = bucketOf((await as(alice).get(`/api/ws/${wsId}/conv/${general.id}/messages`)).data.messages.at(-1).ts);
    const wipe = [KEYS.searchMeta(wsId), ...[0, 1, 2, 3].map((s) => KEYS.searchLog(wsId, s))];
    for (const b of [live, ...months]) for (let n = 0; n < SEARCH_SHARDS; n++) wipe.push(KEYS.searchBucket(wsId, b, n));
    for (const k of wipe) await rt.kv.del(k);
    for (let i = 0; i < months.length; i++) {
      const b = months[i];
      const oldTokens = ['サーバーが落ちた', 'after', 'deploy', ordinal[i], authorToken(alice.uuid), scopedToken(authorToken(alice.uuid), general.id)];
      const posting = encodePosting(general.id, seqs[i], Date.UTC(Number(b.slice(0, 4)), Number(b.slice(4)) - 1, 15));
      const byShard = {};
      for (const t of oldTokens) (byShard[shardOf(t)] ||= {})[t] = [posting];
      for (const [n, doc] of Object.entries(byShard)) await rt.kv.set(KEYS.searchBucket(wsId, b, n), doc);
    }
    await rt.kv.set(KEYS.searchMeta(wsId), { c: 0, folded: -1, failed: 0, months: Object.fromEntries(months.map((b) => [b, 1])) });
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.search.v).toBe(3);
    const hits = async (q) => (await as(alice).get(`/api/ws/${wsId}/search?q=${encodeURIComponent(q)}`)).data.results.map((r) => r.seq).sort();
    // Latin words are found from the old postings; the CJK words are not,
    // whether asked for as a word (now pairs, which the old index never held)
    // or as the whole clause (which the tokenizer no longer makes a term of).
    expect(await hits('deploy')).toEqual(seqs);
    expect(await hits('サーバー')).toEqual([]);
    expect(await hits('サーバーが落ちた')).toEqual([]);
    // The rebuild: its first step drops two of the three months and hands back
    // its state. A reader in between still finds the message filed under the
    // month not yet dropped (from its old postings; the layout under them has
    // not changed), and no longer the two whose months are gone, until the
    // walk that follows the drops re-files them.
    let r = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null })).data;
    expect([r.done, r.progress.clearing]).toEqual([false, 1]);
    expect(await hits('deploy')).toEqual([seqs[2]]);
    let guard = 0;
    while (!r.done && guard++ < 20) r = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: r.state })).data;
    expect(r.done).toBe(true);
    // Rebuilt: the CJK words are found by their pairs, the Latin ones as before,
    // the whole clause by its pairs too; the old months are gone from the index.
    expect(await hits('deploy')).toEqual(seqs);
    expect(await hits('サーバー')).toEqual(seqs);
    expect(await hits('サーバーが落ちた')).toEqual(seqs);
    expect(await hits('落ちた deploy two')).toEqual([seqs[1]]);
    const meta = await rt.kv.get(KEYS.searchMeta(wsId));
    expect(Object.keys(meta.months)).toEqual([live]);
    expect((await as(alice).get(`/api/ws/${wsId}`)).data.workspace.search.v).toBe(3);
  });
});

describe('an archive page whose messages are out of order, or name a number twice', () => {
  it('stamps the conversation with its newest message, and keeps one record per number', async () => {
    const CH = 'chorder0001';
    const t = (n) => Date.UTC(2026, 0, 1, 12, n);
    await restore('wsorder0001', CH, { seq: 3, messages: [
      { seq: 3, user: bob.uuid, text: 'third, written first in the file', ts: t(3), kind: 'msg' },
      { seq: 1, user: alice.uuid, text: 'first', ts: t(1), kind: 'msg' },
      { seq: 2, user: alice.uuid, text: 'second', ts: t(2), kind: 'msg' },
      { seq: 2, user: bob.uuid, text: 'second, again', ts: t(2) + 5, kind: 'msg' },
    ] });
    // The sidebar and the DMs pane read who wrote last, and when, from here.
    expect((await rt.kv.get(KEYS.activity('wsorder0001'))).c[CH]).toMatchObject({ s: 3, t: t(3), u: bob.uuid });
    const msgs = (await as(alice).get(`/api/ws/wsorder0001/conv/${CH}/messages`)).data.messages;
    expect(msgs.map((m) => [m.seq, m.text])).toEqual([[1, 'first'], [2, 'second'], [3, 'third, written first in the file']]);
  });
});
