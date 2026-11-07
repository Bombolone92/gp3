/**
 * Twenty-second review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass21.test.js.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';

import { store } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';

const netError = () => Object.assign(new Error('Could not reach the workspace server'), { status: 0, code: 'network' });
const refused = () => Object.assign(new Error('That file is too large'), { status: 413, code: 'too_large' });

/* ---- the store, driven in node with a fake Puter (as tests/client-lib-pass21.test.js) ---- */

const REF = 'abc123def0@teamchat-test';
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
  store.huddles = {};
  store._localSeen.clear();
  store._seenAt.clear();
  store._unreadAt.clear();
  store._readRetry.clear();
  store._readAcked?.clear?.();
  store._quoted.clear();
  store.offline = false;
  store.since = 0;
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
  delete globalThis.puter;
}

const msg = (seq, text, extra = {}) => ({ seq, user: 'u-me', text, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });
const channels = { c1: { id: 'c1', name: 'general' }, c2: { id: 'c2', name: 'random' } };

/** A workspace open with channels c1 and c2, c1's window loaded and holding `messages`. */
function openChannel(messages, extra = {}) {
  store.wsId = REF;
  store.ws = boot('abc123def0', 'Acme', channels).workspace;
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  const newest = messages.reduce((n, m) => Math.max(n, m.seq), 0);
  store.act = { c: { c1: { s: newest, t: newest * 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.convs.clear();
  Object.assign(store.conv('c1'), { loaded: true, seq: newest, hasMore: false, messages, ...extra });
  return store.conv('c1');
}

describe('the quote card under a permalink whose message could not be read for a moment', () => {
  afterEach(resetStore);

  /** Ask for message 5 of c1 (not in the window), and what the store settles on for it. */
  const ask = async () => {
    const got = store.quotedMessage('c1', 5);
    return 'value' in got ? got.value : got.promise;
  };

  it('is asked for again on the next redraw after a 401 (Puter not confirming the sign-in for a moment), rather than shown as nothing for the rest of the session', async () => {
    let answer = () => json({ code: 'unauthorized', message: 'Your Puter session is not valid' }, 401);
    const calls = worker({ '/conv/c1/messages': () => answer() });
    openChannel([msg(1, 'a')]);
    expect(await ask()).toBeNull();
    // Puter answers again: the next render reads the message and draws the card.
    answer = () => json({ messages: [msg(5, 'the quoted one')], seq: 6, hasMore: false });
    expect(await ask()).toMatchObject({ seq: 5, text: 'the quoted one' });
    expect(calls.filter((c) => c.includes('/conv/c1/messages')).length).toBe(2);
    // Known now: answered at once, with no further request.
    expect(store.quotedMessage('c1', 5)).toEqual({ value: expect.objectContaining({ seq: 5 }) });
    expect(calls.filter((c) => c.includes('/conv/c1/messages')).length).toBe(2);
  });

  it('or after a bare 404 (the address not answering while the worker is redeployed), as for a network failure', async () => {
    let answer = () => new Response('<html>nope</html>', { status: 404, headers: { 'Content-Type': 'text/html' } });
    worker({ '/conv/c1/messages': () => answer() });
    openChannel([msg(1, 'a')]);
    expect(await ask()).toBeNull();
    answer = () => json({ messages: [msg(5, 'back')], seq: 6, hasMore: false });
    expect(await ask()).toMatchObject({ seq: 5, text: 'back' });
  });

  it('while the worker\'s own refusal (a conversation this member may not read, a message that is gone) still holds for the session', async () => {
    for (const [status, code] of [[403, 'forbidden'], [404, 'not_found']]) {
      const calls = worker({ '/conv/c1/messages': () => json({ code, message: 'no' }, status) });
      openChannel([msg(1, 'a')]);
      expect(await ask()).toBeNull();
      expect(await ask()).toBeNull();
      expect(store.quotedMessage('c1', 5)).toEqual({ value: null });
      expect(calls.filter((c) => c.includes('/conv/c1/messages')).length).toBe(1);
      store._quoted.clear();
    }
  });
});

describe('a queued message discarded while its file is going up', () => {
  it('stays discarded when the upload then fails for want of a connection: the entry is not written back, and the next flush sends nothing', async () => {
    const storage = memoryStorage();
    const sent = [];
    let box;
    let failUpload = true;
    box = createOutbox({
      storage,
      sendEntry: async (e) => { sent.push(e.text); },
      uploadFile: async () => {
        // Discard lands while the bytes are on their way; then the connection drops.
        await box.remove('m1');
        if (failUpload) throw netError();
        return { id: 'file0001', name: 'a.png' };
      },
    });
    await box.enqueue({ id: 'm1', ws: 'w', conv: 'c', text: 'with a picture', ts: 1, files: [{ name: 'a.png', blob: {} }] });
    expect(await box.flush()).toEqual({ sent: 0, left: 0 });
    expect(await storage.all()).toEqual([]);
    failUpload = false;
    expect(await box.flush()).toEqual({ sent: 0, left: 0 });
    expect(sent).toEqual([]);
  });

  it('stays discarded when the worker then refuses the file: not set aside as failed, to come back on the next reload', async () => {
    const storage = memoryStorage();
    let box;
    box = createOutbox({
      storage,
      sendEntry: async () => {},
      uploadFile: async () => {
        await box.remove('m2');
        throw refused();
      },
    });
    await box.enqueue({ id: 'm2', ws: 'w', conv: 'c', text: 'with a big file', ts: 1, files: [{ name: 'big.zip', blob: {} }] });
    await box.flush();
    expect(await storage.all()).toEqual([]);
  });

  it('while one that stands is still set aside with its reason, or tried again, as before', async () => {
    const storage = memoryStorage();
    let fail = netError();
    const box = createOutbox({
      storage,
      sendEntry: async () => {},
      uploadFile: async () => { throw fail; },
    });
    await box.enqueue({ id: 'm3', ws: 'w', conv: 'c', text: 'kept', ts: 1, files: [{ name: 'a.png', blob: {} }] });
    await box.flush();
    expect((await storage.all())[0]).toMatchObject({ id: 'm3', attempts: 1 });
    fail = refused();
    await box.flush();
    expect((await storage.all())[0]).toMatchObject({ id: 'm3', failed: true, lastError: 'That file is too large' });
  });
});

describe('a read the worker did not take because Puter could not confirm the sign-in for a moment (401)', () => {
  afterEach(resetStore);

  it('waits to be sent again with the next request that gets through, as one the server did not answer does, rather than being given up', async () => {
    let down = true;
    const bodies = [];
    const calls = worker({
      '/sync': () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 }),
      '/read': (_, init) => { bodies.push(JSON.parse(init.body)); return down ? json({ code: 'unauthorized', message: 'Your Puter session is not valid' }, 401) : json({ ok: true }); },
    });
    openChannel([msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd'), msg(5, 'e')]);
    store.since = 1;
    const reads = () => calls.filter((c) => c.endsWith('/conv/c1/read')).length;
    store.markRead('c1', 5);
    await until(() => reads() === 1);
    await tick(20);
    // Kept, to be sent again: not given up as a refusal, and not sent again on its own before a request gets through.
    expect(store._readRetry.size).toBe(1);
    expect(store.me.reads.c1).toBeUndefined();
    // Puter answers the worker again: the next sync that gets through sends the read, and the cursor follows.
    down = false;
    for (const r of store._readRetry.values()) r.nextAt = 0;
    await store.poll();
    await until(() => reads() === 2);
    await until(() => store._readRetry.size === 0);
    expect(bodies.map((b) => b.seq)).toEqual([5, 5]);
    expect(store.me.reads.c1).toBe(5);
  });
});

describe('a huddle heartbeat Puter could not confirm for a moment (401), or the worker held back (429)', () => {
  // Puter faked at `puter.peer` and `puter.workers.exec`, the media devices absent (listen-only), as in tests/huddle-store.test.js.
  const T0 = 1_700_000_000_000;
  class FakeStream {
    constructor() { this.id = 'st1'; }
    getAudioTracks() { return []; }
    getVideoTracks() { return []; }
    getTracks() { return []; }
    addTrack() {}
    removeTrack() {}
  }
  class FakeConn extends EventTarget {
    peerconnection = { signalingState: 'stable', addEventListener() {}, removeEventListener() {}, addTrack() { return {}; }, removeTrack() {}, close() {} };
    connected = false;
    send() {}
    close() {}
  }
  class FakeServer extends EventTarget {
    constructor(code) { super(); this.inviteCode = code; }
    close() {}
  }
  const roster = (at) => ({ by: 'u-me', at: T0, m: { 'u-me': { at, j: T0, inv: 'ME-1' }, 'u-ann': { at: T0, j: T0, inv: 'ANN-1' } } });
  let hadStream;
  beforeEach(() => { hadStream = globalThis.MediaStream; globalThis.MediaStream = FakeStream; });
  afterEach(async () => {
    await store.leaveHuddle({ tell: false });
    if (hadStream) globalThis.MediaStream = hadStream; else delete globalThis.MediaStream;
    resetStore();
  });

  it('keeps the seat and the call, the next beat trying again, rather than leaving the huddle with an error; a refusal proper still ends it with its word', async () => {
    let posts = 0;
    let answer = { status: 200 };
    globalThis.puter = {
      peer: { async serve() { return new FakeServer('ME-1'); }, async connect() { return new FakeConn(); } },
      workers: {
        exec: async (url, init = {}) => {
          const path = new URL(url).pathname;
          if (init.method === 'POST' && path.endsWith('/huddle')) {
            posts += 1;
            if (answer.status === 200) return json({ huddle: roster(T0 + posts * 1000), started: posts === 1, now: T0 + posts * 1000 });
            return json({ code: answer.code, message: answer.message }, answer.status);
          }
          if (init.method === 'DELETE') return json({ ok: true, ended: true });
          return json({ code: 'not_found', message: 'nope' }, 404);
        },
      },
    };
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', color: 1, prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Acme', channels: {}, members: { 'u-me': { username: 'me', name: 'Me', color: 1, role: 'owner' }, 'u-ann': { username: 'ann', name: 'Ann', color: 2, role: 'member' } } };
    store.me = { dms: { d1: { members: ['u-me', 'u-ann'] } }, channels: [], notify: {}, reads: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
    store.huddles = {};
    await store.joinHuddle('d1');
    expect(store.inHuddle('d1')).toBe(true);
    const errors = [];
    const off = store.on('huddle-error', (e) => errors.push(e));
    const beat = () => store._postHuddle(store.huddle, store._huddleInfo, store.huddle.inviteCode).catch(() => {});
    // Puter cannot confirm the sign-in as a beat goes out: the seat stands on the worker for another minute; the call goes on.
    answer = { status: 401, code: 'unauthorized', message: 'Your Puter session is not valid' };
    await beat();
    expect(store.huddle).not.toBeNull();
    expect(store.inHuddle('d1')).toBe(true);
    // The worker holding the request back: the same.
    answer = { status: 429, code: 'rate_limited', message: 'Too many requests' };
    await beat();
    expect(store.inHuddle('d1')).toBe(true);
    expect(errors).toEqual([]);
    // Answering again: the next beat keeps the seat as before.
    answer = { status: 200 };
    await beat();
    expect(store.inHuddle('d1')).toBe(true);
    expect(posts).toBe(4);
    // The worker's own word that the huddle cannot be had: the call is left, with the word.
    answer = { status: 403, code: 'forbidden', message: 'You are not in this channel any more' };
    await beat();
    expect(store.huddle).toBeNull();
    expect(errors).toEqual([{ kind: 'join', message: 'You are not in this channel any more' }]);
    off();
  });
});

describe('the host of a shared channel answering 401 (Puter not confirming the sign-in to it for a moment)', () => {
  const HOST = 'host00host@teamchat-test';
  afterEach(resetStore);

  /** A partner workspace with one entry for Acme's #design, which the member has joined here (as tests/store.test.js has it). */
  function partner() {
    store.wsId = REF;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.ws = { id: 'abc123def0', name: 'Globex', channels: { e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } } };
    store.me = { role: 'admin', channels: ['e1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.act = { c: {}, p: {}, w: 0, u: 0 };
  }
  const unauthorized = () => json({ code: 'unauthorized', message: 'Your Puter session is not valid' }, 401);
  const joinRoutes = (connectJoin) => ({
    '/channels/e1/join': () => json({ ok: true, shared: { ref: HOST, ch: 'hch', conn: 'conn000001', token: 'x.y' } }),
    '/api/connect/join': connectJoin,
    '/channels/e1/leave': () => json({ ok: true }),
    '/api/ws/abc123def0': () => json({ now: Date.now(), workspace: store.ws, me: { ...store.me, channels: ['e1'] }, activity: { c: {}, p: {} } }),
    '/api/ws/host00host': unauthorized,
  });

  it('is read as the host being out of reach for the moment, not as its refusal: the channel says it cannot be reached, and is asked again', async () => {
    partner();
    worker({ '/api/ws/host00host': unauthorized });
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect([link.loaded, link.lost]).toEqual([false, false]);
    expect(store.postAccess('e1')).toEqual({ ok: false, reason: 'shared_unreachable' });
    expect(link.retryAt).toBeGreaterThan(Date.now());
    expect(store.channel('e1').lost).toBeUndefined();
  });

  it('keeps a join whose word to the host was answered so, as one the host did not answer, for the link to finish; a refusal proper still takes the join back', async () => {
    partner();
    store.me.channels = [];
    const calls = worker(joinRoutes(unauthorized));
    await expect(store.joinChannel('e1')).rejects.toMatchObject({ status: 401 });
    expect(calls).not.toContain('POST /api/ws/abc123def0/channels/e1/leave');
    expect(store.isJoined('e1')).toBe(true);
    // The host's own refusal: joined here alone, the entry would show a host that keeps refusing, so the join is taken back (as before).
    store.me.channels = [];
    store.links = new Map();
    const again = worker(joinRoutes(() => json({ code: 'limit', message: 'The workspace hosting this channel is full' }, 400)));
    await expect(store.joinChannel('e1')).rejects.toMatchObject({ code: 'limit' });
    expect(again).toContain('POST /api/ws/abc123def0/channels/e1/leave');
    expect(store.isJoined('e1')).toBe(false);
  });
});

/* ---- the outbox behind the store, on a storage that settles in order (as IndexedDB does) ---- */

/**
 * An outbox for the store on a storage whose reads and writes settle in the
 * order they were asked, as IndexedDB's transactions on one store do: a
 * read asked before a delete answers with the entry still there. The
 * store's own outbox is swapped for it; `restore()` puts the original back.
 */
function orderedOutbox() {
  const mem = memoryStorage();
  let chain = Promise.resolve();
  const inOrder = (fn) => (...args) => {
    const turn = chain.then(() => fn(...args));
    chain = turn.catch(() => {});
    return turn;
  };
  const storage = { all: inOrder(mem.all), put: inOrder(mem.put), del: inOrder(mem.del) };
  const had = store.outbox;
  store.outbox = createOutbox({
    storage,
    owner: () => null,
    uploadFile: async () => ({ id: 'file0000' }),
    sendEntry: (e) => store._deliverQueued(e),
    onChange: () => { store._syncQueued().catch(() => {}); store.emit('outbox'); },
  });
  return { mem, storage, restore: () => { store.outbox = had; } };
}

describe('a message set aside for a channel the workspace no longer has, at the opening of the workspace', () => {
  let box;
  afterEach(async () => {
    box?.restore();
    box = null;
    resetStore();
  });

  it('is let go without leaving a placeholder behind in a window nothing can show (the drop and the restore both read the outbox as the workspace opens)', async () => {
    box = orderedOutbox();
    worker({
      '/api/ws/abc123def0': () => json(boot('abc123def0', 'Acme', channels)),
    });
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    await box.storage.put({ id: 'c_ghost01', ws: REF, conv: 'gone', text: 'for a deleted channel', ts: 1, failed: true, lastError: 'Channel not found' });
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.openWorkspace(REF);
    for (let i = 0; i < 200 && (await box.mem.all()).length; i++) await tick(10);
    expect(await box.mem.all()).toEqual([]);
    await tick(20);
    off();
    expect(notices).toEqual([expect.stringMatching(/for a deleted channel/)]);
    // No window stands for the channel with the dropped message in it.
    expect(store.convs.get('gone')?.messages ?? []).toEqual([]);
  });
});

describe('the placeholder of a queued message whose entry is gone from the device\'s store (discarded, or sent, from another tab of this browser)', () => {
  let box;
  afterEach(async () => {
    box?.restore();
    box = null;
    resetStore();
  });

  it('leaves the conversation with the next poll, rather than standing as "Queued" until the tab is reloaded; one whose entry stands stays, and a live send of this tab still on its way is left alone', async () => {
    box = orderedOutbox();
    worker({ '/sync': () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 }) });
    openChannel([msg(1, 'a')]);
    store.since = 1;
    await box.storage.put({ id: 'c_othertab1', ws: REF, conv: 'c1', text: 'discarded elsewhere', ts: 2 });
    await box.storage.put({ id: 'c_othertab2', ws: REF, conv: 'c1', text: 'still waiting', ts: 3, failed: true, lastError: 'Only admins can post' });
    await store._restoreQueued();
    const pending = { seq: null, tempId: 'c_live', cid: 'c_live', user: 'u-me', text: 'in flight', ts: 4, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, pending: true };
    store.conv('c1').messages.push(pending);
    expect(store.conv('c1').messages.map((m) => m.tempId ?? m.seq)).toEqual([1, 'c_othertab1', 'c_othertab2', 'c_live']);
    // Another tab discards the first: its word does not reach this tab's outbox, only the store they share.
    await box.mem.del('c_othertab1');
    const emits = [];
    const off = store.on('messages', (d) => emits.push(d));
    await store.poll();
    await tick(20);
    expect(store.conv('c1').messages.map((m) => m.tempId ?? m.seq)).toEqual([1, 'c_othertab2', 'c_live']);
    expect(emits).toContainEqual({ conv: 'c1', reason: 'local' });
    // Nothing more to do: the next poll changes nothing and says nothing of the conversation.
    emits.length = 0;
    await store.poll();
    await tick(20);
    off();
    expect(store.conv('c1').messages).toHaveLength(3);
    expect(emits.filter((d) => d.conv === 'c1')).toEqual([]);
  });
});

describe('a message of one\'s own sent later, going out at its time, when this tab cannot tell whether the worker moved the cursor to it', () => {
  afterEach(resetStore);
  const delivered = { s: 6, t: 6000, u: 'u-me', q: 6 };
  /**
   * c1 at 5, read to 5 on the worker from another device; this tab's copy of
   * the cursor stands behind at `read` (a read moves no stamp, so no
   * document brought it). The message goes out as 6; the worker's document
   * then has the cursor at `docRead`.
   */
  const setUp = (read, docRead) => {
    const calls = worker({
      '/sync': () => json({ now: Date.now(), ts: Date.now(), c: { c1: delivered }, p: {}, w: 1, u: 0 }),
      '/conv/c1/messages': () => json({ messages: [msg(6, 'sent later')], seq: 6, hasMore: false }),
      '/api/ws/abc123def0': () => {
        const b = boot('abc123def0', 'Acme', channels);
        b.me.reads = { c1: docRead };
        b.activity.c = { c1: delivered };
        return json(b);
      },
    });
    openChannel([msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd'), msg(5, 'e')]);
    store.me.reads.c1 = read;
    store.since = 1;
    return calls;
  };
  const docReads = (calls) => calls.filter((c) => c === 'GET /api/ws/abc123def0').length;

  it('reads the member document once, and the conversation then reads as the worker has it: read, when the cursor stood just before the message there', async () => {
    const calls = setUp(3, 6);
    await store.poll();
    await until(() => docReads(calls) === 1);
    await until(() => store.me.reads.c1 === 6);
    expect(store.unreadCount('c1')).toBe(0);
  });

  it('or unread, when messages the member had not seen stood between', async () => {
    const calls = setUp(3, 3);
    await store.poll();
    await until(() => docReads(calls) === 1);
    await tick(30);
    expect(store.me.reads.c1).toBe(3);
    expect(store.unreadCount('c1')).toBe(3);
  });

  it('and asks for no document when this tab\'s own cursor already says the message is read', async () => {
    const calls = setUp(5, 6);
    await store.poll();
    await tick(30);
    expect(docReads(calls)).toBe(0);
    expect(store.me.reads.c1).toBe(6);
    expect(store.unreadCount('c1')).toBe(0);
  });

  /** As setUp, but the poll's entry for c1 (and, with `more`, other conversations') is given, and the document's cursors with it. */
  const setUpFold = (read, entries, docReads) => {
    const calls = worker({
      '/sync': () => json({ now: Date.now(), ts: Date.now(), c: entries, p: {}, w: 1, u: 0 }),
      '/conv/c1/messages': (q) => json({ messages: [msg(6, 'sent later'), msg(7, 'and another')].filter((m) => m.seq > Number(q.get('after') || 0) && m.seq <= entries.c1.s), seq: entries.c1.s, hasMore: false }),
      '/conv/c2/messages': () => json({ messages: [msg(3, 'elsewhere')], seq: 3, hasMore: false }),
      '/api/ws/abc123def0': () => {
        const b = boot('abc123def0', 'Acme', channels);
        b.me.reads = docReads;
        b.activity.c = entries;
        return json(b);
      },
    });
    openChannel([msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd'), msg(5, 'e')]);
    store.me.reads.c1 = read;
    store.since = 1;
    return calls;
  };

  it('two deliveries into one conversation between two polls come as one entry, judged once: the document settles both (the worker moved the cursor to each in turn)', async () => {
    // The worker moved the cursor 5 -> 6 -> 7 as each went out; this tab's copy still says 5.
    const calls = setUpFold(5, { c1: { s: 7, t: 7000, u: 'u-me', q: 7 } }, { c1: 7 });
    await store.poll();
    await until(() => docReads(calls) === 1);
    await until(() => store.me.reads.c1 === 7);
    expect(store.unreadCount('c1')).toBe(0);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a live send from another tab (which moved the cursor to it) and then a delivery, in one poll: the same', async () => {
    // Another tab of the author posted 6 live (the worker moved their cursor to 6, no stamp to say so here),
    // then their scheduled 7 went out (cursor 6 >= 6: moved to 7). This tab's copy of the cursor still says 5.
    const calls = setUpFold(5, { c1: { s: 7, t: 7000, u: 'u-me', q: 7 } }, { c1: 7 });
    await store.poll();
    await until(() => docReads(calls) === 1);
    await until(() => store.me.reads.c1 === 7);
    expect(store.unreadCount('c1')).toBe(0);
  });

  it('deliveries into two conversations in one poll ask for the document once, and it judges both', async () => {
    store.act.c.c2 = { s: 2, t: 2000 };
    const calls = setUpFold(5, { c1: { s: 6, t: 6000, u: 'u-me', q: 6 }, c2: { s: 3, t: 3000, u: 'u-me', q: 3 } }, { c1: 6, c2: 1 });
    store.me.reads.c2 = 1;
    store.act.c.c2 = { s: 2, t: 2000 };
    await store.poll();
    await until(() => docReads(calls) === 1);
    await until(() => store.me.reads.c1 === 6);
    await tick(30);
    expect(docReads(calls)).toBe(1);
    // c1 read to 6 on the worker (the cursor had stood at 5 there); c2 had an unseen message before the delivery, and stays unread.
    expect(store.unreadCount('c1')).toBe(0);
    expect(store.me.reads.c2).toBe(1);
    expect(store.unreadCount('c2')).toBe(2);
  });
});

/* ---- the service worker, driven in node: its listeners registered on a fake `self` ---- */

/**
 * Load src/sw.js the way the build ships it (the version and asset list
 * filled in), against a fake `self` that records the listeners it adds.
 * `fire(type, event)` calls one and answers with what the handler gave
 * `waitUntil` (or nothing).
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

describe('a tap on a notification, with the app open in a window', () => {
  const scope = 'https://app.example/teamchat/';
  const window = ({ focus, id = 'w1' }) => {
    const posted = [];
    return { id, url: `${scope}#/`, focus, postMessage: (m) => posted.push(m), posted };
  };
  const notification = (route) => ({ notification: { close() {}, data: { route } } });

  it('brings the window up and tells it where to go; a focus the browser refuses still tells it, rather than ending the tap there', async () => {
    const opened = [];
    const ok = window({ focus: async () => {} });
    let sw = await loadServiceWorker({ clients: { matchAll: async () => [ok], openWindow: async (u) => opened.push(u) }, registration: { scope } });
    await sw.fire('notificationclick', notification('#/ws/abc123def0@teamchat-test/c/c1'));
    expect(ok.posted).toEqual([{ type: 'navigate', route: '#/ws/abc123def0@teamchat-test/c/c1' }]);
    expect(opened).toEqual([]);
    // The browser would not let the worker bring the window up (its rules on who may): the page is still told.
    const refused = window({ focus: async () => { throw new DOMException('Not allowed to focus a window', 'InvalidAccessError'); } });
    sw = await loadServiceWorker({ clients: { matchAll: async () => [refused], openWindow: async (u) => opened.push(u) }, registration: { scope } });
    await sw.fire('notificationclick', notification('#/ws/abc123def0@teamchat-test/c/c2')).catch(() => {});
    expect(refused.posted).toEqual([{ type: 'navigate', route: '#/ws/abc123def0@teamchat-test/c/c2' }]);
    expect(opened).toEqual([]);
  });

  it('opens a new window when the one it found closed meanwhile, or when there was none', async () => {
    const opened = [];
    const gone = window({ focus: async () => { throw new DOMException('The window is gone', 'InvalidStateError'); } });
    // The window is in the first listing, then closes before it can be brought up: a second listing no longer has it.
    let listings = 0;
    const sw = await loadServiceWorker({
      clients: { matchAll: async () => (listings++ === 0 ? [gone] : []), openWindow: async (u) => opened.push(u) },
      registration: { scope },
    });
    await sw.fire('notificationclick', notification('#/ws/abc123def0@teamchat-test/c/c3')).catch(() => {});
    expect(gone.posted).toEqual([]);
    expect(opened).toEqual([`${scope}#/ws/abc123def0@teamchat-test/c/c3`]);
    await sw.fire('notificationclick', notification('#/'));
    expect(opened).toEqual([`${scope}#/ws/abc123def0@teamchat-test/c/c3`, `${scope}#/`]);
  });
});

describe('a search remembered for the search box\'s dropdown', () => {
  let hadStorage;
  beforeEach(() => {
    hadStorage = globalThis.localStorage;
    const map = new Map();
    globalThis.localStorage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  });
  afterEach(() => {
    if (hadStorage) globalThis.localStorage = hadStorage; else delete globalThis.localStorage;
  });

  it('is kept no longer than the worker reads a query (what was searched for), so a paste of many kilobytes into the box is not stored eight times over per workspace', async () => {
    const { noteSearch, recentSearches } = await import('../src/lib/recent.js');
    const { LIMITS } = await import('../src/shared/limits.js');
    const long = `needle ${'x'.repeat(50_000)}`;
    noteSearch(REF, long);
    const [kept] = recentSearches(REF);
    expect(kept.length).toBe(LIMITS.searchQuery);
    expect(kept.startsWith('needle ')).toBe(true);
    // Cut between characters, never through one (an emoji at the cut).
    noteSearch(REF, `${'y'.repeat(LIMITS.searchQuery - 1)}😀 tail`);
    expect(recentSearches(REF)[0]).toBe('y'.repeat(LIMITS.searchQuery - 1));
    // A short query is kept as typed, trimmed; the same one again moves to the front rather than doubling.
    noteSearch(REF, '  budget  ');
    noteSearch(REF, 'budget');
    expect(recentSearches(REF).slice(0, 2)).toEqual(['budget', 'y'.repeat(LIMITS.searchQuery - 1)]);
    expect(recentSearches(REF).filter((q) => q === 'budget')).toHaveLength(1);
  });
});

/* ---- the sidebar's stars and sections, kept in the user's own document, changed from two tabs ---- */

describe('a star or a section changed in this tab after another tab changed the same workspace\'s', () => {
  let doc;
  /** The user's document as Puter holds it; another tab's write is a change to `doc` itself. */
  const kvUser = (sections, starred = []) => {
    doc = { v: 1, profile: { name: 'Me' }, prefs: { sections: { [REF]: sections }, starred: { [REF]: starred } }, workspaces: [], worker: null };
    globalThis.puter = { kv: { get: async () => structuredClone(doc), set: async (k, v) => { doc = structuredClone(v); } } };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = structuredClone(doc);
    store.wsId = REF;
    store._composeProfile();
  };
  afterEach(() => {
    store.identity = null;
    store.user = null;
    resetStore();
  });
  const S = { id: 's1', name: 'Projects', items: ['c1'] };
  const T = { id: 's2', name: 'Reading', items: ['c2'] };

  it('does not bring back a section the other tab deleted, nor put a conversation into it', async () => {
    kvUser([S, T]);
    // The other tab deletes Projects; this tab's copy of the document still lists it.
    doc.prefs.sections[REF] = [T];
    await store.renameSection('s2', 'Reading list');
    expect(doc.prefs.sections[REF]).toEqual([{ ...T, name: 'Reading list' }]);
    expect(store.sections()).toEqual([{ ...T, name: 'Reading list' }]);
    // Moving into the deleted section from a tab that still shows it: the conversation goes back to its default list, the section stays gone.
    store.user = { ...store.user, prefs: { ...store.user.prefs, sections: { [REF]: [S, { ...T, name: 'Reading list' }] } } };
    store._composeProfile();
    await store.moveToSection('c2', 's1');
    expect(doc.prefs.sections[REF]).toEqual([{ ...T, name: 'Reading list', items: [] }]);
  });

  it('keeps a star and a section the other tab added meanwhile', async () => {
    kvUser([S], ['c1']);
    doc.prefs.starred[REF] = ['c1', 'c9'];
    doc.prefs.sections[REF] = [S, T];
    await store.toggleStar('c3');
    expect(doc.prefs.starred[REF]).toEqual(['c1', 'c9', 'c3']);
    expect(doc.prefs.sections[REF]).toEqual([S, T]);
    await store.createSection('Later');
    expect(doc.prefs.sections[REF].map((s) => s.name)).toEqual(['Projects', 'Reading', 'Later']);
    await store.deleteSection('s1');
    expect(doc.prefs.sections[REF].map((s) => s.name)).toEqual(['Reading', 'Later']);
  });

  it('cuts a section\'s name to its forty characters between whole characters, never through an emoji or a flag, when made and when renamed', async () => {
    kvUser([]);
    const lone = (s) => /[\uD800-\uDBFF]$/.test(s);
    // Twenty-one emoji: forty units hold twenty whole ones.
    const id = await store.createSection('😀'.repeat(21));
    const name = () => doc.prefs.sections[REF].find((s) => s.id === id).name;
    expect(name()).toBe('😀'.repeat(20));
    // Off by one: the fortieth unit falls inside an emoji, which is left out whole rather than halved.
    await store.renameSection(id, `a${'😀'.repeat(21)}`);
    expect(name()).toBe(`a${'😀'.repeat(19)}`);
    expect(lone(name())).toBe(false);
    // A flag (two regional indicators, four units) at the edge: left out whole.
    await store.renameSection(id, `${'a'.repeat(37)}🇫🇷x`);
    expect(name()).toBe('a'.repeat(37));
    // Within the bound: kept whole, trimmed.
    await store.renameSection(id, '  Reading list  ');
    expect(name()).toBe('Reading list');
  });
});
