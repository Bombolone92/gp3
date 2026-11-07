/**
 * Fifteenth review pass, region C: integrations, export/import/transfer,
 * files, link previews, search, the email worker and their client-side
 * counterparts. Each test here reproduces a defect found in that pass and
 * proves the fix.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { boot, as, USERS, workspaceWith } from './helpers/harness.js';
import { KEYS, blockIndexOf, overlayKey } from '../src/shared/blocks.js';
import { dmConvId } from '../src/shared/ids.js';
import { importArchive, transferWorkspace } from '../src/lib/archive.js';
import { api } from '../src/lib/api.js';

const { alice, bob } = USERS;
let rt;

beforeEach(async () => {
  rt = await boot();
});

describe('a file waiting with a scheduled message, carried across by a move', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const FILE = 'fileabcd1234';
  const CH = 'general001';
  const header = (sched) => ({
    format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' },
    channels: { [CH]: { id: CH, name: 'general', def: true } },
    members: { [alice.uuid]: { username: 'alice', name: 'Alice', role: 'owner' }, [bob.uuid]: { username: 'bob', name: 'Bob', role: 'member' } },
    memberDocs: { [alice.uuid]: { channels: [CH] }, [bob.uuid]: { channels: [CH] } },
    sched,
  });
  const entry = { id: 'sched00001', kind: 'message', u: bob.uuid, conv: CH, text: 'the plan, later', attachments: [{ id: FILE }], dueAt: Date.now() + 3_600_000, createdAt: Date.now() };
  const archive = (sched = [entry]) => ({ header: header(sched), pages: [{ conv: CH, seq: 0, messages: [] }], files: [{ id: FILE, name: 'plan.txt', size: 5, type: 'text/plain', sched: true }] });

  it('is told who scheduled it, as a file a message carries is told its author', async () => {
    const forms = [];
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/api/workspaces/import') return json({ workspace: { id: 'copy0000001', name: 'Acme' } });
      if (path === '/api/ws/copy0000001/import') return json({ ok: true, conv: CH, count: 0 });
      if (path === `/api/ws/abcdef1234/files/${FILE}`) return new Response(new Blob(['hello'], { type: 'text/plain' }), { status: 200, headers: { 'Content-Type': 'text/plain' } });
      if (path === '/api/ws/copy0000001/import/file') {
        forms.push(Object.fromEntries([...init.body].map(([k, v]) => [k, typeof v === 'string' ? v : `<${v.size} bytes>`])));
        return json({ ok: true, id: FILE });
      }
      if (path === '/api/ws/copy0000001/import/finish') return json({ ok: true });
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    const ref = await importArchive('https://teamchat-new.puter.work', archive(), { from: 'abcdef1234@teamchat-old', fromRef: 'abcdef1234@teamchat-old', profile: { name: 'Alice' } });
    expect(ref).toBe('copy0000001@teamchat-new');
    expect(forms).toEqual([{ file: '<5 bytes>', id: FILE, name: 'plan.txt', owner: bob.uuid }]);
  });

  it('is let go of on the copy when its author deletes the message before its time, rather than staying in the owner\'s drive for good', async () => {
    // The old server is faked (its export is the archive below); the copy is made on the real worker.
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const u = new URL(url);
      if (u.hostname === 'teamchat-old.puter.work') {
        if (u.pathname === `/api/ws/abcdef1234/files/${FILE}`) return new Response(new Blob(['hello'], { type: 'text/plain' }), { status: 200, headers: { 'Content-Type': 'text/plain' } });
        return json({ code: 'not_found', message: 'No such endpoint' }, 404);
      }
      return rt.dispatch(url, init, alice);
    } } };
    const ref = await importArchive('https://teamchat-new.puter.work', archive(), { from: 'abcdef1234@teamchat-old', fromRef: 'abcdef1234@teamchat-old', profile: { name: 'Alice' } });
    const copy = ref.split('@')[0];
    expect((await rt.kv.get(KEYS.ws(copy))).importing).toBeUndefined();
    const meta = await rt.kv.get(KEYS.file(FILE));
    expect(meta).toMatchObject({ ws: copy, u: bob.uuid, refs: 0 });
    expect(rt.fs._files.has(`teamchat-files/${copy}/${FILE}`)).toBe(true);
    // The message waits for Bob on the copy, file and all.
    const list = (await as(bob).get(`/api/ws/${copy}/scheduled`)).data.scheduled;
    expect(list.map((s) => [s.id, s.attachments?.map((a) => a.id)])).toEqual([['sched00001', [FILE]]]);
    // Bob thinks better of it: the file nothing else holds goes with the message.
    expect((await as(bob).del(`/api/ws/${copy}/scheduled/sched00001`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(FILE))).toBeFalsy();
    expect(rt.fs._files.has(`teamchat-files/${copy}/${FILE}`)).toBe(false);
  });
});

describe('a move whose failed copy could not be taken down', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const OLD = 'abcdef1234@teamchat-old';
  const NEW_URL = 'https://teamchat-new.puter.work';
  const HEADER = { format: 'teamchat-export', version: 1, workspace: { id: 'abcdef1234', name: 'Acme' }, channels: { c1: { name: 'general', def: true } }, members: {}, memberDocs: {} };
  const PAGE = { conv: 'c1', seq: 1, messages: [{ seq: 1, user: 'u', text: 'hi', ts: 1 }] };
  /** Two faked servers; `mode` is changed between tries. Each copy made gets the next id. Returns the calls made, in order. */
  function servers(mode) {
    const made = [];
    let copies = 0;
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = init.method || 'GET';
      made.push(`${method} ${path}`);
      if (path === '/api/ws/abcdef1234') return json({ workspace: { id: 'abcdef1234', name: 'Acme', movedTo: null } });
      if (path.endsWith('/transfer/begin')) return json({ ok: true, transferring: { by: 'me', at: 1 } });
      if (path.endsWith('/transfer/cancel')) return json({ ok: true });
      if (path.endsWith('/transfer/complete')) return json({ ok: true, movedTo: JSON.parse(init.body).to });
      if (path === '/api/ws/abcdef1234/export') return json({ header: HEADER, pages: [PAGE], files: [], done: true, cursor: null, progress: { done: 1, total: 1 } });
      if (path === '/api/workspaces/import') return json({ workspace: { id: `copy000000${++copies}`, name: 'Acme' } });
      if (/^\/api\/ws\/copy\d+\/import$/.test(path)) return mode.failPages ? json({ code: 'internal', message: 'the store failed' }, 500) : json({ ok: true, conv: 'c1', count: 1 });
      if (/^\/api\/ws\/copy\d+\/import\/finish$/.test(path)) return json({ ok: true });
      if (method === 'DELETE') {
        if (mode.failDelete) throw new Error('the server is down');
        return json({ ok: true });
      }
      return json({ code: 'not_found', message: 'No such endpoint' }, 404);
    } } };
    return made;
  }
  const attempt = (state) => transferWorkspace(OLD, NEW_URL, state, { profile: { name: 'Bob' } }).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

  it('remembers the copy and takes it down first when the move is tried again, rather than making another beside it', async () => {
    const mode = { failPages: true, failDelete: true };
    const made = servers(mode);
    const state = { copy: null };
    const first = await attempt(state);
    expect([first.ok, first.e.message]).toEqual([false, 'the store failed']);
    expect(made.filter((x) => x.startsWith('DELETE'))).toEqual(['DELETE /api/ws/copy0000001']);
    expect(made.some((x) => x.endsWith('/transfer/cancel'))).toBe(true);
    expect(state.partial).toEqual(['copy0000001@teamchat-new']);
    expect(state.copy).toBeNull();
    // The new server still out of reach at the next try: the copy stays remembered, and the try goes on (a copy it makes whole is not remembered).
    made.length = 0;
    mode.failPages = false;
    const second = await attempt(state);
    expect(made[0]).toBe('DELETE /api/ws/copy0000001');
    expect(second.ok).toBe(true);
    expect(second.v.ref).toBe('copy0000002@teamchat-new');
    expect(state.partial).toEqual(['copy0000001@teamchat-new']);
    // Reachable again: the leftover goes at the start of the try after, before anything else is made.
    const later = { copy: null, partial: state.partial };
    mode.failDelete = false;
    made.length = 0;
    const third = await attempt(later);
    expect(made[0]).toBe('DELETE /api/ws/copy0000001');
    expect(made.indexOf('DELETE /api/ws/copy0000001')).toBeLessThan(made.indexOf('POST /api/workspaces/import'));
    expect(third.ok).toBe(true);
    expect(later.partial).toEqual([]);
    // Two tries in a row that could take nothing down: both copies are remembered, and both go once the server answers.
    const twice = { copy: null };
    mode.failPages = true;
    mode.failDelete = true;
    expect((await attempt(twice)).ok).toBe(false);
    expect((await attempt(twice)).ok).toBe(false);
    expect(twice.partial).toEqual(['copy0000004@teamchat-new', 'copy0000005@teamchat-new']);
    mode.failPages = false;
    mode.failDelete = false;
    made.length = 0;
    expect((await attempt(twice)).ok).toBe(true);
    expect(made.slice(0, 2)).toEqual(['DELETE /api/ws/copy0000004', 'DELETE /api/ws/copy0000005']);
    expect(twice.partial).toEqual([]);
  });

  it('remembers the copy across a reload of the app, by the workspace being moved, and forgets it once it is gone', async () => {
    const hadStorage = Object.hasOwn(globalThis, 'localStorage') ? globalThis.localStorage : undefined;
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    try {
      const mode = { failPages: true, failDelete: true };
      const made = servers(mode);
      expect((await attempt({ copy: null })).ok).toBe(false);
      const key = [...store.keys()].find((k) => k.includes(OLD));
      expect(key).toBeTruthy();
      expect(JSON.parse(store.get(key))).toEqual(['copy0000001@teamchat-new']);
      // The page reloaded: the dialog starts with nothing in hand, yet takes the leftover down first.
      made.length = 0;
      mode.failPages = false;
      mode.failDelete = false;
      const fresh = { copy: null };
      const out = await attempt(fresh);
      expect(made[0]).toBe('DELETE /api/ws/copy0000001');
      expect(out.ok).toBe(true);
      expect(out.v.ref).toBe('copy0000002@teamchat-new');
      expect(fresh.partial).toEqual([]);
      expect(store.has(key)).toBe(false);
      // What the storage holds is taken at its word only in the shape the dialog writes: junk, or a reference to a server the app may not call, is passed over.
      store.set(key, 'not json');
      made.length = 0;
      expect((await attempt({ copy: null })).ok).toBe(true);
      expect(made.some((x) => x.startsWith('DELETE'))).toBe(false);
      store.set(key, JSON.stringify(['copy0000009@evil.example.com', 42, 'copy0000003@teamchat-new']));
      made.length = 0;
      expect((await attempt({ copy: null })).ok).toBe(true);
      expect(made.filter((x) => x.startsWith('DELETE'))).toEqual(['DELETE /api/ws/copy0000003']);
      expect(store.has(key)).toBe(false);
    } finally {
      if (hadStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = hadStorage;
    }
  });

  it('remembers nothing when the copy was taken down with the failure, or made whole, as before', async () => {
    const mode = { failPages: true, failDelete: false };
    const made = servers(mode);
    const state = { copy: null };
    expect((await attempt(state)).ok).toBe(false);
    expect(made.filter((x) => x.startsWith('DELETE'))).toEqual(['DELETE /api/ws/copy0000001']);
    expect(state.partial).toEqual([]);
    made.length = 0;
    mode.failPages = false;
    expect((await attempt(state)).ok).toBe(true);
    expect(made.filter((x) => x.startsWith('DELETE'))).toEqual([]);
    expect(state.partial).toEqual([]);
    expect(state.copy.ref).toBe('copy0000002@teamchat-new');
  });
});

