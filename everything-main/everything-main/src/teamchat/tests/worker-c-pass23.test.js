/**
 * Twenty-third review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS } from '../src/shared/blocks.js';
import { exportWorkspace, writeArchiveToDrive } from '../src/lib/archive.js';
import { readCapped } from '../worker/unfurl.js';

const { alice, bob, carol } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

/** Upload a small file as `who` into the workspace; answers the file record the route hands back. */
async function upload(who, wsId, name = 'spec.pdf', type = 'application/pdf') {
  const fd = new FormData();
  fd.append('file', new File([new Uint8Array([1, 2, 3, 4])], name, { type }));
  const res = await as(who).post(`/api/ws/${wsId}/files`, fd);
  expect(res.status).toBe(200);
  return res.data;
}

/**
 * Count the store's round trips: a call that begins while no other is
 * pending starts a new one; calls in flight together are one (the shape
 * getMany and the twelve-wide writes take). `dump()` answers the count and
 * the ordered calls (method and key) since the last dump; a batched read
 * counts as one round trip and logs each of its keys.
 */
function storeRounds() {
  const kv = rt.kv;
  const orig = {};
  let pending = 0;
  let rounds = 0;
  let log = [];
  for (const m of ['get', 'set', 'del', 'incr', 'add', 'update', 'remove', 'expire']) {
    if (typeof kv[m] !== 'function') continue;
    orig[m] = kv[m];
    kv[m] = async (k, ...rest) => {
      if (pending === 0) rounds++;
      pending++;
      // A batched read (`kv.get([...])`) is one round trip carrying many
      // keys: logged a line per key, so what was read still reads the same.
      for (const one of Array.isArray(k) ? k : [k]) log.push(`${m} ${one}`);
      try {
        return await orig[m].call(kv, k, ...rest);
      } finally {
        pending--;
      }
    };
  }
  return {
    dump: () => { const out = { rounds, log }; rounds = 0; log = []; return out; },
    restore: () => { for (const m of Object.keys(orig)) kv[m] = orig[m]; },
  };
}

/** An archive header for one channel, alice its owner, both alice and bob in the channel. */
const headerFor = (wsId, ch) => ({
  format: 'teamchat-export', version: 1, workspace: { id: wsId, name: 'Acme' },
  channels: { [ch]: { id: ch, name: 'general', def: true } },
  members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
  memberDocs: { [alice.uuid]: { channels: [ch] }, [bob.uuid]: { channels: [ch] } },
});

/** The app's bridge to the (real) worker as alice, with `hook` given each request first: what it returns stands for the answer, and what it throws is the failure the app sees. */
function bridge(hook = null) {
  const exec = async (url, init = {}) => {
    const out = hook ? await hook(new URL(url).pathname + new URL(url).search, url, init) : undefined;
    return out === undefined ? rt.dispatch(url, init, alice) : out;
  };
  return { workers: { exec } };
}

