/**
 * Fifteenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass14.test.js.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';
import { ApiError } from '../src/lib/api.js';

const REF = 'abc123def0@teamchat-test';
const OTHER = 'bbbbbb0000@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

/** Wait until `fn()` is truthy, polling; generous so six parallel runs do not make it flaky. */
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await tick(10);
  }
};

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

const boot = (id, name, channels) => ({
  now: Date.now(),
  workspace: { id, name, channels, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' }, 'u-ann': { role: 'member', name: 'Ann', username: 'ann' } } },
  me: { role: 'member', channels: Object.keys(channels), dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
  activity: { c: {}, p: {}, w: 1, u: {} },
});

function resetStore() {
  store.stopPolling();
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.convs.clear();
  store._localSeen.clear();
  store._seenAt.clear();
  store._unreadAt.clear();
  store._readRetry.clear();
  store._readAcked?.clear?.();
  store.offline = false;
  store.since = 0;
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
  delete globalThis.puter;
}

describe('a read the worker did not take, for a direct message whose id another workspace shares', () => {
  afterEach(resetStore);
  const sync = () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 });
  // The same two people share one direct message id across workspaces (see dmConvId).
  const dms = { dm_x: { members: ['u-me', 'u-ann'], createdAt: 1 } };
  const readsTo = (calls, id) => calls.filter((c) => c === `POST /api/ws/${id}/conv/dm_x/read`);
  /** What openWorkspace leaves the store as, once `ref` is open with the direct message unread past `read`. */
  const open = (ref, id, name, read, latest) => {
    store.stopPolling();
    store.convs.clear();
    store._localSeen.clear();
    store._seenAt.clear();
    store._unreadAt.clear();
    store.wsId = ref;
    store.ws = boot(id, name, {}).workspace;
    store.me = { role: 'member', channels: [], dms, reads: { dm_x: read }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { dm_x: { s: latest } }, p: {}, ps: {}, w: 1, u: 0 };
    store.since = 1;
  };

  it('is still sent to its own workspace when the same direct message is read in the other one meanwhile', async () => {
    let down = true;
    const bodies = [];
    const calls = worker({
      '/sync': sync,
      '/read': (_, init) => { bodies.push(JSON.parse(init.body)); return down ? json({ code: 'error', message: 'boom' }, 503) : json({ ok: true }); },
    });
    open(REF, 'abc123def0', 'A', 5, 20);
    store.markRead('dm_x', 20);
    await until(() => readsTo(calls, 'abc123def0').length === 1);
    await tick(20);
    expect(store._readRetry.size).toBe(1);
    // The switch to B, where the direct message with the same person is behind too; read there, the read fails the same way.
    open(OTHER, 'bbbbbb0000', 'B', 3, 7);
    store.markRead('dm_x', 7);
    await until(() => readsTo(calls, 'bbbbbb0000').length === 1);
    await tick(20);
    // Both reads wait, each for its own workspace: B's has not taken A's place.
    expect(store._readRetry.size).toBe(2);
    // The servers take reads again: the next sync sends both, each with its own cursor.
    down = false;
    for (const r of store._readRetry.values()) r.nextAt = 0;
    await store.poll();
    await until(() => readsTo(calls, 'abc123def0').length === 2 && readsTo(calls, 'bbbbbb0000').length === 2);
    await until(() => store._readRetry.size === 0);
    expect(bodies.filter((b) => b.seq === 20)).toHaveLength(2);
    expect(bodies.filter((b) => b.seq === 7)).toHaveLength(2);
    expect(store.me.reads.dm_x).toBe(7); // B's cursor, B being open
  });

  it('is not dropped by a mark-unread of the same direct message in the other workspace', async () => {
    let down = true;
    const calls = worker({
      '/sync': sync,
      '/read': (_, init) => (down && !JSON.parse(init.body).back ? json({ code: 'error', message: 'boom' }, 503) : json({ ok: true })),
    });
    open(REF, 'abc123def0', 'A', 5, 20);
    store.markRead('dm_x', 20);
    await until(() => readsTo(calls, 'abc123def0').length === 1);
    await tick(20);
    expect(store._readRetry.size).toBe(1);
    open(OTHER, 'bbbbbb0000', 'B', 3, 7);
    await store.markUnread('dm_x', 5);
    expect(store.me.reads.dm_x).toBe(4);
    // A's read still waits: the mark-unread was B's word about B's conversation.
    expect(store._readRetry.size).toBe(1);
    down = false;
    for (const r of store._readRetry.values()) r.nextAt = 0;
    await store.poll();
    await until(() => readsTo(calls, 'abc123def0').length === 2);
    await until(() => store._readRetry.size === 0);
    // B's own cursor was left where the mark-unread put it.
    expect(store.me.reads.dm_x).toBe(4);
  });
});

