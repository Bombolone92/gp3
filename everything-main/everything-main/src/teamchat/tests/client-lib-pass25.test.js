/**
 * Twenty-fifth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass24.test.js.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { store, isPlatformPage } from '../src/lib/store.js';
import { ApiError } from '../src/lib/api.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';
import { cachedObjectUrl } from '../src/lib/files.js';
import { formatMessage, previewText, highlightSnippet } from '../src/lib/format.js';
import { extractMentionNames, firstLinkOf, linkableText, LINK_RE } from '../src/shared/limits.js';

/* ---- a small workspace on a faked worker, as tests/client-lib-pass24.test.js has it ---- */

const REF = 'abc123def0@teamchat-test';
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
function openAcme() {
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = { id: 'abc123def0', name: 'Acme', channels: { c1: { id: 'c1', name: 'general' } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: { c1: { s: 1, t: 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.links = new Map();
  store._laterCache = new Map();
  store._scheduledCount = 0;
  store._reminderCount = 0;
}
function closeAcme() {
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  delete globalThis.puter;
}

/* ---- lib/store.js: the Later lists kept for reuse go once a change to them has landed ---- */

describe('a scheduled message deleted or changed while a list read is reused', () => {
  afterEach(closeAcme);

  it('is not counted again by a later read that reuses the list read during the deletion', async () => {
    openAcme();
    const onServer = { scheduled: [{ id: 's1', conv: 'c1', text: 'a', dueAt: Date.now() + 3_600_000 }, { id: 's2', conv: 'c1', text: 'b', dueAt: Date.now() + 7_200_000 }], reminders: [] };
    let release;
    const held = new Promise((r) => { release = r; });
    let lists = 0;
    worker({
      '/scheduled/s1': async (q, init) => {
        await held; // the delete is slow to land
        if (init.method === 'DELETE') onServer.scheduled = onServer.scheduled.filter((e) => e.id !== 's1');
        return json({ ok: true });
      },
      '/scheduled': async () => {
        lists++;
        return json({ scheduled: [...onServer.scheduled], reminders: [] });
      },
    });
    await store.loadScheduled(); // as the workspace opens
    expect(store.scheduledCount()).toBe(2);
    const deleting = store.deleteScheduled({ id: 's1' });
    await tick(5);
    // A host's link loads meanwhile and asks for the Later counts, reusing what was read lately (see _loadLink).
    await store.loadScheduled({ reuse: true });
    expect(store.scheduledCount()).toBe(2); // the delete has not landed: right so far
    expect(lists).toBe(2);
    release();
    await deleting;
    // The Later view puts the count right as the delete lands (see views.js removeEntry).
    store._scheduledCount = 1;
    // A second host answers and asks the same way: the list from before the
    // delete is not reused, and the message just deleted stays off the badge.
    await store.loadScheduled({ reuse: true });
    expect(lists).toBe(3);
    expect(store.scheduledCount()).toBe(1);
    // And a change to an entry the same way.
    onServer.scheduled = [{ id: 's2', conv: 'c1', text: 'b', dueAt: Date.now() + 7_200_000 }];
    worker({
      '/scheduled/s2': async (q, init) => {
        if (init.method === 'PATCH' || init.method === 'PUT' || init.method === 'POST') onServer.scheduled = [];
        return json({ ok: true });
      },
      '/scheduled': async () => {
        lists++;
        return json({ scheduled: [...onServer.scheduled], reminders: [] });
      },
    });
    await store.loadScheduled();
    expect(store.scheduledCount()).toBe(1);
    await store.updateScheduled({ id: 's2' }, { sendNow: true });
    await store.loadScheduled({ reuse: true });
    expect(store.scheduledCount()).toBe(0);
  });
});

/* ---- lib/store.js: one's own post clears the counts a read to the end clears, as the worker now does ---- */

describe('a live post of one\'s own, with a mention of oneself or unread replies standing on the conversation', () => {
  afterEach(closeAcme);

  /** A worker that takes posts (each the conversation's next number), answers the workspace document, and can hold that answer. */
  function acmeWorker() {
    const seqs = { c1: 3, c1_t1: 1 };
    const state = { holdDoc: null, docMentions: 1 };
    const calls = worker({});
    // Routed by hand: the helper matches path ends, and both conversations' posts end in /messages.
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      calls.push(`${init.method || 'GET'} ${u.pathname}${u.search}`);
      const post = /\/conv\/([^/]+)\/messages$/.exec(u.pathname);
      if (post && init.method === 'POST') {
        const conv = decodeURIComponent(post[1]);
        const body = JSON.parse(init.body);
        const seq = ++seqs[conv];
        return json({ message: { seq, user: 'u-me', text: body.text, ts: Date.now(), kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, cid: body.cid } });
      }
      if (u.pathname.endsWith('/scheduled') && init.method === 'POST') {
        const body = JSON.parse(init.body);
        return json({ scheduled: { id: 's1', conv: body.conv, text: body.text, dueAt: body.dueAt } });
      }
      if (u.pathname === '/api/ws/abc123def0') {
        if (state.holdDoc) await state.holdDoc;
        return json({ now: Date.now(), workspace: store.ws, me: { ...store.me, reads: { c1: 3 }, mentions: { c1: state.docMentions }, threads: { c1_t1: 2 } }, activity: { c: { c1: { s: 3, t: 3, u: 'u-dan', x: 0 } }, p: {}, w: 1, u: 0 } });
      }
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    return { calls, state };
  }

  it('zeroes the mention count and the thread\'s unread replies as the post is acknowledged, and says so to the badges', async () => {
    openAcme();
    acmeWorker();
    store.me.mentions = { c1: 1 };
    store.me.threads = { c1_t1: 2 };
    store.me.reads = { c1: 3 };
    store.act.c.c1 = { s: 3, t: 3, u: 'u-dan', x: 0 };
    store.conv('c1').loaded = true;
    let activity = 0;
    const off = store.on('activity', () => { activity++; });
    expect(store.mentionCount('c1')).toBe(1);
    expect(store.totalBadge()).toBe(3);
    const m = await store.send('c1', { text: 'on it' });
    expect(m.seq).toBe(4);
    expect(store.me.reads.c1).toBe(4);
    expect(store.mentionCount('c1')).toBe(0);
    expect(activity).toBeGreaterThan(0);
    // The thread's replies stand until one replies there.
    expect(store.threadUnread('c1_t1')).toBe(2);
    expect(store.threadBadge()).toBe(2);
    store.conv('c1_t1').loaded = true;
    await store.send('c1_t1', { text: 'thanks' });
    expect(store.threadUnread('c1_t1')).toBe(0);
    expect(store.threadBadge()).toBe(0);
    expect(store.totalBadge()).toBe(0);
    off();
  });

  it('keeps them cleared under a workspace document asked for before the post and answered after it', async () => {
    openAcme();
    const { state } = acmeWorker();
    store.me.mentions = { c1: 1 };
    store.me.threads = { c1_t1: 2 };
    store.me.reads = { c1: 3 };
    store.act.c.c1 = { s: 3, t: 3, u: 'u-dan', x: 0 };
    store.conv('c1').loaded = true;
    let release;
    state.holdDoc = new Promise((r) => { release = r; });
    const refreshing = store.refreshWorkspace(); // asked before the post: its answer predates it
    await tick(5);
    await store.send('c1', { text: 'on it' });
    expect(store.mentionCount('c1')).toBe(0);
    release();
    await refreshing;
    expect(store.mentionCount('c1')).toBe(0);
    expect(store.me.reads.c1).toBe(4);
    expect(store.threadUnread('c1_t1')).toBe(2); // not posted in: the document's word stands
    // A document asked for after the post is trusted: the worker has cleared the count itself by then (here it says 0).
    state.holdDoc = null;
    state.docMentions = 0;
    await store.refreshWorkspace();
    expect(store.mentionCount('c1')).toBe(0);
  });

  it('leaves them standing for a message scheduled for later, whose author is not looking when it goes', async () => {
    openAcme();
    acmeWorker();
    store.me.mentions = { c1: 1 };
    store.me.threads = { c1_t1: 2 };
    store.act.c.c1 = { s: 3, t: 3, u: 'u-dan', x: 0 };
    const dueAt = Math.floor(Date.now() / 60_000) * 60_000 + 22_000 + 3_600_000;
    await store.schedule('c1', { text: 'later', dueAt });
    expect(store.mentionCount('c1')).toBe(1);
    expect(store.threadUnread('c1_t1')).toBe(2);
  });
});

/* ---- lib/store.js: deleting a reply lowers the root's reply count at once, as a reply raises it ---- */

describe('deleting a reply of a thread', () => {
  afterEach(closeAcme);

  const msg = (seq, text, extra = {}) => ({ seq, user: 'u-dan', text, ts: 1000 + seq, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });

  /** A worker that takes deletions; the parent window holds the root (with `rootInWindow`) and the thread window its two replies. */
  function threaded({ rootInWindow = true } = {}) {
    openAcme();
    const calls = worker({});
    globalThis.puter.workers.exec = async (url, init = {}) => {
      const u = new URL(url);
      calls.push(`${init.method || 'GET'} ${u.pathname}`);
      if (init.method === 'DELETE' && /\/messages\/\d+$/.test(u.pathname)) return json({ ok: true });
      return json({ code: 'not_found', message: 'nope' }, 404);
    };
    const root = msg(1, 'root', { replyCount: 2, lastReplyAt: 1003 });
    const parent = store.conv('c1');
    parent.loaded = true;
    parent.messages = rootInWindow ? [root, msg(4, 'later')] : [msg(4, 'later')];
    parent.seq = 4;
    const thread = store.conv('c1_t1');
    thread.loaded = true;
    thread.messages = [msg(1, 'first reply'), msg(2, 'second reply')];
    thread.seq = 2;
    return { calls, root, parent, thread };
  }

  it('lowers the count on the root the channel window holds and says so for the channel', async () => {
    const { root, thread } = threaded();
    const events = [];
    const off = store.on('messages', (d) => events.push(d));
    await store.remove('c1_t1', 2, thread.messages[1]);
    expect(thread.messages.map((m) => m.seq)).toEqual([1]);
    expect(root.replyCount).toBe(1);
    expect(events.some((d) => d.conv === 'c1')).toBe(true);
    off();
    // The last reply too, and never below nothing.
    await store.remove('c1_t1', 1, thread.messages[0]);
    expect(root.replyCount).toBe(0);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 4]); // the root stands (it was not deleted)
  });

  it('leaves the count alone when the root itself is deleted (it stands as a tombstone over its replies)', async () => {
    const { root, parent } = threaded();
    await store.remove('c1', 1, root);
    expect(root.deleted).toBe(true);
    expect(root.replyCount).toBe(2);
    expect(parent.messages.map((m) => m.seq)).toEqual([1, 4]);
  });

  it('does not count a reply out twice: one a poll already took out of the thread window (and out of the count) is left as it is', async () => {
    const { root, thread } = threaded();
    // The poll's re-read dropped reply 2 and brought the worker's count before the deletion's own answer came.
    thread.messages = [thread.messages[0]];
    root.replyCount = 1;
    await store.remove('c1_t1', 2, msg(2, 'second reply'));
    expect(root.replyCount).toBe(1);
    expect(thread.messages.map((m) => m.seq)).toEqual([1]);
  });

  it('leaves a root the window does not hold, or a tombstone, to the poll, as a reply arriving does', async () => {
    const { thread } = threaded({ rootInWindow: false });
    await expect(store.remove('c1_t1', 2, thread.messages[1])).resolves.toBeUndefined();
    expect(thread.messages.map((m) => m.seq)).toEqual([1]);
    closeAcme();
    const { root, thread: t2 } = threaded();
    root.deleted = true;
    await store.remove('c1_t1', 2, t2.messages[1]);
    expect(root.replyCount).toBe(2);
  });
});

/* ---- a 403 page in the worker's place (a firewall's, a gateway's) is nobody's refusal ---- */

describe('a 403 answered as a page with none of the worker\'s words (a firewall or gateway in its place)', () => {
  afterEach(() => {
    if (store._timer) clearTimeout(store._timer);
    store._timer = null;
    store._readRetry.clear();
    store._seenAt.clear();
    store._localSeen.clear();
    store.huddle = null;
    store._huddleInfo = null;
    closeAcme();
  });
  const page = () => new Response('<html><body>Forbidden</body></html>', { status: 403, headers: { 'Content-Type': 'text/html' } });
  const own = () => json({ code: 'forbidden', message: 'You are not a member of this workspace' }, 403);

  it('is a passing failure, where the worker\'s own 403 is its word', async () => {
    expect(isPlatformPage(new ApiError(403, 'http_403', 'Request failed (403)'))).toBe(true);
    expect(isPlatformPage(new ApiError(403, 'forbidden', 'no'))).toBe(false);
    expect(isPlatformPage(new ApiError(502, 'http_502', 'gateway'))).toBe(true);
    expect(isPlatformPage(new ApiError(404, 'no_backend', 'none'))).toBe(false);
  });

  it('keeps the workspace and its polling on a poll and on the opening of the workspace, where the worker\'s own word stops the poll and is said', async () => {
    openAcme();
    let answer = page;
    worker({ '/sync': () => answer(), '/api/ws/abc123def0': () => answer() });
    store.since = 1;
    store._timer = setTimeout(() => {}, 60_000);
    const errors = [];
    const off = store.on('error', (e) => errors.push(e));
    await store.poll();
    expect(store._timer).not.toBeNull(); // polling goes on
    expect(errors.map((e) => e.code)).toEqual(['http_403']); // said, as a failure to reach the worker is
    // Opening the workspace behind such a page: refused for the moment, nothing forgotten.
    await expect(store.openWorkspace(REF)).rejects.toMatchObject({ status: 403, code: 'http_403' });
    expect(store._forgotten.has(REF)).toBe(false);
    // The worker's own word: the poll stops, for the shell to forget the workspace on it.
    openAcme();
    store.since = 1;
    store._timer = setTimeout(() => {}, 60_000);
    answer = own;
    await store.poll();
    expect(store._timer).toBeNull();
    expect(errors.at(-1).code).toBe('forbidden');
    off();
  });

  it('keeps a read to be sent again, a queued message in line, and a photo asked for again soon', async () => {
    openAcme();
    store.me.reads = { c1: 0 };
    store.act.c.c1 = { s: 1, t: 1 };
    worker({ '/read': () => page() });
    store.markRead('c1', 1);
    store._flushReads();
    await tick(20);
    expect(store._readRetry.get(store._readKey('c1'))).toBeTruthy();
    const outbox = createOutbox({
      storage: memoryStorage(), isOnline: () => true, owner: () => 'me', uploadFile: async () => ({ id: 'f' }),
      sendEntry: async () => { throw new ApiError(403, 'http_403', 'Request failed (403)'); },
    });
    await outbox.enqueue({ ws: REF, conv: 'c1', text: 'hi', attachments: [], files: [] });
    await outbox.flush();
    const [e] = await outbox.list();
    expect(e.failed).toBeFalsy();
    expect(e.attempts).toBe(1);
    const map = new Map();
    await cachedObjectUrl(map, 'a', () => Promise.reject(Object.assign(new Error('x'), { status: 403, code: 'http_403' }))).catch(() => {});
    await cachedObjectUrl(map, 'b', () => Promise.reject(Object.assign(new Error('x'), { status: 403, code: 'forbidden' }))).catch(() => {});
    expect(map.get('a').failedUntil - Date.now()).toBeLessThanOrEqual(15_000);
    expect(map.get('b').failedUntil - Date.now()).toBeGreaterThan(60_000);
  });

  it('keeps the seat in a huddle for the next beat, and a join whose word to the host met such a page', async () => {
    openAcme();
    store.me.dms = { d1: { members: ['u-me', 'u-ann'] } };
    let answer = page;
    const calls = worker({ '/huddle': () => answer() });
    const h = { inviteCode: 'ME-1', left: null, syncRoster() {}, leave(reason) { this.left = reason; } };
    const info = { ws: REF, conv: 'd1', ref: REF, hostConv: 'd1', posted: true, sid: 'sid1' };
    store.huddle = h;
    store._huddleInfo = info;
    const poke = store.pokeSync; // leaving pokes the poll; not in this test
    store.pokeSync = () => {};
    const errors = [];
    const off = store.on('huddle-error', (e) => errors.push(e));
    await store._postHuddle(h, info, 'ME-1').catch(() => {});
    expect(store.huddle).toBe(h);
    expect(errors).toEqual([]);
    answer = () => json({ code: 'forbidden', message: 'You are not in this channel any more' }, 403);
    await store._postHuddle(h, info, 'ME-1').catch(() => {});
    expect(store.huddle).toBeNull();
    expect(h.left).toBe('left');
    expect(errors.map((e) => e.message)).toEqual(['You are not in this channel any more']);
    off();
    store.pokeSync = poke;
    expect(calls.filter((c) => c.includes('/huddle'))).toHaveLength(2);
    // A shared channel's join: the host answered for by a page keeps the join here (as a 429 does; see above).
    closeAcme();
    const HOST = 'host00host@teamchat-test';
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Globex', channels: { e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } } };
    store.me = { role: 'admin', channels: [], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.links = new Map();
    const joinCalls = worker({
      '/channels/e1/join': () => json({ ok: true, shared: { ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' } }),
      '/api/connect/join': page,
      '/channels/e1/leave': () => json({ ok: true }),
      '/api/ws/abc123def0': () => json({ now: Date.now(), workspace: store.ws, me: { ...store.me, channels: ['e1'] }, activity: { c: {}, p: {} } }),
      '/api/ws/host00host': page,
    });
    await expect(store.joinChannel('e1')).rejects.toMatchObject({ status: 403, code: 'http_403' });
    expect(joinCalls).not.toContain('POST /api/ws/abc123def0/channels/e1/leave');
    expect(store.isJoined('e1')).toBe(true);
    const link = store.links.get(HOST);
    await link.loading;
    expect([link.loaded, link.lost]).toEqual([false, false]);
    // No attestation was made for a page: the host was not asking for one.
    expect(joinCalls.filter((c) => c.includes('/attest'))).toHaveLength(0);
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
  });
});

/* ---- src/sw.js: a push from a worker not yet redeployed is named as the page names its banner ---- */

/**
 * Load src/sw.js the way the build ships it, against a fake `self` that
 * records the listeners it adds (as tests/client-lib-pass22.test.js does);
 * `fire(type, event)` calls one and answers with what the handler gave `waitUntil`.
 */
async function loadServiceWorker({ clients, registration }) {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/sw.js', import.meta.url), 'utf8')
    .replace('__SW_VERSION__', '"test"')
    .replace('__SW_ASSETS__', '["./"]');
  const listeners = {};
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    clients,
    registration,
    location: { origin: 'https://app.example' },
    navigator: {},
    skipWaiting: () => {},
  };
  new Function('self', 'caches', 'fetch', src)(self, {}, () => Promise.reject(new Error('no network in the test')));
  const fire = (type, event) => {
    const e = { ...event, waitUntil(p) { this.done = p; } };
    listeners[type](e);
    return e.done ?? Promise.resolve();
  };
  return { fire, listeners };
}

describe('the name a push is shown under (what the browser coalesces the page\'s banner with)', () => {
  const push = (payload) => ({ data: { json: () => payload, text: () => JSON.stringify(payload) } });

  it('takes the workspace from the deep link when the worker named the push without it, and keeps a current worker\'s name as it is', async () => {
    const shown = [];
    const sw = await loadServiceWorker({
      clients: { matchAll: async () => [] },
      registration: { scope: 'https://app.example/', showNotification: async (title, opts) => shown.push({ title, ...opts }) },
    });
    // A worker from before the tags carried the workspace: the page names its banner `abc123def0@teamchat-test:mention-c1`.
    await sw.fire('push', push({ title: 'alice in #general', body: 'hey', tag: 'mention-c1', route: '#/ws/abc123def0@teamchat-test/c/c1/m/5', ws: 'abc123def0' }));
    expect(shown.at(-1)).toMatchObject({ title: 'alice in #general', tag: 'abc123def0@teamchat-test:mention-c1', data: { route: '#/ws/abc123def0@teamchat-test/c/c1/m/5' } });
    // A reply's, and a link into a thread.
    await sw.fire('push', push({ title: 'alice', body: 'an answer', tag: 'reply-c1_t3', route: '#/ws/abc123def0@teamchat-test/c/c1/t/3/m/9', ws: 'abc123def0' }));
    expect(shown.at(-1).tag).toBe('abc123def0@teamchat-test:reply-c1_t3');
    // A current worker's name stands as it came.
    await sw.fire('push', push({ title: 'alice', body: 'hi', tag: 'abc123def0@teamchat-test:message-dm_x', route: '#/ws/abc123def0@teamchat-test/c/dm_x/m/2', ws: 'abc123def0' }));
    expect(shown.at(-1).tag).toBe('abc123def0@teamchat-test:message-dm_x');
    // A link written the page's way (the reference percent-encoded) reads the same.
    await sw.fire('push', push({ title: 't', body: 'b', tag: 'mention-c2', route: '#/ws/abc123def0%40teamchat-test/c/c2/m/1' }));
    expect(shown.at(-1).tag).toBe('abc123def0@teamchat-test:mention-c2');
    // Nothing to read the workspace from: the tag as it came, or the default.
    await sw.fire('push', push({ title: 't', body: 'b', tag: 'mention-c3' }));
    expect(shown.at(-1).tag).toBe('mention-c3');
    await sw.fire('push', push({ title: 't', body: 'b' }));
    expect(shown.at(-1)).toMatchObject({ tag: 'teamchat', data: { route: '#/' } });
  });
});

/* ---- lib/store.js: the read-only copy a move left behind takes no post, reply or pin ---- */

describe('posting rules on the read-only copy of a workspace that moved to another server', () => {
  afterEach(closeAcme);

  it('say the copy moved, for a channel, its threads, a direct message and a channel hosted elsewhere, before any other rule', () => {
    openAcme();
    store.ws.channels.e1 = { id: 'e1', name: 'design-acme', shared: { ref: 'host00host@teamchat-test', ch: 'hch', conn: 'conn000001', host: 'Acme' } };
    store.me.channels = ['c1', 'e1'];
    store.me.dms = { dm_1: { members: ['u-me', 'u-ann'] } };
    expect(store.postAccess('c1')).toEqual({ ok: true, reason: null });
    expect(store.postAccess('c1', { thread: true })).toEqual({ ok: true, reason: null });
    store.ws.movedTo = 'abc123def0@teamchat-new';
    for (const conv of ['c1', 'dm_1', 'e1']) {
      expect(store.postAccess(conv)).toEqual({ ok: false, reason: 'moved' });
      expect(store.postAccess(conv, { thread: true })).toEqual({ ok: false, reason: 'moved' });
    }
    expect(store.canHuddle('c1')).toBe(false);
    // The rules that follow are the worker's order too: an archived channel of a moved copy is read as moved.
    store.ws.channels.c1.archived = true;
    expect(store.postAccess('c1').reason).toBe('moved');
    delete store.ws.movedTo;
    expect(store.postAccess('c1').reason).toBe('archived');
  });
});

/* ---- lib/store.js: a gateway's 429 to a join's word to the host is no refusal of the host's ---- */

describe('the host of a shared channel answered for by a busy gateway (a 429 with a page, no JSON)', () => {
  const HOST = 'host00host@teamchat-test';
  afterEach(closeAcme);

  /** A partner workspace with one entry for Acme's #design (as tests/client-lib-pass22.test.js has it). */
  function partner() {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Globex', channels: { e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } } };
    store.me = { role: 'admin', channels: [], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
    store.links = new Map();
  }
  const busy = () => new Response('<html><body>Too Many Requests</body></html>', { status: 429, headers: { 'Content-Type': 'text/html' } });

  it('keeps the join here for the link to finish, as a host that did not answer does, and the channel says the host cannot be reached', async () => {
    partner();
    const calls = worker({
      '/channels/e1/join': () => json({ ok: true, shared: { ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' } }),
      '/api/connect/join': busy,
      '/channels/e1/leave': () => json({ ok: true }),
      '/api/ws/abc123def0': () => json({ now: Date.now(), workspace: store.ws, me: { ...store.me, channels: ['e1'] }, activity: { c: {}, p: {} } }),
      '/api/ws/host00host': busy,
    });
    await expect(store.joinChannel('e1')).rejects.toMatchObject({ status: 429, code: 'http_429' });
    // Not taken back: the join stands, and the host is asked again by the link.
    expect(calls).not.toContain('POST /api/ws/abc123def0/channels/e1/leave');
    expect(store.isJoined('e1')).toBe(true);
    const link = store.links.get(HOST);
    expect(link).toBeTruthy();
    await link.loading;
    expect([link.loaded, link.lost]).toEqual([false, false]);
    expect(link.retryAt).toBeGreaterThan(Date.now());
    // Read as the host out of reach for the moment, not as its refusal
    // ("You are not in this channel on Acme just now"): nothing of the
    // member's standing was said by anyone.
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
  });
});

/* ---- lib/format.js: a lifted code span bounds an italic or struck run as the tag it becomes does ---- */

describe('emphasis against a code span, with nothing between', () => {
  const members = { alice: { uuid: 'u-a', name: 'Alice' } };
  const chips = (html) => [...html.matchAll(/class="mention[^"]*" data-uuid="([^"]*)"/g)].map((m) => m[1]);
  const hrefs = (html) => [...html.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);

  it('draws the chip the worker rings for: "`c`_@alice_" and "_@alice_`c`"', () => {
    for (const text of ['`c`_@alice_', '_@alice_`c`', 'run `npm test`~@alice~ please', '~@alice~`x`']) {
      expect(extractMentionNames(text)).toEqual(['alice']); // the worker's word: alice is rung
      const html = formatMessage(text, { members });
      expect(chips(html)).toEqual(['u-a']);
      expect(html).not.toMatch(/_@|@Alice<\/span>_|~@|@Alice<\/span>~/);
    }
  });

  it('links the address the worker previews: "_https://x.io/q_`c`" and "~https://x.io/q~`c`"', () => {
    for (const text of ['_https://x.io/q_`c`', '~https://x.io/q~`c`', '`c`_https://x.io/q_ now', 'see `c`~https://x.io/q~']) {
      expect(firstLinkOf(text)).toBe('https://x.io/q');
      const html = formatMessage(text);
      expect(hrefs(html)).toEqual(['https://x.io/q']); // not "https://x.io/q~", nor no link at all
      expect([...linkableText(text).matchAll(LINK_RE)].map((m) => m[0])).toEqual(['https://x.io/q']);
    }
  });

  it('italicizes and strikes against code as it does against bold, and the preview and the snippet read the same', () => {
    expect(formatMessage('`c`_x_ and `d`~y~')).toBe('<code class="code-inline">c</code><em>x</em> and <code class="code-inline">d</code><s>y</s>');
    expect(previewText('`c`_x_ and `d`~y~')).toBe('cx and dy');
    expect(highlightSnippet('`c`_x_ and `d`~y~', ['and'])).toBe('cx <mark>and</mark> dy');
    // Not inside a word after the code: "a `b`_c_d" keeps its underscores everywhere, as before.
    expect(formatMessage('a `b`_c_d')).toBe('a <code class="code-inline">b</code>_c_d');
    expect(previewText('a `b`_c_d')).toBe('a b_c_d');
    // The code's own text is never touched.
    expect(formatMessage('`_x_`_y_')).toBe('<code class="code-inline">_x_</code><em>y</em>');
    expect(previewText('`_x_`_y_')).toBe('_x_y');
  });
});