describe('an export whose page loses its answer', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** A workspace whose export takes more than one page: a dozen channels beyond the defaults, each with its opening line. */
  async function wide() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (let i = 0; i < 12; i++) expect((await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'the last word' })).ok).toBe(true);
    return wsId;
  }
  const isPage = (path) => /^\/api\/ws\/[^/]+\/export\?cursor=/.test(path);
  const isFirst = (path) => /^\/api\/ws\/[^/]+\/export$/.test(path);

  it('asks for the page again, and the archive is whole; the first page too', async () => {
    const wsId = await wide();
    let plain = 0;
    globalThis.puter = bridge(() => { plain++; });
    const whole = await exportWorkspace(`${wsId}@teamchat-old`);
    expect(whole.pages.length).toBeGreaterThan(12);
    expect(plain).toBeGreaterThan(1);
    // The connection drops once on the first page and once on a later one.
    const lost = { first: false, page: false };
    let asked = 0;
    globalThis.puter = bridge((path) => {
      asked++;
      if (isFirst(path) && !lost.first) { lost.first = true; throw new TypeError('Failed to fetch'); }
      if (isPage(path) && !lost.page) { lost.page = true; throw new TypeError('Failed to fetch'); }
    });
    const seen = [];
    const archive = await exportWorkspace(`${wsId}@teamchat-old`, { pause: 1, onProgress: (p) => seen.push(p) });
    expect(lost).toEqual({ first: true, page: true });
    expect(archive.pages.map((p) => [p.conv, p.messages.length]).sort()).toEqual(whole.pages.map((p) => [p.conv, p.messages.length]).sort());
    expect(archive.header.channels).toEqual(whole.header.channels);
    // Two requests more than the pages themselves took, and no progress report went backwards.
    expect(asked).toBe(plain + 2);
    expect(seen.every((p, i) => i === 0 || p.done >= seen[i - 1].done)).toBe(true);
  });

  it('gives up after its tries, and a refusal (an expired export) is answered at once', async () => {
    const wsId = await wide();
    let pages = 0;
    globalThis.puter = bridge((path) => {
      if (isPage(path)) { pages++; throw new TypeError('Failed to fetch'); }
    });
    await expect(exportWorkspace(`${wsId}@teamchat-old`, { pause: 1 })).rejects.toMatchObject({ code: 'network' });
    expect(pages).toBe(3);
    let refused = 0;
    globalThis.puter = bridge((path) => {
      if (isPage(path)) { refused++; return new Response(JSON.stringify({ code: 'expired', message: 'This export has expired; start it again' }), { status: 410, headers: { 'Content-Type': 'application/json' } }); }
    });
    await expect(exportWorkspace(`${wsId}@teamchat-old`, { pause: 1 })).rejects.toMatchObject({ code: 'expired' });
    expect(refused).toBe(1);
  });

  it('a move stopped by another session is not asked again', async () => {
    const wsId = await wide();
    let pages = 0;
    globalThis.puter = bridge((path) => {
      if (isPage(path)) { pages++; throw new TypeError('Failed to fetch'); }
    });
    const stop = new Error('taken over');
    let checks = 0;
    await expect(exportWorkspace(`${wsId}@teamchat-old`, { pause: 1, check: () => { if (++checks > 2) throw stop; } })).rejects.toBe(stop);
    expect(pages).toBe(1);
  });
});

