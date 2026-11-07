/**
 * Twenty-seventh review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass25.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { store } from '../src/lib/store.js';
import { api } from '../src/lib/api.js';
import { createOutbox, layeredStorage, memoryStorage } from '../src/lib/outbox.js';
import { installDom } from './helpers/dom.js';

/* ---- a small workspace on a faked worker, as tests/client-lib-pass25.test.js has it ---- */

const REF = 'abc123def0@teamchat-test';
const OTHER = 'fed321cba0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));
/** Route each call by the end of its path (first match wins); a handler gets the query and the request init. */
function worker(routes) {
  const calls = [];
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
        const hit = Object.entries(routes).find(([k]) => u.pathname.endsWith(k));
        if (!hit) return json({ code: 'not_found', message: 'nope' }, 404);
        return hit[1](u.searchParams, init);
      },
    },
  };
  return calls;
}
function openAcme(s = store) {
  s.wsId = REF;
  s.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  s.ws = { id: 'abc123def0', name: 'Acme', channels: { c1: { id: 'c1', name: 'general' } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' }, 'u-bob': { role: 'member', name: 'Bob', username: 'bob' } } };
  s.me = { role: 'member', channels: ['c1'], dms: { dm1: { members: ['u-me', 'u-bob'] } }, reads: {}, mentions: {}, notify: {}, threads: {} };
  s.act = { c: { c1: { s: 1, t: 1000 }, dm1: { s: 3, t: 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  s.links = new Map();
  s.convs.clear();
  s._laterCache = new Map();
}
/** The store as openWorkspace leaves it on a switch to another workspace: every window gone, the same direct message id standing for another conversation. */
function switchToOther() {
  store.wsId = OTHER;
  store.convs.clear();
  store.ws = { id: 'fed321cba0', name: 'Other', channels: {}, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' }, 'u-bob': { role: 'member', name: 'Bob', username: 'bob' } } };
  store.me = { role: 'member', channels: [], dms: { dm1: { members: ['u-me', 'u-bob'] } }, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: { dm1: { s: 8, t: 2000 } }, p: {}, ps: {}, w: 1, u: 0 };
}
function closeAcme() {
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.convs.clear();
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  delete globalThis.puter;
}

/* ---- lib/store.js: a page load that fails after the workspace was switched says nothing to the new workspace's window ---- */

describe('a page load failing after a switch to another workspace', () => {
  afterEach(closeAcme);

  it('the newest page: the window it was asked for is gone, and the new workspace\'s window of the same id hears nothing', async () => {
    openAcme();
    let fail;
    const failing = new Promise((_, reject) => { fail = reject; });
    worker({
      '/messages': async () => {
        await failing; // the request hangs until the network gives up on it
        return json({});
      },
    });
    const loading = store.loadConversation('dm1');
    await tick();
    // The reader opens another workspace, and its direct message with the
    // same person (the same id) is loaded there and read to the end.
    switchToOther();
    worker({ '/messages': () => json({ messages: [{ seq: 8, user: 'u-bob', text: 'hi', ts: 2000, kind: 'msg' }], seq: 8, hasMore: false }) });
    await store.loadConversation('dm1');
    const fresh = store.conv('dm1');
    expect(fresh.loaded).toBe(true);
    const heard = [];
    const off = store.on('messages', (d) => heard.push(d));
    // The first workspace's request gives up now.
    fail(new TypeError('Failed to fetch'));
    await loading;
    await tick(5);
    off();
    // Nothing about `dm1` is said for the window that is gone: said, the
    // list drawn for the new workspace's conversation redrew, took an 'init'
    // for a page landing anew (scrolled to its end, marked it read) or an
    // 'error' for a page it holds.
    expect(heard.filter((d) => d.conv === 'dm1')).toEqual([]);
    expect(fresh.loaded).toBe(true);
    expect(fresh.error).toBe(null);
    expect(fresh.messages.map((m) => m.seq)).toEqual([8]);
  });

  it('a page around a permalink: the same', async () => {
    openAcme();
    let fail;
    const failing = new Promise((_, reject) => { fail = reject; });
    worker({
      '/messages': async () => {
        await failing;
        return json({});
      },
    });
    const loading = store.loadAround('dm1', 2);
    await tick();
    switchToOther();
    worker({ '/messages': () => json({ messages: [{ seq: 8, user: 'u-bob', text: 'hi', ts: 2000, kind: 'msg' }], seq: 8, hasMore: false }) });
    await store.loadConversation('dm1');
    const heard = [];
    const off = store.on('messages', (d) => heard.push(d));
    fail(new TypeError('Failed to fetch'));
    await loading;
    await tick(5);
    off();
    expect(heard.filter((d) => d.conv === 'dm1')).toEqual([]);
    expect(store.conv('dm1').error).toBe(null);
  });
});

/* ---- lib/store.js: a send's queueing or failure, and a reaction's failure, answered after a switch of workspace ---- */

describe('a send or a reaction answered after a switch to another workspace', () => {
  // The queued message is taken out of the outbox whatever the test did: left
  // there, the next flush (after a poll that gets through, in a later test)
  // would send it, and count against that test's calls.
  afterEach(async () => {
    await store.outbox.forget(REF);
    closeAcme();
  });

  const dmPage = () => json({ messages: [{ seq: 8, user: 'u-bob', text: 'hi', ts: 2000, kind: 'msg' }], seq: 8, hasMore: false });

  it('a send that loses the connection is queued without a word to the new workspace\'s conversation of the same id', async () => {
    openAcme();
    let fail;
    const failing = new Promise((_, reject) => { fail = reject; });
    worker({ '/messages': async (q, init) => { if (init.method === 'POST') await failing; return dmPage(); } });
    const sending = store.send('dm1', { text: 'hello' });
    await tick();
    switchToOther();
    // The queue's flush tries the old workspace's server, which errors for now: the message waits its turn.
    worker({ '/messages': (q, init) => (init.method === 'POST' ? json({ code: 'internal', message: 'boom' }, 500) : dmPage()) });
    await store.loadConversation('dm1');
    const heard = [];
    const off = store.on('messages', (d) => heard.push(d));
    fail(new TypeError('Failed to fetch'));
    const temp = await sending;
    await tick(10);
    off();
    expect(temp.queued).toBe(true);
    expect(heard.filter((d) => d.conv === 'dm1')).toEqual([]);
    expect(store.conv('dm1').messages.map((m) => m.seq)).toEqual([8]);
  });

  it('a send the server refuses is marked failed without a word to it either', async () => {
    openAcme();
    let answer;
    const pending = new Promise((r) => { answer = r; });
    worker({ '/messages': async (q, init) => { if (init.method === 'POST') { await pending; return json({ code: 'forbidden', message: 'Only admins post here' }, 403); } return dmPage(); } });
    const sending = store.send('dm1', { text: 'hello' });
    await tick();
    switchToOther();
    worker({ '/messages': () => dmPage() });
    await store.loadConversation('dm1');
    const heard = [];
    const off = store.on('messages', (d) => heard.push(d));
    answer();
    await expect(sending).rejects.toMatchObject({ status: 403 });
    await tick(5);
    off();
    expect(heard.filter((d) => d.conv === 'dm1')).toEqual([]);
  });

  it('a reaction the server refuses is not put right by a read of the new workspace\'s conversation of the same id', async () => {
    openAcme();
    worker({ '/messages': () => dmPage() });
    await store.loadConversation('dm1');
    let answer;
    const pending = new Promise((r) => { answer = r; });
    worker({ '/reactions': async () => { await pending; return json({ code: 'not_found', message: 'Message not found' }, 404); }, '/messages': () => dmPage() });
    const reacting = store.react('dm1', 8, '+1');
    await tick();
    switchToOther();
    const calls = worker({ '/messages': () => dmPage() });
    await store.loadConversation('dm1');
    const before = calls.length;
    const heard = [];
    const off = store.on('messages', (d) => heard.push(d));
    answer();
    await expect(reacting).rejects.toMatchObject({ status: 404 });
    await tick(5);
    off();
    expect(calls.length).toBe(before); // no range read of the new workspace's window
    expect(heard).toEqual([]);
  });
});

/* ---- lib/store.js: a direct message opened as the workspace is switched ---- */

describe('a direct message opened as the workspace is switched', () => {
  afterEach(closeAcme);

  it('is named with the workspace it was asked in, and the new workspace\'s document is not read for it', async () => {
    openAcme();
    let answer;
    const pending = new Promise((r) => { answer = r; });
    worker({ '/dms': async () => { await pending; return json({ conv: 'dm_new' }); } });
    const opening = store.openDmWith('u-bob');
    await tick();
    switchToOther();
    const calls = worker({ '': () => json({ workspace: store.ws, me: store.me, activity: { c: {}, p: {} }, now: Date.now() }) });
    answer();
    const res = await opening;
    await tick(5);
    expect(res).toEqual({ ws: REF, conv: 'dm_new' });
    expect(calls.filter((c) => c.startsWith('GET '))).toEqual([]); // no document read of the workspace switched to
  });
});

/* ---- lib/format.js: a preview or a cut of a long text reads only as far as it keeps ---- */

describe('previewText and cutText on a message of four thousand characters', () => {
  it('segment no further than the characters they keep, and keep the same characters as before', async () => {
    const RealIntl = globalThis.Intl;
    let pulled = 0;
    class CountingSegmenter {
      constructor(...a) { this.inner = new RealIntl.Segmenter(...a); }
      segment(text) {
        const it = this.inner.segment(text);
        return { *[Symbol.iterator]() { for (const s of it) { pulled++; yield s; } } };
      }
    }
    vi.resetModules();
    globalThis.Intl = { Segmenter: CountingSegmenter };
    try {
      const { previewText, cutText } = await import('../src/lib/format.js');
      const whole = (text) => [...new RealIntl.Segmenter().segment(text)].map((s) => s.segment);
      const latin = 'The quick brown fox jumps over the lazy dog. '.repeat(90).slice(0, 4000);
      const mixed = 'ab\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}\u{1F1EB}\u{1F1F7}cd\u{1F44D}\u{1F3FD}'.repeat(300).slice(0, 4000);
      for (const text of [latin, mixed]) {
        const flat = text.replace(/\s+/g, ' ').trim();
        pulled = 0;
        expect(previewText(text, 80)).toBe(`${whole(flat).slice(0, 77).join('')}...`);
        expect(pulled).toBeLessThanOrEqual(81);
        pulled = 0;
        let ref = '';
        for (const g of whole(text)) { if (ref.length + g.length > 100) break; ref += g; }
        expect(cutText(text, 100)).toBe(ref);
        expect(pulled).toBeLessThanOrEqual(100);
      }
      // A text that fits is untouched, as before.
      expect(previewText('short', 80)).toBe('short');
      expect(cutText('short', 80)).toBe('short');
    } finally {
      globalThis.Intl = RealIntl;
      vi.resetModules();
    }
  });
});

/* ---- lib/store.js: forgetting a workspace lets go of what the device and the account kept for it ---- */

describe('forgetting a workspace (left, removed from, deleted)', () => {
  /** The user's document as the account holds it, and a device cache with two workspaces' pages and bootstraps. */
  const setUp = async () => {
    vi.resetModules();
    const cache = new Map([[`ws:${REF}`, {}], [`conv:${REF}:c1`, {}], [`conv:${REF}:dm1`, {}], [`ws:${OTHER}`, {}], [`conv:${OTHER}:dm1`, {}]]);
    vi.doMock('../src/lib/idb.js', () => ({
      idb: {
        get: async (s, k) => (s === 'cache' ? cache.get(k) ?? null : null),
        all: async () => [],
        keys: async (s) => (s === 'cache' ? [...cache.keys()] : []),
        put: async (s, v) => { if (s === 'cache') cache.set(v.key, v); return v.key; },
        del: async (s, k) => { if (s === 'cache') cache.delete(k); },
        clear: async () => { cache.clear(); },
      },
    }));
    const doc = { v: 1, profile: {}, prefs: { theme: 'dark', starred: { [REF]: ['c1'], [OTHER]: ['x1'] }, sections: { [REF]: [{ id: 's1', name: 'Team', items: ['c1'] }] } }, workspaces: [{ ref: REF, name: 'Acme' }, { ref: OTHER, name: 'Other' }], worker: null };
    const account = { saved: null };
    globalThis.puter = { kv: { get: async () => structuredClone(doc), set: async (k, v) => { account.saved = v; } }, workers: { exec: async () => json({ ok: true }) } };
    const { store: fresh } = await import('../src/lib/store.js');
    fresh.identity = { uuid: 'u-me', username: 'me' };
    fresh.user = structuredClone(doc);
    fresh._composeProfile();
    return { fresh, cache, account };
  };
  afterEach(() => {
    vi.doUnmock('../src/lib/idb.js');
    vi.resetModules();
    delete globalThis.puter;
  });

  it('drops the pages and the bootstrap saved for it on the device, and its stars and sections in the account, and nothing of the others', async () => {
    const { fresh, cache, account } = await setUp();
    await fresh.forgetWorkspace(REF);
    expect([...cache.keys()].sort()).toEqual([`conv:${OTHER}:dm1`, `ws:${OTHER}`].sort());
    expect(account.saved.workspaces.map((w) => w.ref)).toEqual([OTHER]);
    expect(account.saved.prefs.starred).toEqual({ [OTHER]: ['x1'] });
    expect(account.saved.prefs.sections).toEqual({});
    expect(account.saved.prefs.theme).toBe('dark');
  });

  it('ends a huddle the member is in there, giving the seat up, and leaves one in another workspace alone', async () => {
    const { fresh } = await setUp();
    const calls = [];
    globalThis.puter.workers.exec = async (url, init = {}) => { calls.push(`${init.method || 'GET'} ${new URL(url).pathname}${new URL(url).search}`); return json({ ok: true }); };
    const inCall = (ws) => {
      fresh.huddle = { leave: vi.fn(), inviteCode: 'inv' };
      fresh._huddleInfo = { ws, conv: 'c1', ref: ws, hostConv: 'c1', title: '#general', kind: 'channel', posted: true, sid: 'sid-1' };
      fresh.huddles = { c1: { by: 'u-me', at: 1, m: { 'u-me': { inv: 'inv' } } } };
    };
    // In a huddle of another workspace: forgetting this one leaves it be.
    inCall(OTHER);
    await fresh.forgetWorkspace(REF);
    await tick(5);
    expect(fresh.huddle.leave).not.toHaveBeenCalled();
    expect(calls.some((c) => c.includes('/huddle'))).toBe(false);
    // In a huddle of the workspace forgotten: the call ends at once, and the worker is asked to give the seat up.
    inCall(REF);
    const h = fresh.huddle;
    await fresh.forgetWorkspace(REF);
    expect(h.leave).toHaveBeenCalledWith('left');
    expect(fresh.huddle).toBe(null);
    expect(fresh.huddleInfo).toBe(null);
    await tick(5);
    expect(calls.filter((c) => c.includes('/huddle'))).toEqual(['DELETE /api/ws/abc123def0/conv/c1/huddle?sid=sid-1']);
  });
});

/* ---- lib/api.js: an empty 204 answer in the worker's place ---- */

describe('an empty 204 answer in the worker\'s place (a captive portal, a gateway)', () => {
  afterEach(() => { delete globalThis.puter; });

  it('is read as no server at the address, and a queued message sent into it stays in line rather than counted as landed', async () => {
    globalThis.puter = { workers: { exec: async () => new Response(null, { status: 204 }) } };
    await expect(api.send(REF, 'c1', { text: 'x' })).rejects.toMatchObject({ code: 'no_backend' });
    const ob = createOutbox({ storage: memoryStorage(), sendEntry: (e) => api.send(REF, e.conv, { text: e.text }) });
    await ob.enqueue({ id: 'm1', ws: REF, conv: 'c1', text: 'x' });
    expect(await ob.flush()).toEqual({ sent: 0, left: 1 });
    const [entry] = await ob.list();
    expect(entry.id).toBe('m1');
    expect(entry.failed).toBeFalsy(); // waits for the next flush, as for any address that does not answer
  });
});

/* ---- lib/outbox.js: a message this tab holds in memory goes out where the durable store keeps refusing ---- */

describe('an outbox whose durable store refuses every read and write (IndexedDB present but blocked: site data off, an older private mode)', () => {
  /** A durable store as idb.js answers when the database will not open: null for a failed read, null for a write it did not take. */
  const refusing = () => ({ all: async () => null, put: async () => null, del: async () => {} });

  it('lists, sends and retries what this tab keeps in memory, rather than holding it as "queued" for good', async () => {
    const sent = [];
    const ob = createOutbox({ storage: layeredStorage(refusing()), sendEntry: async (e) => { sent.push(e.id); } });
    await ob.enqueue({ id: 'm1', ws: 'w', conv: 'c', text: 'hello' });
    expect((await ob.list())?.map((e) => e.id)).toEqual(['m1']);
    const r = await ob.flush();
    expect(sent).toEqual(['m1']);
    expect(r).toEqual({ sent: 1, left: 0 });
    // One set aside can be put back in line the same way.
    let refuse = true;
    const ob2 = createOutbox({ storage: layeredStorage(refusing()), sendEntry: async () => { if (refuse) { const e = new Error('no'); e.status = 403; throw e; } } });
    await ob2.enqueue({ id: 'm2', ws: 'w', conv: 'c', text: 'again' });
    await ob2.flush();
    expect((await ob2.list())?.[0]?.failed).toBe(true);
    refuse = false;
    expect(await ob2.retry('m2')).toMatchObject({ id: 'm2', failed: false });
    expect(await ob2.flush()).toEqual({ sent: 1, left: 0 });
  });

  it('still answers "unknown" (null) for a durable read that failed while this tab holds nothing of its own', async () => {
    const storage = layeredStorage(refusing());
    expect(await storage.all()).toBe(null);
    const ob = createOutbox({ storage, sendEntry: async () => {} });
    expect(await ob.list()).toBe(null);
  });
});

/* ---- lib/store.js: the poll backs off while the workspace server cannot be reached ---- */

describe('the poll while the workspace server cannot be reached', () => {
  afterEach(() => {
    store.stopPolling();
    vi.useRealTimers();
    closeAcme();
  });

  /** Every sync call's moment, relative to the start, in seconds. */
  const failingWorker = (fail) => {
    const at = [];
    const t0 = Date.now();
    globalThis.puter = { workers: { exec: async () => { at.push((Date.now() - t0) / 1000); return fail(); } } };
    return at;
  };
  const gaps = (at) => at.slice(1).map((t, i) => t - at[i]);

  it('waits longer after each failure of one kind (4, 8, 16 s, then half a minute), so two minutes cost seven calls rather than thirty', async () => {
    vi.useFakeTimers();
    openAcme();
    const at = failingWorker(() => { throw new TypeError('Failed to fetch'); });
    store.startPolling();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(at).toEqual([4, 8, 16, 32, 62, 92, 122]);
    expect(gaps(at)).toEqual([4, 8, 16, 30, 30, 30]);
  });

  it('the same for a gateway page in the worker\'s place and for the worker\'s own error, each kind counted on its own', async () => {
    vi.useFakeTimers();
    openAcme();
    let answer = () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } });
    const at = failingWorker(() => answer());
    store.startPolling();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(at).toEqual([4, 8, 16]); // 4, then 8, then 16 s
    // The failure changes kind (the worker itself answers, erroring): the wait starts over from four seconds.
    answer = () => json({ code: 'internal', message: 'boom' }, 500);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(at).toEqual([4, 8, 16, 32, 36, 44]);
  });

  it('goes back to the plain cadence with the first poll that gets through', async () => {
    vi.useFakeTimers();
    openAcme();
    let down = true;
    const at = failingWorker(() => { if (down) throw new TypeError('Failed to fetch'); return json({ now: Date.now(), ts: Date.now(), c: {}, p: {} }); });
    store.startPolling();
    await vi.advanceTimersByTimeAsync(33_000); // 4, 8, 16, 32: the next wait would be 30 s
    expect(at).toEqual([4, 8, 16, 32]);
    down = false;
    await vi.advanceTimersByTimeAsync(30_000); // the 30 s wait, then a poll that gets through
    expect(at).toEqual([4, 8, 16, 32, 62]);
    await vi.advanceTimersByTimeAsync(12_000); // and the plain four seconds from there
    expect(at).toEqual([4, 8, 16, 32, 62, 66, 70, 74]);
  });

  it('does not back off on a 401 (Puter not confirming the sign-in for a moment), which has its own notice and passes on its own', async () => {
    vi.useFakeTimers();
    openAcme();
    const at = failingWorker(() => json({ code: 'unauthorized', message: 'Your Puter session is not valid' }, 401));
    store.startPolling();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(at).toEqual([4, 8, 12, 16, 20]);
  });

  it('stops for good on the worker\'s word that the workspace is lost (403), as before', async () => {
    vi.useFakeTimers();
    openAcme();
    const at = failingWorker(() => json({ code: 'forbidden', message: 'Not a member' }, 403));
    store.startPolling();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(at).toEqual([4]);
  });

  it('polls at once when the member acts (pokeSync), and from there on the plain cadence again', async () => {
    vi.useFakeTimers();
    openAcme();
    const at = failingWorker(() => { throw new TypeError('Failed to fetch'); });
    store.startPolling();
    await vi.advanceTimersByTimeAsync(33_000); // waiting 30 s now
    expect(at).toEqual([4, 8, 16, 32]);
    store.pokeSync();
    await vi.advanceTimersByTimeAsync(100);
    expect(at.length).toBe(5);
    expect(at[4]).toBeCloseTo(33.05, 1);
    await vi.advanceTimersByTimeAsync(4_100);
    expect(at.length).toBe(6); // four seconds on, not eight
  });

  it('polls at once when the browser says the connection is back (the online event), rather than at the end of the wait its failures earned', async () => {
    const dom = installDom();
    vi.resetModules();
    let fresh;
    try {
      ({ store: fresh } = await import('../src/lib/store.js')); // built with a window to listen on
      vi.useFakeTimers();
      openAcme(fresh);
      const at = failingWorker(() => { throw new TypeError('Failed to fetch'); });
      fresh.startPolling();
      await vi.advanceTimersByTimeAsync(33_000); // waiting 30 s now
      expect(at).toEqual([4, 8, 16, 32]);
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(100);
      expect(at.length).toBe(5);
      expect(at[4]).toBeCloseTo(33.05, 1);
      await vi.advanceTimersByTimeAsync(4_100);
      expect(at.length).toBe(6); // and the plain four seconds from there
    } finally {
      fresh?.stopPolling();
      vi.useRealTimers();
      dom.uninstall();
      delete globalThis.puter;
    }
  });

  it('a hidden tab keeps its half minute, no longer and no shorter', async () => {
    vi.useFakeTimers();
    openAcme();
    globalThis.document = { hidden: true, addEventListener() {} };
    try {
      const at = failingWorker(() => { throw new TypeError('Failed to fetch'); });
      store.startPolling();
      await vi.advanceTimersByTimeAsync(125_000);
      expect(at).toEqual([4, 34, 64, 94, 124]);
    } finally {
      delete globalThis.document;
    }
  });
});