describe('a read still in its debounce when the same direct message is read in another workspace', () => {
  afterEach(resetStore);
  const dms = { dm_x: { members: ['u-me', 'u-ann'], createdAt: 1 } };
  const readsTo = (calls, id) => calls.filter((c) => c === `POST /api/ws/${id}/conv/dm_x/read`);
  const open = (ref, id, name, read, latest) => {
    store.stopPolling();
    store.convs.clear();
    store._localSeen.clear();
    store._seenAt.clear();
    store._unreadAt.clear();
    store.wsId = ref;
    store.ws = boot(id, name, {}).workspace;
    store.me = { role: 'member', channels: [], dms, reads: { dm_x: read }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { dm_x: { s: latest } }, p: {}, ps: {}, w: 1, u: 0 };
    store.since = 1;
  };

  it('still goes out to its own workspace, and so does the other', async () => {
    const bodies = [];
    const calls = worker({ '/read': (_, init) => { bodies.push(JSON.parse(init.body)); return json({ ok: true }); } });
    open(REF, 'abc123def0', 'A', 5, 20);
    store.markRead('dm_x', 20);
    // The switch to B lands on the direct message with the same person (its last open conversation), read to its end at once.
    open(OTHER, 'bbbbbb0000', 'B', 3, 7);
    store.markRead('dm_x', 7);
    await until(() => readsTo(calls, 'bbbbbb0000').length === 1);
    await until(() => readsTo(calls, 'abc123def0').length === 1);
    expect(bodies.map((b) => b.seq).sort()).toEqual([20, 7].sort());
    expect(store.me.reads.dm_x).toBe(7);
  });

  it('is not cancelled by a mark-unread of the same direct message in the other workspace', async () => {
    const calls = worker({ '/read': () => json({ ok: true }) });
    open(REF, 'abc123def0', 'A', 5, 20);
    store.markRead('dm_x', 20);
    open(OTHER, 'bbbbbb0000', 'B', 3, 7);
    await store.markUnread('dm_x', 5);
    await until(() => readsTo(calls, 'abc123def0').length === 1);
    expect(store.me.reads.dm_x).toBe(4);
  });
});

describe('a read of a workspace forgotten in the moment after it', () => {
  afterEach(() => { resetStore(); store.user = null; store.identity = null; store.workspaces = []; store._forgotten.clear(); });
  const channels = { c1: { id: 'c1', name: 'general' } };
  const readsOf = (calls) => calls.filter((c) => c === 'POST /api/ws/abc123def0/conv/c1/read');
  const arm = (calls) => {
    globalThis.puter.kv = { get: async () => ({ v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'A' }], worker: null }), set: async () => {} };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = { v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'A' }], worker: null };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: { c1: 5 }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 20 } }, p: {}, ps: {}, w: 1, u: 0 };
    return calls;
  };

  it('is not sent when it was still waiting its moment, nor kept to be sent again when it was on its way and reached nobody', async () => {
    const held = [];
    const calls = worker({ '/read': () => new Promise((r) => held.push(r)) });
    arm(calls);
    // Waiting its moment (the debounce) as the workspace is left: it has nowhere to go.
    store.markRead('c1', 20);
    await store.forgetWorkspace(REF);
    await tick(700);
    expect(readsOf(calls)).toHaveLength(0);
    expect(store._readRetry.size).toBe(0);
    // On its way as the workspace is left, and the server never answers: not kept to be tried for good.
    store._forgotten.clear();
    store._localSeen.clear();
    store.wsId = REF;
    store.markRead('c1', 20);
    await until(() => held.length === 1);
    await store.forgetWorkspace(REF);
    held[0](Promise.reject(new TypeError('fetch failed')));
    await tick(30);
    expect(store._readRetry.size).toBe(0);
  });
});