describe('an export whose attachment loses its answer on the way to the drive', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  async function withFile() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const file = await upload(bob, wsId);
    expect((await as(bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'with the spec', attachments: [{ id: file.id }] })).ok).toBe(true);
    globalThis.puter = bridge();
    const archive = await exportWorkspace(`${wsId}@teamchat-old`);
    expect(archive.files.map((f) => f.id)).toEqual([file.id]);
    return { wsId, file, archive };
  }
  const isFile = (path) => /^\/api\/ws\/[^/]+\/files\//.test(path);
  /** A drive that takes every write and remembers it. */
  const drive = (written) => ({ write: async (path, blob) => { written.push([path, blob.size]); return { path }; } });

  it('asks for the bytes again, and the file is in the folder, not counted missing', async () => {
    const { wsId, archive } = await withFile();
    const written = [];
    let lost = 0;
    globalThis.puter = { ...bridge((path) => {
      if (isFile(path) && !lost) { lost++; throw new TypeError('Failed to fetch'); }
    }), fs: drive(written) };
    const reports = [];
    const folder = await writeArchiveToDrive(`${wsId}@teamchat-old`, archive, { pause: 1, onProgress: (p) => reports.push(p) });
    expect(lost).toBe(1);
    expect(written.filter(([p]) => p.startsWith(`${folder}/files/`))).toEqual([[`${folder}/files/${archive.files[0].id}-spec.pdf`, 4]]);
    expect(reports[reports.length - 1]).toMatchObject({ phase: 'files', done: 1, total: 1, missing: 0 });
  });

  it('bytes gone from the server are counted missing at once, as before, and so is a drive that refuses the write', async () => {
    const { wsId, archive } = await withFile();
    const written = [];
    let asked = 0;
    globalThis.puter = { ...bridge((path) => {
      if (isFile(path)) { asked++; return new Response(JSON.stringify({ code: 'not_found', message: 'File not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } }); }
    }), fs: drive(written) };
    const reports = [];
    await writeArchiveToDrive(`${wsId}@teamchat-old`, archive, { pause: 1, onProgress: (p) => reports.push(p) });
    expect(asked).toBe(1);
    expect(written.some(([p]) => p.includes('/files/'))).toBe(false);
    expect(reports[reports.length - 1]).toMatchObject({ phase: 'files', done: 1, total: 1, missing: 1 });
    // The drive refusing the bytes is no lost answer: the file is asked for once, and counted missing.
    let fetched = 0;
    globalThis.puter = { ...bridge((path) => { if (isFile(path)) fetched++; }), fs: { write: async (path) => { if (path.includes('/files/')) throw { code: 'storage_limit_reached' }; return { path }; } } };
    const again = [];
    await writeArchiveToDrive(`${wsId}@teamchat-old`, archive, { pause: 1, onProgress: (p) => again.push(p) });
    expect(fetched).toBe(1);
    expect(again[again.length - 1]).toMatchObject({ phase: 'files', done: 1, total: 1, missing: 1 });
  });
});

describe('a page head whose comments or scripts name a charset', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const utf8 = (s) => new TextEncoder().encode(s);
  const latin = (before, after) => new Uint8Array([...utf8(`<html><head>${before}<title>Caf`), 0xe9, ...utf8(` du coin</title>${after}</head></html>`)]);
  const site = () => {
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
      // A page in utf-8 whose head keeps an old charset in a comment above the live one, or writes one from a script.
      if (u.pathname === '/commented') return html(utf8('<html><head><!-- <meta charset="windows-1252"> --><meta charset="utf-8"><title>Café du coin</title></head></html>'));
      if (u.pathname === '/scripted') return html(utf8('<html><head><script>document.write(\'<meta charset="windows-1252">\')</script><meta charset="utf-8"><title>Café du coin</title></head></html>'));
      // The other way about: a page in windows-1252 with a commented-out utf-8 declaration above its own.
      if (u.pathname === '/commented-latin') return html(latin('<!-- <meta charset="utf-8"> --><meta charset="windows-1252">', ''));
      return new Response('not found', { status: 404 });
    };
  };
  const card = async (path) => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `see https://docs.example.com/${path}` })).data.message;
    return (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl;
  };

  it('is decoded as its live declaration says, not as a commented-out or scripted one', async () => {
    site();
    for (const path of ['commented', 'scripted', 'commented-latin']) {
      expect((await card(path))?.title, path).toBe('Café du coin');
    }
  });
});

