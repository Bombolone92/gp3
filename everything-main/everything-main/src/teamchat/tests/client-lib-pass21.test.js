/**
 * Twenty-first review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass19.test.js.
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';

import { store } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';
import { avatarUrl, clearAvatarCache } from '../src/lib/avatars.js';
import { attachmentUrl, clearAttachmentCache } from '../src/lib/files.js';
import { boot as bootRuntime, as, USERS, workspaceWith } from './helpers/harness.js';

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

describe('a photo or a file whose fetch failed while Puter could not confirm the sign-in', () => {
  afterEach(() => {
    vi.useRealTimers();
    clearAvatarCache();
    clearAttachmentCache();
    resetStore();
  });

  it('is asked for again soon, as when nobody answered, not remembered as refused for minutes like a 403 or a 404', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // The worker answers 401 for every request while Puter's word on the
    // caller cannot be had (see worker/lib.js identify); polls and sends
    // recover on their next try, and so must the pictures drawn meanwhile.
    const calls = worker({ '': () => json({ code: 'unauthorized', message: 'Your Puter session is not valid' }, 401) });
    const asked = (what) => calls.filter((c) => c.includes(what)).length;
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toMatchObject({ status: 401 });
    await expect(attachmentUrl(REF, 'f1')).rejects.toMatchObject({ status: 401 });
    // Not asked again on every redraw in the same moment.
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    await expect(attachmentUrl(REF, 'f1')).rejects.toBeTruthy();
    expect(asked('u-ann')).toBe(1);
    expect(asked('/files/f1')).toBe(1);
    // Puter is answering again within the minute: the next redraw asks again.
    vi.advanceTimersByTime(20_000);
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    await expect(attachmentUrl(REF, 'f1')).rejects.toBeTruthy();
    expect(asked('u-ann')).toBe(2);
    expect(asked('/files/f1')).toBe(2);
  });

  it('or while the host asked for a fresh attestation (403 reattest, renewed by the store on its own): asked for again soon, not remembered as refused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // An external member whose seat on the host lapsed: every request is
    // answered so until the link re-attests (which the next poll or send
    // does), and the pictures drawn meanwhile must follow once it has.
    const calls = worker({ '': () => json({ code: 'reattest', message: 'Your access to this shared channel needs renewing' }, 403) });
    const asked = (what) => calls.filter((c) => c.includes(what)).length;
    await expect(attachmentUrl(REF, 'f2')).rejects.toMatchObject({ status: 403, code: 'reattest' });
    await expect(avatarUrl(REF, 'u-ann', 5)).rejects.toMatchObject({ status: 403, code: 'reattest' });
    await expect(attachmentUrl(REF, 'f2')).rejects.toBeTruthy();
    expect(asked('/files/f2')).toBe(1);
    vi.advanceTimersByTime(20_000);
    await expect(attachmentUrl(REF, 'f2')).rejects.toBeTruthy();
    await expect(avatarUrl(REF, 'u-ann', 5)).rejects.toBeTruthy();
    expect(asked('/files/f2')).toBe(2);
    expect(asked('u-ann')).toBe(2);
    // A refusal proper (a 403 of any other kind) is still remembered for minutes.
    let refusals = 0;
    globalThis.puter.workers.exec = async () => { refusals++; return json({ code: 'forbidden', message: 'Not yours to download' }, 403); };
    await expect(attachmentUrl(REF, 'f3')).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    vi.advanceTimersByTime(20_000);
    await expect(attachmentUrl(REF, 'f3')).rejects.toBeTruthy();
    expect(refusals).toBe(1);
  });
});

describe('a queued message discarded while one of its files is going up', () => {
  const file = (name) => ({ name, type: 'image/png', blob: new Blob(['x'], { type: 'image/png' }) });

  it('is not written back around the upload, uploads nothing more, and is not sent', async () => {
    const sent = [];
    let release;
    let uploads = 0;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { sent.push(e.text); },
      // The first upload waits to be released; any later one (which must not
      // come) answers at once, so a run that goes on uploading fails rather than hangs.
      uploadFile: () => {
        uploads++;
        if (uploads > 1) return Promise.resolve({ id: `file000${uploads}` });
        return new Promise((r) => { release = () => r({ id: 'file0001' }); });
      },
    });
    await box.enqueue({ id: 'c_1', ws: 'w', conv: 'c', text: 'with two files', ts: 1, files: [file('a.png'), file('b.png')] });
    const flushing = box.flush();
    await until(() => !!release);
    // Discard is offered on the row while the file uploads (see ui/message.js): pressed now.
    await box.remove('c_1');
    release();
    expect(await flushing).toEqual({ sent: 0, left: 0 });
    expect(sent).toEqual([]);
    expect(uploads).toBe(1);
    expect(await box.list()).toEqual([]);
  });

  it('while another entry uploads is left alone: the other goes out as before', async () => {
    const sent = [];
    let release;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { sent.push(e.text); },
      uploadFile: () => new Promise((r) => { release = () => r({ id: 'file0001' }); }),
    });
    await box.enqueue({ id: 'c_1', ws: 'w', conv: 'c', text: 'first, with a file', ts: 1, files: [file('a.png')] });
    await box.enqueue({ id: 'c_2', ws: 'w', conv: 'c', text: 'second', ts: 2 });
    const flushing = box.flush();
    await until(() => !!release);
    await box.remove('c_2');
    release();
    expect(await flushing).toEqual({ sent: 1, left: 0 });
    expect(sent).toEqual(['first, with a file']);
  });
});

describe('Retry on a message set aside whose outbox entry is gone from the device\'s store', () => {
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  const setAside = (attachments) => {
    const temp = { seq: null, tempId: 'c_gone', cid: 'c_gone', user: 'u-me', text: 'hi', ts: 5, kind: 'msg', attachments, mentions: [], reactions: {}, replyCount: 0, queued: true, failed: true, error: { message: 'Not sent' } };
    store.conv('c1').messages.push(temp);
    return temp;
  };

  it('with a file still shown waiting under it says the file is no longer on this device, rather than sending the message without it or handing the worker a card with no file behind it', async () => {
    const posts = [];
    worker({ '/conv/c1/messages': (_, init) => { posts.push(JSON.parse(init.body)); return json({ message: msg(2, 'hi', { cid: 'c_gone' }) }); } });
    openChannel([msg(1, 'a')]);
    const temp = setAside([{ id: 'f0', name: 'note.txt', size: 3, type: 'text/plain' }, { name: 'pic.png', size: 5, type: 'image/png', uploading: true }]);
    await expect(store.retry('c1', temp)).rejects.toThrow(/no longer on this device/);
    expect(posts).toEqual([]);
    // The row stays, "Not sent" with the reason and its Retry and Discard, the card still under it.
    expect(store.conv('c1').messages).toContain(temp);
    expect(temp.failed).toBe(true);
    expect(temp.error.message).toMatch(/Discard the message and attach it again/);
    expect(temp.attachments).toHaveLength(2);
  });

  it('with its files all uploaded is sent once more under its client id, as a send that failed in flight is', async () => {
    const posts = [];
    worker({ '/conv/c1/messages': (_, init) => { posts.push(JSON.parse(init.body)); return json({ message: msg(2, 'hi', { cid: 'c_gone', attachments: [{ id: 'f0', name: 'note.txt', size: 3, type: 'text/plain' }] }) }); } });
    openChannel([msg(1, 'a')]);
    const temp = setAside([{ id: 'f0', name: 'note.txt', size: 3, type: 'text/plain' }]);
    const sent = await store.retry('c1', temp);
    expect(sent.seq).toBe(2);
    expect(posts).toEqual([{ text: 'hi', attachments: [{ id: 'f0' }], cid: 'c_gone' }]);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 2]);
  });
});

describe('an unsent message for a direct message on the host of a shared channel, once the workspace has no channel of that host left', () => {
  const HOST = 'hhhhhh1234@teamchat-host';
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  /** Workspace REF open with shared channel s1 on HOST, the link to the host loaded and carrying its direct message dm1. */
  function openWithLink() {
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'member', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    const link = { ref: HOST, ws: { channels: {}, members: {} }, me: { role: 'external', channels: ['hc'], dms: { dm1: { members: ['u-me', 'u-x'] } } }, convs: new Map([['hc', 's1']]), loaded: true, loading: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {}, conns: new Map([['hc', 'k1']]) };
    store.links = new Map([[HOST, link]]);
    store._mergeLinkMe(link);
    return link;
  }

  it('is let go with a word when the shared channel is removed from the workspace (the direct message leaves the sidebar with it), rather than sitting in the device\'s store for good', async () => {
    // The workspace document comes back without the shared channel: the link to its host goes with it (see _syncLinks).
    worker({ '/api/ws/abc123def0': () => json(boot('abc123def0', 'Acme', { c1: { id: 'c1', name: 'general' } })) });
    openWithLink();
    expect(Object.keys(store.me.dms)).toEqual(['h_dm1']);
    await store.outbox.enqueue({ id: 'q5', ws: REF, conv: 'h_dm1', host: HOST, hconv: 'dm1', text: 'for the host', ts: 1, failed: true, lastError: 'That message is too long' });
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.refreshWorkspace();
    expect(store.links.has(HOST)).toBe(false);
    expect(store.me.dms).toEqual({});
    await until(() => notices.length === 1, 1500);
    off();
    expect(notices[0]).toMatch(/for the host/);
    expect(await store.outbox.list()).toEqual([]);
  });
});