describe('a read of a shared channel whose host asks for a fresh attestation', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(resetStore);

  /** This workspace with the entry s1 for the host's channel hc, a loaded link to the host, and hc unread past 5 with two mentions. */
  function armShared() {
    const channels = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    const a = boot('abc123def0', 'Acme', channels);
    store.wsId = REF;
    store.ws = a.workspace;
    store.me = { ...a.me, reads: { s1: 5 }, mentions: { s1: 2 } };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { s1: { s: 20 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.since = 1;
    const link = {
      ref: HOST, ws: { id: 'cccccc0000', name: 'Host', channels: { hc: { id: 'hc', name: 'hc' } }, members: {} }, me: { role: 'external', channels: ['hc'], dms: {}, reads: { hc: 5 }, mentions: { hc: 2 }, notify: {}, threads: {} },
      act: null, since: 1, w: 1, u: 0, convs: new Map([['hc', 's1']]), loaded: true, loading: null, syncing: null,
      error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {},
    };
    store.links = new Map([[HOST, link]]);
    return link;
  }
  const reattest = () => json({ code: 'reattest', message: 'Your standing here has lapsed' }, 403);
  const sync = () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 });
  /** The host's document as the reload brings it: the cursor and the mentions as they stood before the read. */
  const hostDoc = () => json({
    now: Date.now(),
    workspace: { id: 'cccccc0000', name: 'Host', channels: { hc: { id: 'hc', name: 'hc' } }, members: { 'u-me': { role: 'external', name: 'Me', username: 'me', exp: Date.now() + 86_400_000 } } },
    me: { role: 'external', channels: ['hc'], dms: {}, reads: { hc: 5 }, mentions: { hc: 2 }, notify: {}, threads: {} },
    activity: { c: { hc: { s: 20 } }, p: {}, w: 1, u: {} },
  });
  const readsTo = (calls) => calls.filter((c) => c === 'POST /api/ws/cccccc0000/conv/hc/read');

  it('is sent again once the link has renewed the standing, and the badge stays cleared meanwhile', async () => {
    let lapsed = true;
    const calls = worker({
      '/conv/hc/read': () => (lapsed ? reattest() : json({ ok: true })),
      '/api/ws/cccccc0000/sync': () => (lapsed ? reattest() : sync()),
      '/api/ws/abc123def0/sync': sync,
      '/attest': () => json({ conn: 'k1', token: 't', ref: HOST }),
      '/api/connect/join': () => { lapsed = false; return json({ ok: true, exp: Date.now() + 86_400_000 }); },
      '/api/ws/cccccc0000': () => (lapsed ? reattest() : hostDoc()),
    });
    const link = armShared();
    // Read to its end: the badge clears here at once, and the read goes out to the host, whose word is that the standing has lapsed.
    store.markRead('s1', 20);
    expect(store.me.mentions.s1).toBe(0);
    await until(() => readsTo(calls).length === 1);
    await tick(20);
    // The next poll's host sync meets the same word, and the link renews the standing and reads the host again.
    await store.poll();
    await until(() => calls.some((c) => c === 'POST /api/connect/join'));
    await until(() => !link.loading && link.loaded);
    expect(link.ws.members['u-me'].exp).toBeGreaterThan(Date.now());
    // The host's document predates the read: what the reader saw here stands over it.
    expect(store.me.mentions.s1).toBe(0);
    expect(store.unreadCount('s1')).toBe(0);
    // The read the host would not take is sent again now that it would, and lands.
    for (const r of store._readRetry.values()) r.nextAt = 0;
    await store.poll();
    await until(() => readsTo(calls).length === 2);
    await until(() => store.me.reads.s1 === 20 && link.me.reads.hc === 20);
    expect(store.me.mentions.s1).toBe(0);
    expect(store._readRetry.size).toBe(0);
  });

  it('is given up when the link is lost meanwhile, as any refusal is', async () => {
    const calls = worker({
      '/conv/hc/read': reattest,
      '/api/ws/abc123def0/sync': sync,
      '/api/ws/cccccc0000/sync': sync,
    });
    const link = armShared();
    store.markRead('s1', 20);
    await until(() => readsTo(calls).length === 1);
    await tick(20);
    // The connection is over (the host said so to the link): a read waiting on a renewal has nothing to wait for.
    link.lost = true;
    link.loaded = false;
    for (const r of store._readRetry.values()) r.nextAt = 0;
    await store.poll();
    await tick(30);
    expect(readsTo(calls)).toHaveLength(1);
    expect(store._readRetry.size).toBe(0);
    expect(store._seenAt.get('s1')?.acked).toBeGreaterThan(0);
  });
});