describe('a page whose head carries "</head>" inside a comment or a script before its live tags', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  /** A page whose body arrives in so many pieces, as a page longer than one packet does. */
  const streamed = (chunks) => new Response(new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  const live = '<meta property="og:title" content="Live title"><meta property="og:description" content="What stands"></head><body>words</body></html>';

  it('is read on to its real end when the pieces arrive apart, and gets its card', async () => {
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname === '/commented') return streamed(['<html><head><!-- old template: </head></html> -->', live]);
      if (u.pathname === '/scripted') return streamed(['<html><head><script>document.write("</head>")</script>', live]);
      if (u.pathname === '/whole') return streamed([`<html><head><!-- old template: </head></html> -->${live}`]);
      return new Response('not found', { status: 404 });
    };
    const { wsId, general } = await workspaceWith(alice, [bob]);
    for (const path of ['commented', 'scripted', 'whole']) {
      const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `see https://docs.example.com/${path}` })).data.message;
      const card = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}/unfurl`)).data.unfurl;
      expect(card, path).toMatchObject({ title: 'Live title', desc: 'What stands' });
    }
  });

  it('readCapped stops where a function of the text so far says, and reads no further', async () => {
    const seen = [];
    const { text, truncated } = await readCapped(streamed(['<head><!-- </head> -->', '<title>T</title></head>', '<body>'.repeat(50)]), 100_000, (s) => {
      seen.push(s.length);
      return /<\/head\s*>/i.test(s.replace(/<!--[\s\S]*?-->/g, ''));
    });
    expect(text).toBe('<head><!-- </head> --><title>T</title></head>');
    expect(truncated).toBe(false);
    expect(seen).toHaveLength(2);
  });
});

describe('an export and an index rebuild over hundreds of empty conversations', () => {
  /** Count the store's round trips: a read that begins while no other is pending starts a new one; reads in flight together are one. */
  function rounds() {
    const kv = rt.kv;
    const orig = kv.get;
    let pending = 0;
    let n = 0;
    kv.get = async (...a) => {
      if (pending === 0) n++;
      pending++;
      try {
        return await orig.apply(kv, a);
      } finally {
        pending--;
      }
    };
    return { count: () => n, restore: () => { kv.get = orig; } };
  }
  /** A workspace with one message in #general and three hundred direct messages opened and never written in. */
  async function withEmpties() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'quiet workspace' })).ok).toBe(true);
    const dms = {};
    for (let i = 0; i < 300; i++) dms[`dm_quiet${String(i).padStart(4, '0')}`] = { members: [alice.uuid, bob.uuid], createdAt: Date.now() };
    await rt.kv.update(KEYS.member(wsId, alice.uuid), { dms });
    return { wsId, general };
  }

  it('the export reads their counters a dozen at a time and hands back a cursor after so many, so no one request runs long; the archive is whole', async () => {
    const { wsId, general } = await withEmpties();
    const r = rounds();
    const perPage = [];
    let res = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    perPage.push(r.count());
    const pages = [...res.pages];
    let guard = 0;
    while (!res.done && guard++ < 50) {
      const before = r.count();
      res = (await as(alice).get(`/api/ws/${wsId}/export?cursor=${encodeURIComponent(JSON.stringify(res.cursor))}`)).data;
      perPage.push(r.count() - before);
      pages.push(...res.pages);
    }
    r.restore();
    expect(res.done).toBe(true);
    expect(res.progress).toEqual({ done: 301, total: 301 });
    // Three hundred empty conversations used to cost the first request over three hundred round trips in a row; a page passes over a hundred and twenty and hands back.
    expect(perPage.length).toBe(3);
    expect(Math.max(...perPage)).toBeLessThan(60);
    expect(pages.filter((p) => p.messages.length).map((p) => [p.conv, p.messages.at(-1).text])).toEqual([[general.id, 'quiet workspace']]);
  });

  it('the rebuild reads them the same way, and the index it builds answers', async () => {
    const { wsId } = await withEmpties();
    const r = rounds();
    const perStep = [];
    let step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null })).data;
    perStep.push(r.count());
    let guard = 0;
    while (!step.done && guard++ < 50) {
      const before = r.count();
      step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: step.state })).data;
      perStep.push(r.count() - before);
    }
    r.restore();
    expect(step.done).toBe(true);
    expect(step.progress).toMatchObject({ done: 301, total: 301, messages: 1 });
    expect(perStep.length).toBe(3);
    expect(Math.max(...perStep)).toBeLessThan(40);
    const found = (await as(alice).get(`/api/ws/${wsId}/search?q=quiet`)).data;
    expect(found.results.map((m) => m.text)).toEqual(['quiet workspace']);
  });
});

describe('an import page of four hundred messages', () => {
  const CH = 'chpageperf1';
  const WS = 'wspageperf01';
  const page = (from, to) => {
    const messages = [];
    for (let s = from; s <= to; s++) messages.push({ seq: s, user: alice.uuid, text: `line ${s}`, ts: Date.UTC(2026, 0, 1) + s, kind: 'msg', ...(s % 100 === 0 ? { attachments: [{ id: `pagefile00${s / 100}`, name: 'f.pdf', size: 4, type: 'application/pdf' }] } : {}) });
    return { conv: CH, seq: 400, messages };
  };

  it('reads and writes its eight blocks together, half the round trips it took, and lands the same', async () => {
    expect((await as(alice).post('/api/workspaces/import', { header: headerFor(WS, CH), profile: { name: 'Alice' } })).status).toBe(200);
    const r = storeRounds();
    let first;
    try {
      expect((await as(alice).post(`/api/ws/${WS}/import`, page(1, 400))).ok).toBe(true);
      first = r.dump();
      // The same page again lands nothing new, at the same cost.
      expect((await as(alice).post(`/api/ws/${WS}/import`, page(1, 400))).ok).toBe(true);
    } finally {
      r.restore();
    }
    // Thirty-two round trips before (a read and a write per block, one block after the other, and two for the four files); the blocks now go in one read and one twelve-wide write.
    expect(first.rounds).toBeLessThanOrEqual(18);
    // Each of the page's eight blocks read once, and the block made ahead once (see ensureBlock).
    expect(first.log.filter((l) => l.startsWith(`get ${KEYS.block(CH, 0).slice(0, -1)}`))).toHaveLength(9);
    expect(await rt.kv.get(KEYS.seq(CH))).toBe(400);
    for (let n = 0; n < 8; n++) expect((await rt.kv.get(KEYS.block(CH, n))).m.map((m) => m.s)).toEqual(Array.from({ length: 50 }, (_, i) => n * 50 + i + 1));
    expect(await rt.kv.get(KEYS.block(CH, 8))).toEqual({ m: [], x: {} });
    for (let k = 1; k <= 4; k++) expect(await rt.kv.get(KEYS.file(`pagefile00${k}`))).toMatchObject({ refs: 1, cs: { [CH]: 1 } });
    expect((await as(alice).post(`/api/ws/${WS}/import/finish`)).ok).toBe(true);
    const shown = (await as(alice).get(`/api/ws/${WS}/conv/${CH}/messages?from=395&to=400`)).data.messages;
    expect(shown.map((m) => m.text)).toEqual(['line 395', 'line 396', 'line 397', 'line 398', 'line 399', 'line 400']);
  });
});

describe('a copy of a live workspace restored beside it on the same server', () => {
  it('draws and checks fresh ids for every channel in use together, rather than two reads each in a row', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const rooms = [];
    for (let i = 0; i < 12; i++) rooms.push((await as(alice).post(`/api/ws/${wsId}/channels`, { name: `room-${i}` })).data.channel.id);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'still here' })).ok).toBe(true);
    const ex = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    const header = { ...ex.header, workspace: { ...ex.header.workspace, id: 'wscopyside01' } };
    const r = storeRounds();
    let made;
    try {
      made = await as(alice).post('/api/workspaces/import', { header, profile: { name: 'alice' } });
    } finally {
      r.restore();
    }
    expect(made.status).toBe(200);
    const { rounds, log } = r.dump();
    // Forty-three round trips before, twenty-six of them the thirteen channels' fresh ids checked one after another (a block and a counter each).
    expect(rounds).toBeLessThanOrEqual(22);
    const copy = await rt.kv.get(KEYS.ws('wscopyside01'));
    const originals = new Set([general.id, ...rooms]);
    const ids = Object.keys(copy.channels);
    expect(ids).toHaveLength(13);
    expect(ids.some((id) => originals.has(id))).toBe(false);
    expect(new Set(ids).size).toBe(13);
    expect(Object.keys(copy.importMap).sort()).toEqual([...originals].sort());
    // Each fresh id was checked for use here, none twice.
    const checked = log.filter((l) => /^get tc:conv:[a-z0-9]+:seq$/.test(l)).map((l) => l.split(':')[2]);
    expect(new Set(checked).size).toBe(checked.length);
    for (const id of ids) expect(checked).toContain(id);
    // The copy takes its pages under the fresh ids and opens.
    for (const page of ex.pages) expect((await as(alice).post('/api/ws/wscopyside01/import', { conv: page.conv, seq: page.seq, messages: page.messages })).ok).toBe(true);
    expect((await as(alice).post('/api/ws/wscopyside01/import/finish')).ok).toBe(true);
    const gen2 = ids.find((id) => copy.channels[id].name === 'general');
    expect((await as(alice).get(`/api/ws/wscopyside01/conv/${gen2}/messages`)).data.messages.some((m) => m.text === 'still here')).toBe(true);
  });
});

describe('the admin\'s own record on the export\'s first page and the rebuild\'s first step', () => {
  it('is read once, with their membership, not again among everyone\'s', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob, carol]);
    expect((await as(alice).post(`/api/ws/${wsId}/dms`, { members: [bob.uuid] })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'once' })).ok).toBe(true);
    const mine = `get ${KEYS.member(wsId, alice.uuid)}`;
    const r = storeRounds();
    let ex;
    let step;
    try {
      ex = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
      const first = r.dump();
      expect(first.log.filter((l) => l === mine)).toHaveLength(1);
      expect(first.log.filter((l) => l === `get ${KEYS.member(wsId, bob.uuid)}`)).toHaveLength(1);
      step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null })).data;
      const rebuild = r.dump();
      expect(rebuild.log.filter((l) => l === mine)).toHaveLength(1);
    } finally {
      r.restore();
    }
    // Both still see the admin's direct message, which lives in that record alone.
    const dm = Object.keys(ex.header.memberDocs[alice.uuid].dms);
    expect(dm).toHaveLength(1);
    expect(ex.header.dms[dm[0]].members.sort()).toEqual([alice.uuid, bob.uuid].sort());
    expect(step.progress.total).toBe(Object.keys(ex.header.channels).length + 1);
  });
});

describe('the first step of a search index rebuild', () => {
  const legacyShard = (wsId) => new RegExp(`^del tc:ws:${wsId}:idx:\\d+$`);

  it('does not delete the sixty-four shards of the older layout for an index built on this one, and still does for one that was not', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'rebuilt words' })).ok).toBe(true);
    const r = storeRounds();
    try {
      let step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null })).data;
      const fresh = r.dump();
      // Twenty-two round trips before, six of them deleting keys that could not be there.
      expect(fresh.log.filter((l) => legacyShard(wsId).test(l))).toHaveLength(0);
      expect(fresh.rounds).toBeLessThanOrEqual(16);
      while (!step.done) step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: step.state })).data;
      r.dump();
      // An index from before month buckets (its stamp says so) has its shards taken down as before.
      await rt.kv.update(KEYS.ws(wsId), { 'search.v': 2 });
      await rt.kv.set(`tc:ws:${wsId}:idx:5`, { words: ['x:1:1'] });
      r.dump();
      step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: null })).data;
      const old = r.dump();
      expect(old.log.filter((l) => legacyShard(wsId).test(l))).toHaveLength(64);
      expect(await rt.kv.get(`tc:ws:${wsId}:idx:5`)).toBeFalsy();
      while (!step.done) step = (await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state: step.state })).data;
    } finally {
      r.restore();
    }
    expect((await as(alice).get(`/api/ws/${wsId}/search?q=rebuilt`)).data.results.map((m) => m.text)).toEqual(['rebuilt words']);
    expect((await rt.kv.get(KEYS.ws(wsId))).search.v).toBeGreaterThanOrEqual(3);
  });
});

describe('a download of an attachment or a preview\'s picture', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('costs a member the workspace and the file\'s record alone; a guest\'s record is read beside the file\'s, and judges them as before', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const priv = (await as(alice).post(`/api/ws/${wsId}/channels`, { name: 'clients', private: true })).data.channel;
    const inv = (await as(alice).post(`/api/ws/${wsId}/channels/${priv.id}/invites`, {})).data;
    expect((await as(carol).post('/api/join', { code: inv.code })).ok).toBe(true); // a guest of #clients
    const file = await upload(alice, wsId);
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'for members', attachments: [{ id: file.id }] })).ok).toBe(true);
    const shared = await upload(alice, wsId, 'brief.txt', 'text/plain');
    expect((await as(alice).post(`/api/ws/${wsId}/conv/${priv.id}/messages`, { text: 'for the guest', attachments: [{ id: shared.id }] })).ok).toBe(true);
    globalThis.fetch = async (url) => (String(url).endsWith('/pic.png')
      ? new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } })
      : new Response('<html><head><title>P</title><meta property="og:image" content="/pic.png"></head></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    const linked = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'https://docs.example.com/p' })).data.message;
    const card = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages/${linked.seq}/unfurl`)).data.unfurl;
    expect(card.image).toMatch(/^[0-9a-f]{64}$/);
    const r = storeRounds();
    try {
      // Three reads before (the workspace, the member's own record, the file); two now.
      expect((await as(bob).get(`/api/ws/${wsId}/files/${file.id}`)).status).toBe(200);
      const member = r.dump();
      expect(member.log).toEqual([`get ${KEYS.ws(wsId)}`, `get ${KEYS.file(file.id)}`]);
      expect((await as(bob).get(`/api/ws/${wsId}/unfurl-image/${card.image}`)).status).toBe(200);
      const picture = r.dump();
      expect(picture.log).toEqual([`get ${KEYS.ws(wsId)}`, `get tc:unfurlimg:${card.image}`]);
      // A guest: their record read with the file's, in one round; served what is shared where they read, refused the rest, as before.
      expect((await as(carol).get(`/api/ws/${wsId}/files/${shared.id}`)).status).toBe(200);
      const guest = r.dump();
      expect(guest.log.sort()).toEqual([`get ${KEYS.file(shared.id)}`, `get ${KEYS.member(wsId, carol.uuid)}`, `get ${KEYS.ws(wsId)}`].sort());
      expect(guest.rounds).toBe(2);
      expect((await as(carol).get(`/api/ws/${wsId}/files/${file.id}`)).status).toBe(404);
      // Someone outside the workspace is refused as before.
      expect((await as(USERS.dave).get(`/api/ws/${wsId}/files/${file.id}`)).status).toBe(403);
      expect((await as(USERS.dave).get(`/api/ws/${wsId}/unfurl-image/${card.image}`)).status).toBe(403);
    } finally {
      r.restore();
    }
  });
});