describe('a reply queued for a thread whose root was deleted before the connection came back', () => {
  // The store's requests go to the real worker on the in-memory runtime, as alice.
  let runtime;
  let wsId;
  let general;
  let ref;
  const alice = () => as(USERS.alice);
  beforeAll(async () => {
    runtime = await bootRuntime();
    ({ wsId, general } = await workspaceWith(USERS.alice, [USERS.bob]));
    ref = `${wsId}@teamchat-api`;
  });
  beforeEach(async () => {
    globalThis.puter = { workers: { exec: (url, init) => runtime.dispatch(url, init, USERS.alice) } };
    const doc = (await alice().get(`/api/ws/${wsId}`)).data;
    store.wsId = ref;
    store.ws = doc.workspace;
    store.me = doc.me;
    store.profile = { uuid: USERS.alice.uuid, username: 'alice', name: 'Alice', prefs: {} };
    store.act = { c: { ...(doc.activity.c || {}) }, p: {}, ps: {}, w: doc.activity.w || 0, u: 0 };
    store.convs.clear();
  });
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  it('is let go with a word naming the thread, whether the root went without a trace or stands as a tombstone, rather than set aside in a thread window nobody can open', async () => {
    const post = (conv, text) => alice().post(`/api/ws/${wsId}/conv/${conv}/messages`, { text });
    // A root deleted with no replies leaves nothing behind: no row, no thread to open.
    const bare = (await post(general.id, 'a root')).data.message.seq;
    expect((await alice().del(`/api/ws/${wsId}/conv/${general.id}/messages/${bare}`)).ok).toBe(true);
    // One deleted with replies stands as a tombstone, its thread closed.
    const tomb = (await post(general.id, 'another root')).data.message.seq;
    await as(USERS.bob).post(`/api/ws/${wsId}/conv/${general.id}_t${tomb}/messages`, { text: 'a reply' });
    expect((await alice().del(`/api/ws/${wsId}/conv/${general.id}/messages/${tomb}`)).ok).toBe(true);
    // The worker's own word for a reply into either thread.
    const refused = await post(`${general.id}_t${bare}`, 'too late');
    expect([refused.status, refused.data.code]).toEqual([404, 'not_found']);
    await store.loadConversation(general.id);
    await store.outbox.enqueue({ id: 'c_gonethread01', ws: ref, conv: `${general.id}_t${bare}`, text: 'late reply to nothing', ts: Date.now() - 2 });
    await store.outbox.enqueue({ id: 'c_gonethread02', ws: ref, conv: `${general.id}_t${tomb}`, text: 'late reply to a tombstone', ts: Date.now() - 1 });
    await store._restoreQueued();
    expect(store.conv(`${general.id}_t${bare}`).messages.map((m) => m.tempId)).toEqual(['c_gonethread01']);
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    off();
    expect(notices).toEqual([
      expect.stringMatching(/“late reply to nothing” was dropped: the thread it was written for no longer exists/),
      expect.stringMatching(/“late reply to a tombstone” was dropped: the thread it was written for no longer exists/),
    ]);
    expect(await store.outbox.list()).toEqual([]);
    expect(store.conv(`${general.id}_t${bare}`).messages).toEqual([]);
    expect(store.conv(`${general.id}_t${tomb}`).messages).toEqual([]);
  });

  it('stays in line when the address does not answer (a bare 404 is the worker being redeployed, not its word on the thread), and is set aside for a refusal of another kind', async () => {
    // Nobody at the address: not JSON, so read as no backend (see api.js), which the outbox tries again.
    worker({ '': () => new Response('<html>nope</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }) });
    openChannel([msg(1, 'a')]);
    await store.outbox.enqueue({ id: 'c_bare404', ws: REF, conv: 'c1_t1', text: 'reply', ts: 1 });
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    expect(notices).toEqual([]);
    expect((await store.outbox.list()).map((e) => [e.id, !!e.failed, e.attempts])).toEqual([['c_bare404', false, 1]]);
    // The worker's word that replies are off in the channel: set aside with the reason, as any refusal.
    worker({ '': () => json({ code: 'threads_off', message: 'Replies are turned off in #general' }, 403) });
    await store.outbox.flush();
    off();
    expect(notices).toEqual([]);
    expect((await store.outbox.list()).map((e) => [e.id, !!e.failed, e.lastError])).toEqual([['c_bare404', true, 'Replies are turned off in #general']]);
  });
});

describe('a reply of one\'s own landing in a thread', () => {
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  /** c1 open with a root at 2 (no replies yet) and its thread window loaded and empty; the thread route answers each reply with `ts()`. */
  function openThread(rootExtra = {}, before = () => {}) {
    let ts = 5000;
    let n = 0;
    worker({
      '/conv/c1_t2/messages': (_, init) => { before(); return json({ message: msg(++n, JSON.parse(init.body).text, { ts, cid: JSON.parse(init.body).cid }) }); },
    });
    const root = msg(2, 'root', { replyCount: 0, lastReplyAt: null, ...rootExtra });
    openChannel([msg(1, 'a'), root]);
    Object.assign(store.conv('c1_t2'), { loaded: true, seq: 0, hasMore: false, messages: [] });
    return { root, at: (v) => { ts = v; } };
  }

  it('moves the root\'s count and last-reply time in the parent window at once, said for the parent with nothing added; the worker\'s count wins when its re-read comes', async () => {
    const { root, at } = openThread();
    const emits = [];
    const off = store.on('messages', (d) => emits.push(d));
    await store.send('c1_t2', { text: 'first reply' });
    expect([root.replyCount, root.lastReplyAt]).toEqual([1, 5000]);
    expect(emits.filter((d) => d.conv === 'c1')).toEqual([{ conv: 'c1', reason: 'local' }]);
    at(6000);
    await store.send('c1_t2', { text: 'second reply' });
    expect([root.replyCount, root.lastReplyAt]).toEqual([2, 6000]);
    off();
    // The parent's overlay stamp moved: the re-read lays the worker's own count over the root.
    worker({ '/conv/c1/messages': () => json({ messages: [msg(1, 'a'), msg(2, 'root', { replyCount: 7, lastReplyAt: 9000 })], seq: 2, hasMore: false }) });
    await store.refreshRange('c1');
    const fresh = store.conv('c1').messages.find((m) => m.seq === 2);
    expect([fresh.replyCount, fresh.lastReplyAt]).toEqual([7, 9000]);
  });

  it('does not count a reply twice when the poll\'s re-read of the root landed before the send\'s own answer', async () => {
    // The worker writes the reply's own time as the root's last-reply time
    // (rt): a re-read that shows it already is told apart by that.
    const { root } = openThread({}, () => { root.replyCount = 1; root.lastReplyAt = 5000; });
    await store.send('c1_t2', { text: 'raced' });
    expect([root.replyCount, root.lastReplyAt]).toEqual([1, 5000]);
  });

  it('follows a queued reply delivered by the outbox the same way, leaves a deleted root alone, and does nothing for a workspace no longer open', async () => {
    const { root } = openThread();
    await store.outbox.enqueue({ id: 'c_qreply01', ws: REF, conv: 'c1_t2', text: 'queued reply', ts: 1 });
    await store._restoreQueued();
    await store.outbox.flush();
    expect([root.replyCount, root.lastReplyAt]).toEqual([1, 5000]);
    // A tombstone takes no count here (the worker refuses a reply to one anyway).
    const { root: tomb, at } = openThread({ deleted: true, replyCount: 3, lastReplyAt: 4000 });
    at(7000);
    await store.send('c1_t2', { text: 'into a closed thread' }).catch(() => {});
    expect([tomb.replyCount, tomb.lastReplyAt]).toEqual([3, 4000]);
    // Switched away while the reply was out (openWorkspace clears the
    // windows with the id): the root of the workspace left is not touched,
    // nor is another workspace's window of the same ids.
    const { root: other, at: at2 } = openThread({}, () => {
      store.wsId = 'other00000@teamchat-test';
      store.convs.clear();
      Object.assign(store.conv('c1'), { loaded: true, seq: 2, messages: [msg(2, 'a root of the same number elsewhere', { replyCount: 0, lastReplyAt: null })] });
    });
    at2(8000);
    await store.send('c1_t2', { text: 'after a switch' });
    expect([other.replyCount, other.lastReplyAt]).toEqual([0, null]);
    const elsewhere = store.conv('c1').messages.find((m) => m.seq === 2);
    expect([elsewhere.replyCount, elsewhere.lastReplyAt]).toEqual([0, null]);
  });
});

describe('a huddle peer who serves anew while the link to them still stands', () => {
  // The fake Puter Peer API of tests/huddle-client.test.js, in miniature.
  let streamN = 0;
  class FakeStream {
    constructor() { this.id = `st${++streamN}`; }
    getAudioTracks() { return []; }
    getVideoTracks() { return []; }
    getTracks() { return []; }
    addTrack() {}
    removeTrack() {}
  }
  const fakePc = () => ({ signalingState: 'stable', connectionState: 'new', addEventListener() {}, removeEventListener() {}, removeTrack() {}, close() {}, addTrack() { return { replaceTrack: () => Promise.resolve(), getParameters: () => ({}), setParameters: () => Promise.resolve() }; } });
  class FakeConn extends EventTarget {
    constructor() { super(); this.peerconnection = fakePc(); this.owner = null; this.connected = false; this.closed = false; this.closeReason = null; this.sent = []; }
    send(frame) { if (!this.connected) throw new Error('not open'); this.sent.push(JSON.parse(frame)); }
    close(reason) { if (this.closed) return; this.closed = true; this.connected = false; this.closeReason = reason; this.dispatchEvent(Object.assign(new Event('close'), { reason })); }
    open() { this.connected = true; this.dispatchEvent(new Event('open')); }
    receive(msg) { this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ v: 1, ...msg }) })); }
  }
  class FakeServer extends EventTarget {
    constructor(code) { super(); this.inviteCode = code; }
    close() {}
  }
  const fakePeer = (code) => {
    const api = { server: null, dials: [], async serve() { api.server = new FakeServer(code); return api.server; }, async connect(invite) { const conn = new FakeConn(); api.dials.push({ invite, conn }); return conn; } };
    return api;
  };
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  let hadStream;
  beforeEach(() => { hadStream = globalThis.MediaStream; globalThis.MediaStream = FakeStream; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); if (hadStream) globalThis.MediaStream = hadStream; else delete globalThis.MediaStream; });

  it('is dialled at the new code at once, not after the wait the old link\'s closing would have earned', async () => {
    const { Huddle } = await import('../src/lib/huddle.js');
    const api = fakePeer('BOB-1');
    const bob = new Huddle({ uuid: 'bob', name: 'Bob', isMember: () => true, peer: () => api, media: null });
    await bob.start();
    bob.syncRoster({ alice: { at: Date.now(), j: 1000, inv: 'A1' } });
    await flush();
    const conn = api.dials[0].conn;
    conn.owner = { uuid: 'alice' };
    conn.open();
    conn.receive({ t: 'hello', uuid: 'alice', name: 'Alice', inv: 'A1' });
    const alice = bob.peers.get('alice');
    expect(alice.open).toBe(true);
    // Alice's server re-registered under a new code (or her seat moved to a
    // second device while this link still stood): the roster says so, and
    // the old link is stale. The new code is fresh word of where she is.
    bob.syncRoster({ alice: { at: Date.now(), j: 1000, inv: 'A2' } });
    await flush();
    expect(conn.closed).toBe(true);
    expect(conn.closeReason).toBe('peer re-served');
    expect(api.dials.map((d) => d.invite)).toEqual(['A1', 'A2']);
    expect(alice.dialing).toBe(true);
    expect(bob.peers.size).toBe(1);
    // The wait the closing had set is not kept over the fresh code: no second dial follows it.
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.dials.map((d) => d.invite)).toEqual(['A1', 'A2']);
    bob.leave();
  });
});