describe('a sync answered before the workspace was read afresh as the connection returned', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };

  it('does not move a conversation\'s counter, stamps or pin count back behind the fresher document', async () => {
    // The sync was computed with message 11 the newest; message 12 landed before the bootstrap was read.
    const calls = worker({
      '/api/ws/abc123def0/sync': () => json({ now: Date.now(), ts: Date.now(), c: { c1: { s: 11, t: 2000, u: 'u2', x: 5, pc: 1 } }, p: {}, w: 1, u: 0 }),
      '/api/ws/abc123def0': () => { const d = boot('abc123def0', 'Acme', channels); d.me.reads = { c1: 10 }; d.activity.c = { c1: { s: 12, t: 3000, u: 'u2', x: 6, pc: 2 } }; return json(d); },
    });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: { c1: 10 }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 10, t: 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.since = 1;
    store.offline = true; // shown from the offline copy: the first poll to get through reads the workspace afresh
    await store.poll();
    expect(calls.filter((c) => c.startsWith('GET /api/ws/abc123def0/sync'))).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith('GET /api/ws/abc123def0?') || c === 'GET /api/ws/abc123def0')).toHaveLength(1);
    expect(store.offline).toBe(false);
    expect(store.latestSeq('c1')).toBe(12);
    expect(store.unreadCount('c1')).toBe(2);
    expect(store.act.c.c1).toMatchObject({ s: 12, t: 3000, x: 6, pc: 2 });
  });

  it('still takes a sync that is newer than what stands, and one that says nothing new', () => {
    store.wsId = REF;
    store.act = { c: { c1: { s: 12, t: 3000, x: 6 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    // Newer: taken whole. Same counter, a later overlay stamp: taken (a reaction on a message that stands).
    expect(store._foldActivity({ c1: { s: 13, t: 4000, u: 'u2', x: 6 } }, null)).toMatchObject({ changed: true, newIn: [{ conv: 'c1', from: 'u2', seq: 13 }] });
    expect(store.act.c.c1).toMatchObject({ s: 13, t: 4000, x: 6 });
    expect(store._foldActivity({ c1: { s: 13, t: 4000, u: 'u2', x: 7 } }, null).changed).toBe(true);
    expect(store.act.c.c1.x).toBe(7);
    // Older by its overlay stamp alone (a snapshot from before the reaction): left where it stands.
    expect(store._foldActivity({ c1: { s: 13, t: 4000, u: 'u2', x: 6, pc: 9 } }, null).changed).toBe(false);
    expect(store.act.c.c1).toMatchObject({ s: 13, x: 7 });
    expect(store.act.c.c1.pc).toBeUndefined();
    // The same entry again: nothing moved.
    expect(store._foldActivity({ c1: { s: 13, t: 4000, u: 'u2', x: 7 } }, null).changed).toBe(false);
  });

  it('holds for a host\'s sync landing after the host was read afresh', async () => {
    const HOST = 'cccccc0000@teamchat-test';
    const a = boot('abc123def0', 'Acme', { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } });
    store.wsId = REF;
    store.ws = a.workspace;
    store.me = a.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    const link = {
      ref: HOST, ws: { id: 'cccccc0000', name: 'Host', channels: { hc: { id: 'hc', name: 'hc' } }, members: {} }, me: { role: 'external', channels: ['hc'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
      act: null, since: 1, w: 1, u: 0, convs: new Map([['hc', 's1']]), loaded: true, loading: null, syncing: null,
      error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {},
    };
    store.links = new Map([[HOST, link]]);
    // The host's fresh document left the channel at 12; its sync, asked for earlier, answers 11.
    store.act = { c: { s1: { s: 12, t: 3000 } }, p: {}, ps: {}, w: 1, u: 0 };
    await store._applyLinked([{ link, data: { now: Date.now(), c: { hc: { s: 11, t: 2000, u: 'u2' } }, p: {}, w: 1, u: 0 } }]);
    expect(store.latestSeq('s1')).toBe(12);
  });
});

describe('a poll that brings a new message and a changed overlay for one window at once', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const msg = (seq, extra = {}) => ({ seq, user: 'u2', text: `m${seq}`, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });

  it('fetches the message and re-reads the overlays in the same poll, not the overlays a poll later', async () => {
    const calls = worker({
      '/conv/c1/messages': (q) => {
        if (q.has('after')) return json({ messages: [msg(6)], seq: 6, hasMore: false });
        // The range read brings the reaction that came with the message.
        return json({ messages: [1, 2, 3, 4, 5].map((s) => msg(s, s === 3 ? { reactions: { tada: { u2: 1 } } } : {})), seq: 6, hasMore: false });
      },
    });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: { c1: 5 }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    Object.assign(store.conv('c1'), { loaded: true, seq: 5, xSeen: 0, messages: [1, 2, 3, 4, 5].map((s) => msg(s)) });
    // The sync said: a sixth message, and an overlay changed (someone reacted to the third).
    store.act = { c: { c1: { s: 6, x: 1, t: 6000 } }, p: {}, ps: {}, w: 1, u: 0 };
    const tasks = [];
    store._queueWindowUpdates(tasks);
    await Promise.all(tasks);
    const reads = calls.filter((c) => c.includes('/conv/c1/messages'));
    expect(reads.some((c) => c.includes('after=5'))).toBe(true);
    expect(reads.some((c) => c.includes('from=1') && c.includes('to=5'))).toBe(true);
    const c = store.conv('c1');
    expect(c.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(c.messages.find((m) => m.seq === 3).reactions).toEqual({ tada: { u2: 1 } });
    expect(c.xSeen).toBe(1);
    // The next poll with nothing new has nothing to read.
    const again = [];
    store._queueWindowUpdates(again);
    expect(again).toHaveLength(0);
  });
});

describe('a mention counted on the worker after the read of its message was taken', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const doc = ({ mentions, reads, c }) => {
    const d = boot('abc123def0', 'Acme', channels);
    d.me.reads = reads;
    d.me.mentions = mentions;
    d.activity.c = c;
    return d;
  };
  const readsOf = (calls) => calls.filter((c) => c === 'POST /api/ws/abc123def0/conv/c1/read');
  const msg = (seq, extra = {}) => ({ seq, user: 'u2', text: `m${seq}`, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });
  /** The channel open and read to message 11 (which names the reader unless told otherwise), the read taken by the worker; the count lands after it. */
  async function readTo11(calls, { names = true } = {}) {
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: { c1: 10 }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 11, t: 11_000, x: 500 } }, p: {}, ps: {}, w: 1, u: 1 };
    store.openConv = 'c1';
    Object.assign(store.conv('c1'), { loaded: true, seq: 11, messages: [msg(10), msg(11, names ? { mentions: ['u-me'] } : {})] });
    store.markRead('c1', 11);
    await until(() => readsOf(calls).length === 1);
    await until(() => store._seenAt.get('c1')?.acked > 0);
    expect(store.me.reads.c1).toBe(11);
    expect(store.mentionCount('c1')).toBe(0);
    await tick(5);
  }

  it('is cleared again, and the read sent once more, so the badge does not stand on a conversation read to its end', async () => {
    const bodies = [];
    const calls = worker({
      '/read': (_, init) => { bodies.push(JSON.parse(init.body)); return json({ ok: true }); },
      abc123def0: () => json(doc({ mentions: { c1: 1 }, reads: { c1: 11 }, c: { c1: { s: 11, t: 11_000, x: 500 } } })),
    });
    await readTo11(calls);
    // The count landed on the worker and had the workspace read again; the document carries it beside the cursor at 11.
    await store.refreshWorkspace();
    expect(store.me.reads.c1).toBe(11);
    expect(store.unreadCount('c1')).toBe(0);
    expect(store.mentionCount('c1')).toBe(0);
    expect(store.totalBadge()).toBe(0);
    // Healed once for that read: another document landing before the re-sent read is taken sends no further read, and the badge stays cleared.
    await store.refreshWorkspace();
    expect(store.mentionCount('c1')).toBe(0);
    await until(() => readsOf(calls).length === 2);
    expect(bodies[1]).toEqual({ seq: 11 });
    await until(() => store._seenAt.get('c1')?.acked > 0);
    await tick(30);
    expect(readsOf(calls)).toHaveLength(2);
  });

  it('leaves a mention in a thread of the channel, whose reply the document carries before the stamp it moves', async () => {
    const calls = worker({
      '/read': () => json({ ok: true }),
      // The reply's own thread entry is in; the channel's stamp for it is not yet.
      abc123def0: () => json(doc({ mentions: { c1: 1 }, reads: { c1: 11 }, c: { c1: { s: 11, t: 11_000, x: 500 }, c1_t7: { s: 3, t: Date.now(), u: 'u2' } } })),
    });
    await readTo11(calls);
    await store.refreshWorkspace();
    expect(store.mentionCount('c1')).toBe(1);
    await tick(30);
    expect(readsOf(calls)).toHaveLength(1);
  });

  it('leaves a count that reached the document before its message was announced, when the message the read reached names nobody', async () => {
    // The worker now counts a mention before it announces the message: a document read in between carries the count
    // for message 12 while the conversation still stands at 11, which the reader read and which does not name them.
    const calls = worker({
      '/read': () => json({ ok: true }),
      abc123def0: () => json(doc({ mentions: { c1: 1 }, reads: { c1: 11 }, c: { c1: { s: 11, t: 11_000, x: 500 } } })),
    });
    await readTo11(calls, { names: false });
    await store.refreshWorkspace();
    expect(store.mentionCount('c1')).toBe(1);
    await tick(30);
    expect(readsOf(calls)).toHaveLength(1);
  });

  it('leaves a mention in a message, or a change, that came after the read', async () => {
    let c = { c1: { s: 12, t: 12_000, x: 500 } }; // a newer message: the count may be its
    const calls = worker({
      '/read': () => json({ ok: true }),
      abc123def0: () => json(doc({ mentions: { c1: 1 }, reads: { c1: 11 }, c })),
    });
    await readTo11(calls);
    await store.refreshWorkspace();
    expect(store.mentionCount('c1')).toBe(1);
    // The channel's overlay stamp moved since the read (a reply counted on its root, whose thread entry this device never synced).
    c = { c1: { s: 11, t: 11_000, x: 900 } };
    store.act.c.c1 = { s: 11, t: 11_000, x: 500 };
    await store.refreshWorkspace();
    expect(store.mentionCount('c1')).toBe(1);
    await tick(30);
    expect(readsOf(calls)).toHaveLength(1);
  });
});