describe('the attachments of an export written to the drive', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** A drive that takes a moment over each write and remembers how many were in flight together, and in what order they began and ended. */
  const drive = () => {
    const events = [];
    let inFlight = 0;
    let most = 0;
    const fs = { write: async (path, blob) => {
      if (path.includes('/files/') && blob.size === 0) throw { code: 'storage_limit_reached' };
      inFlight++;
      most = Math.max(most, inFlight);
      events.push(`start ${path.split('/').pop()}`);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      events.push(`end ${path.split('/').pop()}`);
      return { path };
    } };
    return { fs, events, most: () => most };
  };

  it('go a few at a time once the folder stands, the first alone, with the missing counted and the progress reported as before', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const files = [];
    for (let i = 0; i < 9; i++) files.push(await upload(alice, wsId, `pic-${i}.png`, 'image/png'));
    for (const f of files) expect((await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `see ${f.name}`, attachments: [{ id: f.id }] })).ok).toBe(true);
    globalThis.puter = bridge();
    const archive = await exportWorkspace(`${wsId}@teamchat-old`);
    expect(archive.files).toHaveLength(9);
    // The fourth file's bytes are gone from the server; the fifth's the drive refuses (its bytes are empty here). Both fall in the second batch, so the third goes whole.
    const gone = files[3].id;
    const refused = files[4].id;
    const d = drive();
    globalThis.puter = { ...bridge((path) => {
      if (path.endsWith(`/files/${gone}`)) return new Response(JSON.stringify({ code: 'not_found', message: 'File not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      if (path.endsWith(`/files/${refused}`)) return new Response(new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }), fs: d.fs };
    const reports = [];
    const folder = await writeArchiveToDrive(`${wsId}@teamchat-old`, archive, { pause: 1, onProgress: (p) => reports.push(p) });
    const written = d.events.filter((e) => e.startsWith('end ') && !/messages\.json|index\.html|\.html$/.test(e)).map((e) => e.slice(4));
    expect(written.sort()).toEqual(files.filter((f) => f.id !== gone && f.id !== refused).map((f) => `${f.id}-${f.name}`).sort());
    // Up to four in flight; the first attachment's write finished before a second began.
    expect(d.most()).toBe(4);
    const starts = d.events.filter((e) => e.startsWith('start ') && /-pic-/.test(e));
    const firstEnd = d.events.indexOf(`end ${files[0].id}-${files[0].name}`);
    expect(d.events.indexOf(starts[1])).toBeGreaterThan(firstEnd);
    // The dialog's report: every file counted once, the two that did not make it counted missing, the count never going backwards.
    const last = reports[reports.length - 1];
    expect(last).toMatchObject({ phase: 'files', done: 9, total: 9, missing: 2 });
    const fileReports = reports.filter((p) => p.phase === 'files');
    expect(fileReports.every((p, i) => i === 0 || p.done >= fileReports[i - 1].done)).toBe(true);
    expect(fileReports.filter((p) => p.label).map((p) => p.label).sort()).toEqual(files.map((f) => f.name).sort());
    expect(folder).toMatch(/^Teamchat exports\/Acme /);
  });
});