describe('a link preview of a site slow at every step', () => {
  const realFetch = globalThis.fetch;
  let calls;
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = realFetch;
  });
  /** A site where every fetch costs `hopSeconds` of the (faked) clock before it answers; the clock alone is faked, the fetch's own timer is real and never fires. */
  function slowSite(hopSeconds) {
    calls = [];
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      calls.push(u.pathname);
      vi.setSystemTime(Date.now() + hopSeconds * 1000);
      const html = (b) => new Response(b, { status: 200, headers: { 'Content-Type': 'text/html' } });
      const m = /^\/chain(\d)$/.exec(u.pathname);
      if (m) return new Response('', { status: 302, headers: { Location: Number(m[1]) < 2 ? `/chain${Number(m[1]) + 1}` : '/final' } });
      if (u.pathname === '/final') return html('<html><head><title>Finally</title></head></html>');
      if (u.pathname === '/with-image') return html('<html><head><title>Pic</title><meta property="og:image" content="/cover.png"></head></html>');
      if (u.pathname === '/cover.png') return new Response(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), { headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } });
      return html('<html><head><title>ok</title></head></html>');
    };
  }
  const unfurl = async (wsId, conv, text) => {
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages`, { text })).data.message;
    return (await as(alice).post(`/api/ws/${wsId}/conv/${conv}/messages/${m.seq}/unfurl`)).data.unfurl;
  };
  const cached = async (url) => rt.kv.get(KEYS.unfurl(await (await import('../worker/lib.js')).sha256(url)));

  it('is given twelve seconds in all, and one that runs out is remembered as a failed preview', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { wsId, general } = await workspaceWith(alice);
    // Three redirects at four and a half seconds each: the page behind them is never asked for.
    slowSite(4.5);
    expect(await unfurl(wsId, general.id, 'https://docs.example.com/chain0')).toBeNull();
    expect(calls).toEqual(['/chain0', '/chain1', '/chain2']);
    expect(await cached('https://docs.example.com/chain0')).toMatchObject({ none: true });
    expect(rt.kv._ttl.get(KEYS.unfurl(await (await import('../worker/lib.js')).sha256('https://docs.example.com/chain0')))).toBe(3600);
    // A page that took thirteen seconds itself keeps its card, without the picture there was no time left for.
    slowSite(13);
    expect(await unfurl(wsId, general.id, 'https://docs.example.com/with-image')).toMatchObject({ title: 'Pic', image: null, kind: 'page' });
    expect(calls).toEqual(['/with-image']);
    // Within the budget, redirects and the picture are followed as before.
    slowSite(2);
    expect(await unfurl(wsId, general.id, 'https://docs.example.com/chain1')).toMatchObject({ title: 'Finally' });
    expect(calls).toEqual(['/chain1', '/chain2', '/final']);
    slowSite(3);
    const pic = await unfurl(wsId, general.id, 'https://cdn.example.com/with-image');
    expect(pic.title).toBe('Pic');
    expect(pic.image).toMatch(/^[0-9a-f]{64}$/);
    expect(calls).toEqual(['/with-image', '/cover.png']);
  });
});

describe('a scheduled message sent by the old copy as the move began', () => {
  const due = async (wsId, id) => {
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
  };
  const texts = async (wsId, conv, who = alice) => (await as(who).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.filter((m) => m.kind === 'msg').map((m) => m.text);

  it('is not sent a second time by the copy: the message travels with the id the entry posted it under', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const id = (await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'the words', dueAt: Date.now() + 3_600_000 })).data.scheduled.id;
    // The header as an export read it a moment before a poll in flight delivered the entry (the poll had read the workspace unfrozen).
    const before = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect(before.header.sched.map((e) => e.id)).toEqual([id]);
    await due(wsId, id);
    expect((await as(alice).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    expect(await texts(wsId, general.id)).toEqual(['the words']);
    // The pages as the export then read them: the message, posted under the entry's id.
    const after = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    const posted = after.pages.find((p) => p.conv === general.id).messages.find((m) => m.text === 'the words');
    expect(posted.cid).toBe(id);
    expect(after.header.sched).toBeUndefined();
    // The copy: the queue from the first reading, the history from the second.
    const newId = (await as(alice).post('/api/workspaces/import', { header: before.header })).data.workspace.id;
    for (const p of after.pages) expect((await as(alice).post(`/api/ws/${newId}/import`, { conv: p.conv, seq: p.seq, messages: p.messages })).ok).toBe(true);
    expect((await as(alice).post(`/api/ws/${newId}/import/finish`)).ok).toBe(true);
    const gen = Object.values((await as(alice).get(`/api/ws/${newId}`)).data.workspace.channels).find((c) => c.name === 'general');
    const raw = (await rt.kv.get(KEYS.block(gen.id, 0))).m.find((m) => m.t === 'the words');
    expect(raw.cid).toBe(id);
    // The copy's first poll finds the entry due and the message already there: nothing is posted again, and the entry goes.
    await due(newId, id);
    expect((await as(alice).get(`/api/ws/${newId}/sync?since=0`)).ok).toBe(true);
    expect(await texts(newId, gen.id)).toEqual(['the words']);
    expect((await rt.kv.get(KEYS.sched(newId)))?.m?.[id]).toBeUndefined();
    // An id of another shape is not one the post route would have given, and does not travel.
    const odd = (await as(alice).post('/api/workspaces/import', { header: { ...before.header, sched: undefined } })).data.workspace.id;
    const page = after.pages.find((p) => p.conv === general.id);
    expect((await as(alice).post(`/api/ws/${odd}/import`, { conv: page.conv, seq: page.seq, messages: page.messages.map((m) => ({ ...m, cid: '<script>' })) })).ok).toBe(true);
    const oddGen = Object.values((await rt.kv.get(KEYS.ws(odd))).channels).find((c) => c.name === 'general');
    expect((await rt.kv.get(KEYS.block(oddGen.id, 0))).m.find((m) => m.t === 'the words').cid).toBeUndefined();
  });
});

describe('downloading a file over a slow link', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    vi.useRealTimers();
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  /** A Response whose body arrives in the given chunks, each after `gapMs`; aborting `signal` errors the body as fetch does. */
  function streamed(chunks, { gapMs = 0, headers = {} } = {}, signal = null) {
    const body = new ReadableStream({
      async start(c) {
        let dead = false;
        signal?.addEventListener('abort', () => { dead = true; try { c.error(signal.reason); } catch { /* closed already */ } });
        for (const x of chunks) {
          if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
          if (dead) return;
          c.enqueue(x);
        }
        if (!dead) c.close();
      },
    });
    return new Response(body, { status: 200, headers });
  }
  const serve = (fn) => { globalThis.puter = { workers: { exec: async (url, init) => fn(url, init) } }; };
  const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  const REF = 'abcdef1234@teamchat-x';

  it('is given up on only when nothing arrives for the plain timeout, not by a budget the declared length earned', async () => {
    vi.useFakeTimers();
    // One megabyte declared honestly (the budget it earned: twenty seconds and twenty-one more), on a link that brings
    // 128 KB every fifteen seconds: two minutes in all, slower than the budget assumed, never stalling.
    const piece = new Uint8Array(128 * 1024);
    serve((url, init) => streamed(Array(8).fill(piece), { gapMs: 15_000, headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(8 * piece.length) } }, init.signal));
    const slow = settle(api.fileBlob(REF, 'fileabcd1234'));
    await vi.advanceTimersByTimeAsync(130_000);
    const a = await slow;
    expect(a.ok, a.ok ? '' : `${a.e.code}: ${a.e.message}`).toBe(true);
    expect(a.v.size).toBe(8 * piece.length);
    expect(a.v.type).toBe('application/pdf');
    // A length that lies (smaller than the body), still delivering: the same.
    const kb = new Uint8Array(1024);
    serve((url, init) => streamed([kb, kb, kb], { gapMs: 15_000, headers: { 'Content-Type': 'text/plain', 'Content-Length': '10' } }, init.signal));
    const lying = settle(api.fileBlob(REF, 'fileabcd1234'));
    await vi.advanceTimersByTimeAsync(50_000);
    const b = await lying;
    expect(b.ok, b.ok ? '' : `${b.e.code}: ${b.e.message}`).toBe(true);
    expect(b.v.size).toBe(3 * kb.length);
    // A body that stops coming is given up on after the plain timeout of silence, and said so.
    serve((url, init) => streamed([kb, kb], { gapMs: 60_000, headers: { 'Content-Type': 'text/plain', 'Content-Length': String(2 * kb.length) } }, init.signal));
    const stalled = settle(api.fileBlob(REF, 'fileabcd1234'));
    await vi.advanceTimersByTimeAsync(200_000);
    const c = await stalled;
    expect(c.ok).toBe(false);
    expect([c.e.code, c.e.message]).toEqual(['timeout', 'The download took too long']);
    // The type travels as the worker sent it, so a blob handed back to another worker (the icon a move carries across) is taken as what it is.
    serve((url, init) => streamed([kb], { headers: { 'Content-Type': 'image/png' } }, init.signal));
    const icon = settle(api.fileBlob(REF, 'fileabcd1234'));
    await vi.advanceTimersByTimeAsync(1000);
    expect((await icon).v.type).toBe('image/png');
  });
});

describe('the files an export names for the queue', () => {
  const hadPuter = Object.hasOwn(globalThis, 'puter') ? globalThis.puter : undefined;
  afterEach(() => {
    if (hadPuter === undefined) delete globalThis.puter;
    else globalThis.puter = hadPuter;
  });
  const ext = { uuid: 'u-ext-0000', username: 'ext' };
  async function upload(u, wsId, name) {
    const fd = new FormData();
    fd.append('file', new Blob([`bytes of ${name}`], { type: 'text/plain' }), name);
    const r = await as(u).post(`/api/ws/${wsId}/files`, fd);
    expect(r.ok, name).toBe(true);
    return r.data.id;
  }
  const entry = (id, u, conv, file) => ({ id, kind: 'message', u, conv, text: 'later', attachments: [{ id: file }], dueAt: Date.now() + 3_600_000, createdAt: Date.now() });

  /** Bob's queued file, beside one of someone from a connected workspace and one whose author is no longer here. */
  async function queued() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    await rt.kv.update(KEYS.ws(wsId), { [`members.${ext.uuid}`]: { username: 'ext', name: 'Ext', color: 2, role: 'external', exp: Date.now() + 86_400_000, org: { name: 'Globex' }, joinedAt: Date.now() } });
    const mine = await upload(bob, wsId, 'plan.txt');
    const theirs = await upload(ext, wsId, 'theirs.txt');
    const orphan = await upload(bob, wsId, 'orphan.txt');
    expect((await as(bob).post(`/api/ws/${wsId}/scheduled`, { conv: general.id, text: 'later', attachments: [{ id: mine }], dueAt: Date.now() + 3_600_000 })).ok).toBe(true);
    await rt.kv.update(KEYS.sched(wsId), { 'm.schedext001': entry('schedext001', ext.uuid, general.id, theirs), 'm.schedgone01': entry('schedgone01', 'u-gone-0000', general.id, orphan) });
    return { wsId, general, mine, theirs, orphan };
  }

  it('are the files of entries the copy will hold: not one waiting for someone from a connected workspace, nor for an author no longer here', async () => {
    const { wsId, mine, theirs, orphan } = await queued();
    const page = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    // The queue itself travels whole (the copy admits what it can), but only Bob's file is named for the copy to fetch.
    expect(page.header.sched.map((e) => e.u).sort()).toEqual([bob.uuid, ext.uuid, 'u-gone-0000'].sort());
    expect(page.files.map((f) => f.id)).toEqual([mine]);
    expect(page.files[0]).toMatchObject({ id: mine, name: 'plan.txt', sched: true });
    expect(page.files.some((f) => f.id === theirs || f.id === orphan)).toBe(false);
  });

  it('so the copy holds no bytes that nothing in it will ever release', async () => {
    const { wsId, mine, theirs, orphan } = await queued();
    const page = (await as(alice).get(`/api/ws/${wsId}/export`)).data;
    expect((await as(alice).del(`/api/ws/${wsId}`)).ok).toBe(true);
    // The old copy is faked (it would serve the bytes of any file asked for); the copy is made on the real worker.
    const asked = [];
    globalThis.puter = { workers: { exec: async (url, init = {}) => {
      const u = new URL(url);
      if (u.hostname === 'teamchat-old.puter.work') {
        const m = /\/files\/([a-z0-9]+)$/.exec(u.pathname);
        if (m) {
          asked.push(m[1]);
          return new Response(new Blob(['bytes'], { type: 'text/plain' }), { status: 200, headers: { 'Content-Type': 'text/plain' } });
        }
        return new Response(JSON.stringify({ code: 'not_found', message: 'No such endpoint' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      return rt.dispatch(url, init, alice);
    } } };
    const ref = await importArchive('https://teamchat-new.puter.work', { header: page.header, pages: page.pages, files: page.files }, { from: `${wsId}@teamchat-old`, fromRef: `${wsId}@teamchat-old`, profile: { name: 'Alice' } });
    const copy = ref.split('@')[0];
    expect(copy).toBe(wsId);
    expect(asked).toEqual([mine]);
    const importedAt = (await rt.kv.get(KEYS.ws(copy))).importedAt;
    expect(await rt.kv.get(KEYS.file(mine))).toMatchObject({ ws: copy, u: bob.uuid, refs: 0, imp: importedAt });
    expect(rt.fs._files.has(`teamchat-files/${copy}/${mine}`)).toBe(true);
    for (const f of [theirs, orphan]) {
      expect(rt.fs._files.has(`teamchat-files/${copy}/${f}`), f).toBe(false);
      expect((await rt.kv.get(KEYS.file(f)))?.imp, f).toBeUndefined();
    }
    // Bob's entry waits on the copy with its file, and goes with it when he deletes it.
    const list = (await as(bob).get(`/api/ws/${copy}/scheduled`)).data.scheduled;
    expect(list).toHaveLength(1);
    expect((await as(bob).del(`/api/ws/${copy}/scheduled/${list[0].id}`)).ok).toBe(true);
    expect(await rt.kv.get(KEYS.file(mine))).toBeFalsy();
    expect(rt.fs._files.has(`teamchat-files/${copy}/${mine}`)).toBe(false);
  });
});

describe('a reminder\'s line in the member\'s own space', () => {
  const rebuild = async (wsId) => {
    let state = null;
    for (let i = 0; i < 50; i++) {
      const r = await as(alice).post(`/api/ws/${wsId}/search/reindex`, { state });
      expect(r.ok).toBe(true);
      if (r.data.done) return;
      state = r.data.state;
    }
    throw new Error('rebuild did not finish');
  };
  const hits = async (wsId, who, q) => (await as(who).get(`/api/ws/${wsId}/search?q=${q}`)).data.results.map((m) => m.text);

  it('is found by search neither as it is delivered nor after the index is rebuilt', async () => {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'the quarterly numbers' })).data.message;
    const id = (await as(bob).post(`/api/ws/${wsId}/reminders`, { conv: general.id, seq: m.seq, note: 'zebra budget', dueAt: Date.now() + 3_600_000 })).data.reminder.id;
    await rt.kv.update(KEYS.sched(wsId), { [`m.${id}.dueAt`]: Date.now() - 1 });
    await rt.kv.update(KEYS.activity(wsId), { nd: Date.now() - 1 });
    expect((await as(bob).get(`/api/ws/${wsId}/sync?since=0`)).ok).toBe(true);
    const self = dmConvId([bob.uuid], wsId);
    const own = (await as(bob).get(`/api/ws/${wsId}/conv/${self}/messages`)).data.messages;
    expect(own.at(-1)).toMatchObject({ kind: 'rem', text: 'Reminder: zebra budget' });
    // Delivered, the line is not indexed: a reminder is a note to oneself, not a message.
    expect(await hits(wsId, bob, 'zebra')).toEqual([]);
    // Nor after a rebuild, which used to index it and find it where the live index did not.
    await rebuild(wsId);
    expect(await hits(wsId, bob, 'zebra')).toEqual([]);
    // The message it points at, and everything else, is still found.
    expect(await hits(wsId, bob, 'quarterly')).toEqual(['the quarterly numbers']);
  });
});

describe('the integrations list of a copy that takes no writes', () => {
  const MIN = 60_000;
  /** A webhook and a bot, plus the trace a call in flight leaves under an integration revoked meanwhile (see the list route). */
  async function withStubs() {
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const hook = (await as(alice).post(`/api/ws/${wsId}/webhooks`, { channel: general.id, name: 'Deploys' })).data;
    const bot = (await as(alice).post(`/api/ws/${wsId}/bots`, { name: 'Bot', channels: [general.id] })).data;
    await rt.kv.update(KEYS.ws(wsId), { 'webhooks.stalehook1.lastUsed': 5, 'bots.stalebot01.lastUsed': 5 });
    return { wsId, hook, bot };
  }
  const listed = async (wsId) => {
    const r = await as(alice).get(`/api/ws/${wsId}/webhooks`);
    expect(r.ok).toBe(true);
    return { webhooks: r.data.webhooks.map((h) => h.id), bots: r.data.bots.map((b) => b.id) };
  };
  const stubs = async (wsId) => {
    const ws = await rt.kv.get(KEYS.ws(wsId));
    return [!!ws.webhooks?.stalehook1, !!ws.bots?.stalebot01];
  };

  it('is shown as it stands, the traces left out, and nothing is written to a moved copy, one being moved, or one still being imported', async () => {
    const { wsId, hook, bot } = await withStubs();
    for (const mark of [{ movedTo: `${wsId}@teamchat-elsewhere` }, { transferring: { by: alice.uuid, at: Date.now() } }, { importing: true }]) {
      await rt.kv.update(KEYS.ws(wsId), mark);
      const before = JSON.stringify(await rt.kv.get(KEYS.ws(wsId)));
      expect(await listed(wsId), JSON.stringify(mark)).toEqual({ webhooks: [hook.id], bots: [bot.id] });
      // The document as it was, byte for byte: nothing was written to this copy.
      expect(JSON.stringify(await rt.kv.get(KEYS.ws(wsId))), JSON.stringify(mark)).toBe(before);
      expect(await stubs(wsId), JSON.stringify(mark)).toEqual([true, true]);
      await rt.kv.remove(KEYS.ws(wsId), ...Object.keys(mark));
    }
    // A move whose freeze lapsed, or was let go of, takes writes again: the traces are tidied on the next look, as before.
    await rt.kv.update(KEYS.ws(wsId), { transferring: { by: alice.uuid, at: Date.now() - 31 * MIN } });
    expect(await listed(wsId)).toEqual({ webhooks: [hook.id], bots: [bot.id] });
    expect(await stubs(wsId)).toEqual([false, false]);
  });
});

describe('a link preview fetched while its message changed under it', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const page = (title) => `<html><head><title>${title}</title></head><body></body></html>`;
  /**
   * A fake internet: docs.example.com answers at once, slow.example.com only
   * once `release` is called. `asked(n)` resolves once the slow page has been
   * asked for n times, so a test waits for the fetch to be under way rather
   * than for a fixed pause.
   */
  function fakeSite() {
    let release;
    const gate = new Promise((r) => { release = r; });
    let slowAsked = 0;
    const waiters = [];
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      const html = (body) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      if (u.hostname === 'slow.example.com') {
        slowAsked++;
        for (const w of waiters.splice(0)) w();
        await gate;
        return html(page('The slow page'));
      }
      if (u.hostname === 'docs.example.com') return html(page('The docs page'));
      return html(page('Some page'));
    };
    const asked = (n) => new Promise((resolve) => {
      const check = () => (slowAsked >= n ? resolve() : waiters.push(check));
      check();
    });
    return { release, asked };
  }
  const unfurl = (u, wsId, conv, seq) => as(u).post(`/api/ws/${wsId}/conv/${conv}/messages/${seq}/unfurl`);
  const cardOf = async (wsId, conv, seq) => (await as(alice).get(`/api/ws/${wsId}/conv/${conv}/messages`)).data.messages.find((m) => m.seq === seq).unfurl;

  it('does not land the old link\'s card over the new link\'s once the message was edited to another link', async () => {
    const { release, asked } = fakeSite();
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const m = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'see https://slow.example.com/a' })).data.message;
    // The sender's app asks for the preview; the page is slow to answer.
    const first = unfurl(alice, wsId, general.id, m.seq);
    await asked(1);
    // Meanwhile the author swaps the link, is told to ask again, and does; that page answers at once.
    const edited = await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${m.seq}`, { text: 'see https://docs.example.com/b' });
    expect(edited.data.relink).toBe(true);
    const second = await unfurl(alice, wsId, general.id, m.seq);
    expect(second.data.unfurl).toMatchObject({ url: 'https://docs.example.com/b', title: 'The docs page' });
    expect(await cardOf(wsId, general.id, m.seq)).toMatchObject({ url: 'https://docs.example.com/b' });
    // The slow page answers now: its card is for a link the message no longer carries.
    release();
    const late = await first;
    expect(late.ok).toBe(true);
    expect(late.data.unfurl).toMatchObject({ url: 'https://docs.example.com/b', title: 'The docs page' });
    expect(await cardOf(wsId, general.id, m.seq)).toMatchObject({ url: 'https://docs.example.com/b', title: 'The docs page' });
    // Every later request answers with the card that stands, as before.
    expect((await unfurl(alice, wsId, general.id, m.seq)).data.unfurl).toMatchObject({ url: 'https://docs.example.com/b' });
  });

  it('writes no card when the edit took the link out, and keeps a removal made while the page was being read', async () => {
    const { release, asked } = fakeSite();
    const { wsId, general } = await workspaceWith(alice, [bob]);
    const gone = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'see https://slow.example.com/c' })).data.message;
    const off = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'see https://slow.example.com/d' })).data.message;
    const firstGone = unfurl(alice, wsId, general.id, gone.seq);
    const firstOff = unfurl(alice, wsId, general.id, off.seq);
    await asked(2);
    expect((await as(alice).put(`/api/ws/${wsId}/conv/${general.id}/messages/${gone.seq}`, { text: 'no link after all' })).data.relink).toBe(true);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${off.seq}/unfurl`)).ok).toBe(true);
    release();
    expect((await firstGone).data).toEqual({ unfurl: null });
    expect(await cardOf(wsId, general.id, gone.seq)).toBeNull();
    expect((await unfurl(alice, wsId, general.id, gone.seq)).data).toEqual({ unfurl: null });
    expect((await firstOff).data).toEqual({ unfurl: null });
    expect(await cardOf(wsId, general.id, off.seq)).toBeNull();
    // Removed stays removed: it is not fetched again.
    expect((await unfurl(alice, wsId, general.id, off.seq)).data).toEqual({ unfurl: null });
    // A message deleted while its page was being read gets no card either.
    const second = fakeSite();
    const del = (await as(alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'see https://slow.example.com/e' })).data.message;
    const firstDel = unfurl(alice, wsId, general.id, del.seq);
    await second.asked(1);
    expect((await as(alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${del.seq}`)).ok).toBe(true);
    second.release();
    expect((await firstDel).data).toEqual({ unfurl: null });
    const raw = await rt.kv.get(KEYS.block(general.id, blockIndexOf(del.seq)));
    expect(raw.x?.[overlayKey(del.seq)]?.uf).toBeUndefined();
  });
});