describe('the pins of a conversation asked for twice before the first answer lands', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };

  it('reach the worker once, and both callers get the same list; a forced reload still asks anew', async () => {
    const answers = [];
    const calls = worker({ '/pins': () => new Promise((r) => answers.push(r)) });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 5, pc: 1 } }, p: {}, ps: {}, w: 1, u: 0 };
    store._pins = new Map();
    // The pin bar and the details dialog both heard of the change and ask at once.
    const a = store.loadPins('c1');
    const b = store.loadPins('c1');
    await tick();
    expect(calls.filter((c) => c.endsWith('/conv/c1/pins'))).toHaveLength(1);
    answers[0](json({ pins: [{ seq: 3, by: 'u2', ts: 1, message: { seq: 3, text: 'pinned' } }] }));
    const [la, lb] = await Promise.all([a, b]);
    expect(la).toEqual(lb);
    expect(la).toHaveLength(1);
    // Cached from here while nothing about the conversation changed.
    expect(await store.loadPins('c1')).toBe(la);
    expect(calls.filter((c) => c.endsWith('/conv/c1/pins'))).toHaveLength(1);
    // A forced reload asks the worker again, and a plain call meanwhile shares that request.
    const f = store.loadPins('c1', { force: true });
    const g = store.loadPins('c1');
    await tick();
    expect(calls.filter((c) => c.endsWith('/conv/c1/pins'))).toHaveLength(2);
    answers[1](json({ pins: [] }));
    expect(await f).toEqual([]);
    expect(await g).toEqual([]);
  });

  it('is not shared with a caller asking after the conversation changed while it was on its way', async () => {
    const answers = [];
    const calls = worker({ '/pins': () => new Promise((r) => answers.push(r)) });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 5, pc: 1, x: 3 } }, p: {}, ps: {}, w: 1, u: 0 };
    store._pins = new Map();
    const first = store.loadPins('c1');
    await tick();
    // Someone else pinned meanwhile (the sync moved the stamp): the bar asks again, and must not be handed the older request's answer.
    store.act.c.c1 = { s: 5, pc: 2, x: 9 };
    const second = store.loadPins('c1');
    await tick();
    expect(calls.filter((c) => c.endsWith('/conv/c1/pins'))).toHaveLength(2);
    answers[0](json({ pins: [{ seq: 3 }] }));
    answers[1](json({ pins: [{ seq: 3 }, { seq: 5 }] }));
    expect(await first).toEqual([{ seq: 3 }]);
    expect(await second).toEqual([{ seq: 3 }, { seq: 5 }]);
    // What stands is the newer answer, and it serves the next asking.
    expect(await store.loadPins('c1')).toEqual([{ seq: 3 }, { seq: 5 }]);
    expect(calls.filter((c) => c.endsWith('/conv/c1/pins'))).toHaveLength(2);
  });

  it('does not lay an answer for one workspace into another opened meanwhile', async () => {
    const answers = [];
    worker({ '/pins': () => new Promise((r) => answers.push(r)) });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 5, pc: 1 } }, p: {}, ps: {}, w: 1, u: 0 };
    store._pins = new Map();
    const p = store.loadPins('c1');
    await tick();
    store._pins = new Map(); // the switch
    answers[0](json({ pins: [{ seq: 3 }] }));
    expect(await p).toEqual([{ seq: 3 }]);
    expect(store._pins.size).toBe(0);
  });
});

describe('a page of newer messages that could not be read', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const msg = (seq) => ({ seq, user: 'u2', text: `m${seq}`, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 });

  it('is said to the list, as an older page failing is, so it can offer the page again; not for a window replaced meanwhile', async () => {
    worker({ '/conv/c1/messages': () => json({ code: 'error', message: 'boom' }, 503) });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    // A window opened around an older message, paging forward.
    Object.assign(store.conv('c1'), { loaded: true, seq: 9, hasNewer: true, messages: [1, 2, 3, 4, 5].map(msg) });
    const events = [];
    const off = store.on('messages', (d) => { if (d.conv === 'c1') events.push(d.reason); });
    await expect(store.loadNewer('c1')).rejects.toMatchObject({ status: 503 });
    expect(events).toEqual(['newer-failed']);
    expect(store.conv('c1').loading).toBe(false);
    expect(store.conv('c1').hasNewer).toBe(true);
    // The window was replaced while the page was on its way (a permalink opened at another message): its failure is nobody's.
    events.length = 0;
    const c = store.conv('c1');
    const page = store.loadNewer('c1');
    c.gen = (c.gen || 0) + 1;
    await expect(page).rejects.toMatchObject({ status: 503 });
    expect(events).toEqual([]);
    off();
  });
});

describe('a time picked on a device whose clock is behind the workers\'', () => {
  afterEach(() => { store._clockOffset = 0; resetStore(); });
  const channels = { c1: { id: 'c1', name: 'general' } };
  const FIVE_MIN = 5 * 60_000;

  it('is sent as the workers\' moment for it, and comes back as the device\'s', async () => {
    const bodies = [];
    const calls = worker({
      '/scheduled': (_, init) => {
        if (init.method === 'POST') { const b = JSON.parse(init.body); bodies.push(b); return json({ scheduled: { id: 's1', kind: 'message', conv: b.conv, text: b.text, dueAt: b.dueAt, createdAt: 1 } }); }
        return json({ scheduled: [{ id: 's1', kind: 'message', conv: 'c1', text: 'later', dueAt: 1_000_000 + FIVE_MIN, createdAt: 1 }], reminders: [{ id: 'r1', kind: 'reminder', conv: 'c1', seq: 3, dueAt: 2_000_000 + FIVE_MIN, createdAt: 1 }] });
      },
      '/reminders': (_, init) => { const b = JSON.parse(init.body); bodies.push(b); return json({ reminder: { id: 'r1', kind: 'reminder', conv: b.conv, seq: b.seq, dueAt: b.dueAt, createdAt: 1 } }); },
      '/scheduled/s1': (_, init) => { bodies.push(JSON.parse(init.body)); return json({ ok: true }); },
    });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    // The workers' clock, learned with every sync, stands five minutes ahead of this device's.
    store._learnClock(Date.now() + FIVE_MIN);
    expect(store._clockOffset).toBeGreaterThanOrEqual(FIVE_MIN - 50);
    const offset = store._clockOffset;
    // "In a minute" by the device's clock: a minute from now on the workers' too, not four minutes ago. Picked
    // twenty-two seconds into its minute, clear of the snap a time within a few seconds of a minute gets (see _dueHere).
    const soon = Math.floor(Date.now() / 60_000) * 60_000 + 60_000 + 22_000;
    const scheduled = await store.schedule('c1', { text: 'later', dueAt: soon });
    expect(bodies[0].dueAt).toBe(soon + offset);
    expect(scheduled.dueAt).toBe(soon);
    const reminder = await store.remind('c1', 3, soon, 'note');
    expect(bodies[1].dueAt).toBe(soon + offset);
    expect(reminder.dueAt).toBe(soon);
    await store.updateScheduled({ id: 's1' }, { dueAt: soon + 60_000 });
    expect(bodies[2]).toEqual({ dueAt: soon + 60_000 + offset });
    // Lists come back in the device's time, so what was picked is what is shown.
    const lists = await store.loadScheduled();
    expect(lists.scheduled[0].dueAt).toBe(1_000_000);
    expect(lists.reminders[0].dueAt).toBe(2_000_000);
    expect(calls.some((c) => c.startsWith('GET ') && c.endsWith('/scheduled'))).toBe(true);
  });

  it('reads back on its minute when the offset has drifted by a breath since it was sent', () => {
    // "Tomorrow at 9" went out under an offset of five minutes; by the time the list is read the offset stands a few hundred milliseconds off.
    const nine = new Date(2026, 8, 7, 9, 0, 0, 0).getTime();
    store._clockOffset = FIVE_MIN + 400;
    expect(store._dueHere({ id: 's1', dueAt: nine + FIVE_MIN }).dueAt).toBe(nine);
    store._clockOffset = FIVE_MIN - 700;
    expect(store._dueHere({ id: 's1', dueAt: nine + FIVE_MIN }).dueAt).toBe(nine);
    // A time not picked to the minute ("in an hour", at 10:37:22) is read back as it was, within the drift.
    const odd = new Date(2026, 8, 7, 10, 37, 22, 0).getTime();
    store._clockOffset = FIVE_MIN + 400;
    expect(Math.abs(store._dueHere({ id: 's2', dueAt: odd + FIVE_MIN }).dueAt - odd)).toBeLessThanOrEqual(400);
    expect(store._dueHere({ id: 's3', dueAt: null }).dueAt).toBeNull();
  });
});

describe('a shared channel whose host workspace is deleted while the channel is open here', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(resetStore);

  it('is marked as a connection that is over when the host\'s sync says the workspace is gone, as its first read would', async () => {
    const calls = worker({
      '/api/ws/cccccc0000': () => json({ code: 'not_found', message: 'Workspace not found' }, 404),
    });
    const a = boot('abc123def0', 'Acme', { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } });
    store.wsId = REF;
    store.ws = a.workspace;
    store.me = { ...a.me, reads: { s1: 5 }, mentions: { s1: 1 }, dms: { h_dmz: { members: ['u-me', 'u-h'], host: HOST } } };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { s1: { s: 9 }, h_dmz: { s: 2 } }, p: {}, ps: {}, w: 1, u: 0 };
    const link = {
      ref: HOST, ws: { id: 'cccccc0000', name: 'Host', channels: { hc: { id: 'hc', name: 'hc' } }, members: {} }, me: { role: 'external', channels: ['hc'], dms: { dmz: { members: ['u-me', 'u-h'] } }, reads: { hc: 5 }, mentions: { hc: 1 }, notify: {}, threads: {} },
      act: null, since: 1, w: 1, u: 0, convs: new Map([['hc', 's1']]), loaded: true, loading: null, syncing: null,
      error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {},
    };
    store.links = new Map([[HOST, link]]);
    // The host's poll answers in the worker's own words: the workspace no longer exists.
    await store._applyLinked([{ link, error: new ApiError(404, 'not_found', 'Workspace not found') }]);
    await until(() => !link.loading);
    expect(calls.filter((c) => c.startsWith('GET /api/ws/cccccc0000'))).toHaveLength(1);
    expect(link.loaded).toBe(false);
    expect(link.lost).toBe(true);
    expect(store.postAccess('s1').reason).toBe('shared_lost');
    // Nothing of the host's is unread any more, and its direct message has left the list.
    expect(store.me.mentions.s1).toBeUndefined();
    expect(store.me.dms.h_dmz).toBeUndefined();
    expect(store.act.c.s1).toBeUndefined();
  });
});
