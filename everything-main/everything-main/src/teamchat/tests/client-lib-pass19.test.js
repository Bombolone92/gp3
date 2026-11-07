/**
 * Nineteenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass18.test.js.
 */
import { describe, it, expect, afterEach, afterAll, beforeAll, beforeEach, vi } from 'vitest';

import { store } from '../src/lib/store.js';
import { formatMessage, previewText, highlightSnippet } from '../src/lib/format.js';
import { highlight } from '../src/lib/highlight.js';
import { avatarUrl, clearAvatarCache } from '../src/lib/avatars.js';
import { attachmentUrl, clearAttachmentCache } from '../src/lib/files.js';
import { setDraft, getDraft, listDrafts, draftKey, _resetDraftCache } from '../src/lib/drafts.js';
import { noteRecent, recentConvs, noteSearch, recentSearches } from '../src/lib/recent.js';
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

describe('a message written offline for a channel deleted meanwhile, sent the moment the connection is back', () => {
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  it('is let go with a word once the workspace document says the channel is gone, though the send was refused while the copy here still listed it', async () => {
    // The browser's 'online' event flushes the outbox at once, before the
    // sync has read the workspace afresh: the worker refuses the message for
    // a channel it no longer has, while the copy here still lists it.
    const gone = boot('abc123def0', 'Acme', { c1: channels.c1 });
    const calls = worker({
      '/conv/c2/messages': () => json({ code: 'not_found', message: 'Conversation not found' }, 404),
      '/api/ws/abc123def0': () => json(gone),
    });
    openChannel([msg(1, 'a')]);
    await store.outbox.enqueue({ id: 'q1', ws: REF, conv: 'c2', text: 'hello there, this is the note I wrote offline', ts: 1 });
    await store._restoreQueued();
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    // Refused with the channel still listed here: set aside, as for any refusal.
    expect((await store.outbox.list()).map((e) => [e.id, !!e.failed])).toEqual([['q1', true]]);
    expect(notices).toEqual([]);
    // The sync then reads the workspace afresh and finds the channel gone.
    await store.refreshWorkspace();
    expect(store.channel('c2')).toBeFalsy();
    await until(() => notices.length === 1);
    off();
    expect(notices[0]).toMatch(/dropped/);
    expect(notices[0]).toContain('“hello there, this is the note I wrote');
    expect(await store.outbox.list()).toEqual([]);
    expect(store.conv('c2').messages).toEqual([]);
    expect(calls.filter((c) => c.includes('/conv/c2/messages'))).toHaveLength(1);
  });

  it('leaves a message set aside for another reason where it is, and one for a channel that still exists', async () => {
    worker({
      '/conv/c2/messages': () => json({ code: 'not_joined', message: 'Join the channel to post' }, 403),
      '/api/ws/abc123def0': () => json(boot('abc123def0', 'Acme', channels)),
    });
    openChannel([msg(1, 'a')]);
    await store.outbox.enqueue({ id: 'q2', ws: REF, conv: 'c2', text: 'still here', ts: 1 });
    await store._restoreQueued();
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    expect((await store.outbox.list()).map((e) => [e.id, !!e.failed])).toEqual([['q2', true]]);
    await store.refreshWorkspace();
    await tick(20);
    off();
    expect(notices).toEqual([]);
    expect((await store.outbox.list()).map((e) => e.id)).toEqual(['q2']);
    expect(store.conv('c2').messages.map((m) => m.tempId)).toEqual(['q2']);
  });
});

describe('message windows read from the worker itself, with deletions at the block boundaries', () => {
  // The store's requests go to the real worker on the in-memory runtime, as alice.
  let runtime;
  let wsId;
  let general;
  let ref;
  const post = (text) => as(USERS.alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text });
  const seqs = (id = general.id) => store.conv(id).messages.filter((m) => m.seq != null).map((m) => m.seq);
  /** Every message the worker still holds, oldest first, and its counter: the truth the windows are held to (system lines included). */
  let truth = [];
  let total = 0;
  async function readTruth() {
    const out = [];
    let after = 0;
    for (;;) {
      const page = (await as(USERS.alice).get(`/api/ws/${wsId}/conv/${general.id}/messages?after=${after}`)).data;
      out.push(...page.messages.map((m) => m.seq));
      total = page.seq;
      if (!page.hasMore || !page.messages.length) break;
      after = page.messages[page.messages.length - 1].seq;
    }
    truth = out;
  }
  beforeAll(async () => {
    runtime = await bootRuntime();
    ({ wsId, general } = await workspaceWith(USERS.alice, [USERS.bob]));
    ref = `${wsId}@teamchat-api`;
    globalThis.puter = { workers: { exec: (url, init) => runtime.dispatch(url, init, USERS.alice) } };
    for (let i = 1; i <= 120; i++) await post(`m${i}`);
    for (const s of [50, 51, 100, 101]) await as(USERS.alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${s}`);
  });
  beforeEach(async () => {
    globalThis.puter = { workers: { exec: (url, init) => runtime.dispatch(url, init, USERS.alice) } };
    const doc = (await as(USERS.alice).get(`/api/ws/${wsId}`)).data;
    store.wsId = ref;
    store.ws = doc.workspace;
    store.me = doc.me;
    store.profile = { uuid: USERS.alice.uuid, username: 'alice', name: 'Alice', prefs: {} };
    store.act = { c: { ...(doc.activity.c || {}) }, p: {}, ps: {}, w: doc.activity.w || 0, u: 0 };
    store.convs.clear();
    await readTruth();
    expect(truth).not.toContain(50);
    expect(truth).toContain(52);
  });
  afterEach(resetStore);

  it('pages back over the boundaries (50/51 and 100/101 deleted) to every message that stands, and knows when the history is exhausted', async () => {
    await store.loadConversation(general.id);
    const c = store.conv(general.id);
    expect(c.loaded).toBe(true);
    expect(c.hasMore).toBe(true);
    let older = 0;
    while (c.hasMore && older < 10) {
      await store.loadOlder(general.id);
      older++;
    }
    expect(seqs()).toEqual(truth);
    expect(c.hasMore).toBe(false);
    expect(c.seq).toBe(total);
  });

  it('opens around a deleted message at a boundary, pages both ways to the rest, and a range refresh racing a newer page leaves that page alone', async () => {
    await store.loadAround(general.id, 51);
    const c = store.conv(general.id);
    expect(c.loaded).toBe(true);
    expect(seqs()).toEqual(truth.filter((s) => s >= 26 && s <= 76));
    expect(c.hasMore).toBe(true);
    expect(c.hasNewer).toBe(true);
    await Promise.all([store.refreshRange(general.id), store.loadNewer(general.id)]);
    expect(seqs()).toEqual(truth.filter((s) => s >= 26));
    expect(c.hasNewer).toBe(false);
    while (c.hasMore) await store.loadOlder(general.id);
    expect(seqs()).toEqual(truth);
  });

  it('opened at a message past the counter (a stale or mistyped link) shows the newest page rather than an empty conversation nothing can page from', async () => {
    await store.loadAround(general.id, 999);
    const c = store.conv(general.id);
    expect(c.loaded).toBe(true);
    // The newest page, as opening the conversation shows it: the message asked for is not there.
    expect(seqs().length).toBeGreaterThan(0);
    expect(seqs()[seqs().length - 1]).toBe(truth[truth.length - 1]);
    expect(c.hasNewer).toBe(false);
    // And opening the conversation again finds a window that can be read on from.
    const again = await store.loadConversation(general.id);
    expect(again.messages.filter((m) => m.seq != null).length).toBeGreaterThan(0);
  });

  it('jumps to a date before the first message and after the last', async () => {
    await store.jumpToDate(general.id, 0);
    expect(seqs()[0]).toBe(1);
    expect(store.conv(general.id).hasMore).toBe(false);
    store.convs.clear();
    await store.jumpToDate(general.id, Date.now() + 86_400_000);
    const c = store.conv(general.id);
    expect(c.hasNewer).toBe(false);
    expect(seqs()[seqs().length - 1]).toBe(truth[truth.length - 1]);
  });

  it('fills the gap behind an own message over a stretch the worker has since purged without laying anything in', async () => {
    await store.loadConversation(general.id);
    const c = store.conv(general.id);
    const before = seqs().length;
    // Ten messages by someone else, all deleted before alice's own lands.
    for (let i = 0; i < 10; i++) await as(USERS.bob).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: `b${i}` });
    for (let s = total + 1; s <= total + 10; s++) await as(USERS.bob).del(`/api/ws/${wsId}/conv/${general.id}/messages/${s}`);
    const sent = await store.send(general.id, { text: 'mine' });
    expect(sent.seq).toBe(total + 11);
    await tick(20);
    expect(seqs().length).toBe(before + 1);
    expect(seqs().some((s) => s > total && s < sent.seq)).toBe(false);
    expect(c.seq).toBe(sent.seq);
    // Tidy: the extra message would change what a later test expects of the history.
    await as(USERS.alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${sent.seq}`);
  });

  it('marks a thread unread from one of its replies: the cursor moves back here and on the worker, and the thread stays badged', async () => {
    const root = (await post('a root')).data.message.seq;
    const thread = `${general.id}_t${root}`;
    for (let i = 0; i < 3; i++) await as(USERS.bob).post(`/api/ws/${wsId}/conv/${thread}/messages`, { text: `reply ${i}` });
    // Alice has read the thread to its end.
    await as(USERS.alice).post(`/api/ws/${wsId}/conv/${thread}/read`, { seq: 3 });
    const doc = (await as(USERS.alice).get(`/api/ws/${wsId}`)).data;
    store.me = doc.me;
    store.act.c[thread] = { s: 3, t: Date.now() };
    expect(store.me.reads[thread]).toBe(3);
    await store.markUnread(thread, 2);
    expect(store.me.reads[thread]).toBe(1);
    expect(store.unreadCount(thread)).toBe(2);
    const after = (await as(USERS.alice).get(`/api/ws/${wsId}`)).data;
    expect(after.me.reads[thread]).toBe(1);
    // A cursor a stale document would put past the newest message counts nothing unread.
    store.me.reads[thread] = 9;
    expect(store.unreadCount(thread)).toBe(0);
  });

  describe('a message sent again under its client id after the worker had taken it and it was deleted', () => {
    const warns = [];
    let warn;
    beforeEach(() => {
      warn = console.warn;
      console.warn = (...a) => warns.push(a);
      warns.length = 0;
    });
    afterEach(async () => {
      console.warn = warn;
      for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    });

    it('from the outbox: the placeholder goes with a redraw, the entry is done, and nothing is warned about', async () => {
      const cid = 'c_dupdel00001';
      const first = (await as(USERS.alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'lost answer', cid })).data.message.seq;
      await as(USERS.alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${first}`);
      await store.loadConversation(general.id);
      await store.outbox.enqueue({ id: cid, ws: ref, conv: general.id, text: 'lost answer', ts: Date.now() });
      await store._restoreQueued();
      expect(store.conv(general.id).messages.some((m) => m.tempId === cid)).toBe(true);
      const emits = [];
      const off = store.on('messages', (d) => emits.push(d));
      await store.outbox.flush();
      off();
      expect(store.conv(general.id).messages.some((m) => m.tempId === cid)).toBe(false);
      expect(store.conv(general.id).messages.some((m) => m.seq === first)).toBe(false);
      expect(emits.some((d) => d.conv === general.id)).toBe(true);
      expect(await store.outbox.list()).toEqual([]);
      expect(warns).toEqual([]);
    });

    it('as a live retry: the send resolves with nothing and leaves no row, neither sent nor failed', async () => {
      const cid = 'c_dupdel00002';
      const first = (await as(USERS.alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'retried', cid })).data.message.seq;
      await as(USERS.alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${first}`);
      await store.loadConversation(general.id);
      const sent = await store.send(general.id, { text: 'retried', cid });
      expect(sent).toBeNull();
      expect(store.conv(general.id).messages.some((m) => m.cid === cid || m.seq === first)).toBe(false);
      expect(warns).toEqual([]);
    });

    it('whose original was a thread root with replies is answered as the tombstone, which takes the placeholder\'s place', async () => {
      const cid = 'c_duproot0003';
      const root = (await as(USERS.alice).post(`/api/ws/${wsId}/conv/${general.id}/messages`, { text: 'a root', cid })).data.message.seq;
      await as(USERS.bob).post(`/api/ws/${wsId}/conv/${general.id}_t${root}/messages`, { text: 'a reply' });
      await as(USERS.alice).del(`/api/ws/${wsId}/conv/${general.id}/messages/${root}`);
      await store.loadConversation(general.id);
      store.conv(general.id).messages = store.conv(general.id).messages.filter((m) => m.seq !== root);
      // With its attempt already counted, which is what an entry the worker
      // has taken always carries: the count goes on before the send, so an
      // entry that has been out once — whatever became of the answer — never
      // offers itself as a first send again (see the outbox, and `first`).
      await store.outbox.enqueue({ id: cid, ws: ref, conv: general.id, text: 'a root', ts: Date.now(), attempts: 1 });
      await store._restoreQueued();
      await store.outbox.flush();
      const placed = store.conv(general.id).messages.find((m) => m.seq === root);
      expect(placed).toBeTruthy();
      expect(placed.deleted).toBe(true);
      expect(placed.replyCount).toBe(1);
      expect(store.conv(general.id).messages.some((m) => m.tempId === cid)).toBe(false);
      expect(warns).toEqual([]);
    });
  });
});

describe('an unsent message for a direct message on the host of a shared channel', () => {
  const HOST = 'hhhhhh1234@teamchat-host';
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  /** Workspace REF open with shared channel s1 on HOST; the link to the host stands but has not loaded yet. */
  function openWithLink({ loaded }) {
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'member', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    const link = { ref: HOST, ws: { channels: {}, members: {} }, me: { role: 'external', channels: ['hc'], dms: { dm1: { members: ['u-me', 'u-x'] } } }, convs: new Map([['hc', 's1']]), loaded, loading: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {}, conns: new Map([['hc', 'k1']]) };
    store.links = new Map([[HOST, link]]);
    if (loaded) store._mergeLinkMe(link);
    return link;
  }

  it('set aside earlier is kept through a bootstrap made before the host has answered, since only the host knows its direct messages, and goes once the host lists no such conversation', async () => {
    const wsDoc = () => json(boot('abc123def0', 'Acme', { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } }));
    // The host is out of reach for now: its bootstrap hangs (the link is loading, neither loaded nor lost).
    worker({ '/api/ws/abc123def0': wsDoc, '/api/ws/hhhhhh1234': () => new Promise(() => {}) });
    const link = openWithLink({ loaded: false });
    await store.outbox.enqueue({ id: 'q3', ws: REF, conv: 'h_dm1', host: HOST, hconv: 'dm1', text: 'for the host', ts: 1, failed: true, lastError: 'That message is too long' });
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    // The link has not loaded: the direct message is not in this workspace's document, and cannot be.
    await store.refreshWorkspace();
    await tick(20);
    expect((await store.outbox.list()).map((e) => e.id)).toEqual(['q3']);
    expect(notices).toEqual([]);
    // The host answered and lists the direct message: kept still.
    link.loaded = true;
    store._mergeLinkMe(link);
    await store.refreshWorkspace();
    await tick(20);
    expect((await store.outbox.list()).map((e) => e.id)).toEqual(['q3']);
    expect(notices).toEqual([]);
    // The host lists no such direct message any more: gone.
    link.me.dms = {};
    store._mergeLinkMe(link);
    await store.refreshWorkspace();
    await until(() => notices.length === 1);
    off();
    expect(await store.outbox.list()).toEqual([]);
  });

  it('refused by the host before its link has loaded is set aside with the reason, not dropped as for a conversation that no longer exists', async () => {
    worker({ '/conv/dm1/messages': () => json({ code: 'too_long', message: 'That message is too long' }, 400) });
    openWithLink({ loaded: false });
    await store.outbox.enqueue({ id: 'q4', ws: REF, conv: 'h_dm1', host: HOST, hconv: 'dm1', text: 'for the host', ts: 1 });
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    off();
    expect(notices).toEqual([]);
    expect((await store.outbox.list()).map((e) => [e.id, !!e.failed, e.lastError])).toEqual([['q4', true, 'That message is too long']]);
  });
});

describe('leaving or removing a shared channel while the app is switched to another workspace', () => {
  const HOST = 'hhhhhh1234@teamchat-host';
  const OTHER = 'zzz999yyy8@teamchat-test';
  afterEach(resetStore);

  /** Workspace REF open with shared channel s1 (hosted as hc on HOST) joined; the other workspace has a channel of the same id (imports keep ids). */
  function openShared() {
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'admin', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.links = new Map([[HOST, { ref: HOST, ws: { channels: {}, members: {} }, me: { channels: ['hc'] }, convs: new Map([['hc', 's1']]), loaded: true, loading: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {} }]]);
  }
  function switchTo(other) {
    store.wsId = other;
    store.ws = boot('zzz999yyy8', 'Other', { s1: { id: 's1', name: 'same-id' } }).workspace;
    store.me = { role: 'member', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.links = new Map();
  }

  it('leaves the channel in the workspace it was asked in, and leaves the other workspace\'s channel of the same id alone', async () => {
    let releaseHost;
    const calls = worker({
      '/channels/hc/leave': () => new Promise((r) => { releaseHost = () => r(json({ ok: true })); }),
      '/channels/s1/leave': () => json({ ok: true }),
      '/api/ws/abc123def0': () => json(boot('abc123def0', 'Acme', {})),
      '/api/ws/zzz999yyy8': () => json(boot('zzz999yyy8', 'Other', { s1: { id: 's1', name: 'same-id' } })),
    });
    openShared();
    const left = store.leaveChannel('s1');
    await until(() => !!releaseHost);
    switchTo(OTHER);
    releaseHost();
    await left;
    expect(calls.filter((c) => c.includes('/channels/s1/leave'))).toEqual(['POST /api/ws/abc123def0/channels/s1/leave']);
    // The workspace now open keeps its own channel of that id.
    expect(store.me.channels).toEqual(['s1']);
  });

  it('removes the shared channel from the workspace it was asked in, not from the one switched to', async () => {
    let releaseHost;
    const calls = worker({
      '/channels/s1/attest': () => json({ ref: HOST, conn: 'k1', token: 't' }),
      '/api/connect/disconnect': () => new Promise((r) => { releaseHost = () => r(json({ ok: true })); }),
      '/channels/s1': () => json({ ok: true }),
      '/api/ws/abc123def0': () => json(boot('abc123def0', 'Acme', {})),
      '/api/ws/zzz999yyy8': () => json(boot('zzz999yyy8', 'Other', { s1: { id: 's1', name: 'same-id' } })),
    });
    openShared();
    const removed = store.disconnectShared('s1');
    await until(() => !!releaseHost);
    switchTo(OTHER);
    releaseHost();
    await removed;
    expect(calls.filter((c) => /^DELETE .*\/channels\/s1$/.test(c))).toEqual(['DELETE /api/ws/abc123def0/channels/s1']);
    // The workspace now open is not read afresh for the other's change; its channel stands.
    expect(store.channel('s1')).toBeTruthy();
    expect(store.wsId).toBe(OTHER);
  });
});

describe('what the renderer makes of text that asks for markup', () => {
  // Every tag in the output is one the renderer writes; nothing the text asked for.
  const OURS = /^<\/?(strong|em|s|code|pre|blockquote|br|a|span|mark)(\s|>|$)/;
  const tags = (html) => html.match(/<[^>]*>/g) || [];
  const onlyOurs = (html) => tags(html).every((t) => OURS.test(t));
  const payload = '<img src=x onerror=alert(1)>';
  const members = { alice: { uuid: 'u1"><i>', name: '<b>Alice</b>' } };

  it('escapes text, code spans, fenced blocks (with a language hint) and mention names, and keeps an entity typed as text literal', () => {
    for (const text of [payload, `x \`${payload}\` y`, `\`\`\`js\n${payload}\n\`\`\``, `\`\`\`html\n${payload}\n\`\`\``, `> ${payload}`, `**${payload}**`]) {
      const html = formatMessage(text, { members, me: 'u1' });
      expect(tags(html).some((t) => /img|onerror/i.test(t))).toBe(false);
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
      expect(onlyOurs(html)).toBe(true);
    }
    const chip = formatMessage('hi @alice', { members, me: 'u1"><i>' });
    expect(chip).toContain('@&lt;b&gt;Alice&lt;/b&gt;');
    expect(chip).toContain('data-uuid="u1&quot;&gt;&lt;i&gt;"');
    expect(onlyOurs(chip)).toBe(true);
    expect(formatMessage('a &lt; b &amp; c')).toBe('a &amp;lt; b &amp;amp; c');
    expect(formatMessage(':<img>: and :+1"onerror=x:')).toBe(':&lt;img&gt;: and :+1&quot;onerror=x:');
  });

  it('links only http(s) addresses, never javascript: or data:, and keeps quotes out of the href', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '[x](javascript:alert(1))', 'vbscript:x and file:///etc/passwd']) {
      const html = formatMessage(text);
      expect(html).not.toMatch(/<a\s/);
      expect(html).not.toMatch(/href/);
      expect(onlyOurs(html)).toBe(true);
    }
    // Only the http(s) part of a mixed line is an address, and every href the renderer writes begins with it.
    const mixed = formatMessage('JAVASCRIPT:alert(1)//http://x.io and javascript:alert(2)');
    expect(tags(mixed).filter((t) => /href=/.test(t))).toEqual(['<a href="http://x.io" target="_blank" rel="noopener noreferrer nofollow">']);
    const quoted = formatMessage('see https://x.io/a"onmouseover="alert(1) and https://x.io/b\'x');
    const A_TAG = (href) => `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">`;
    expect(tags(quoted).filter((t) => /^<a\s/.test(t))).toEqual([A_TAG('https://x.io/a'), A_TAG('https://x.io/b')]);
    expect(quoted).toContain('&quot;onmouseover=&quot;alert(1)');
    expect(onlyOurs(quoted)).toBe(true);
    // A bracket pair in the address stays; a tag written after it is text.
    const paren = formatMessage('https://x.io/a_(b)<script>x</script>');
    expect(paren).toContain('href="https://x.io/a_(b)"');
    expect(paren).toContain('&lt;script&gt;');
  });

  it('highlights code and search hits as escaped text only, a mark never splitting an entity', () => {
    for (const lang of ['html', 'js', 'css', 'md', 'sh', 'sql', 'yaml', 'json', 'py', 'diff', 'nope']) {
      const html = highlight(`${payload} <script>alert("x")</script> 'q' "d" & <!-- c -->`, lang);
      expect(tags(html).every((t) => /^<\/?span(\s+class="tok-[a-z]+")?>$/.test(t))).toBe(true);
      expect(html.replace(/<[^>]*>/g, '')).toBe('&lt;img src=x onerror=alert(1)&gt; &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &#39;q&#39; &quot;d&quot; &amp; &lt;!-- c --&gt;');
    }
    const snippet = highlightSnippet(`${payload} &amp; tom&jerry`, ['img', 'amp', 'jerry']);
    expect(tags(snippet).some((t) => /img|onerror/i.test(t))).toBe(false);
    expect(snippet).toContain('&lt;<mark>img</mark> src=x onerror=alert(1)&gt;');
    expect(snippet).toContain('&amp;<mark>amp</mark>; tom&amp;<mark>jerry</mark>');
    expect(tags(snippet).every((t) => /^<\/?mark>$/.test(t))).toBe(true);
    expect(previewText(`${payload} **b** _i_`)).toBe('<img src=x onerror=alert(1)> b i');
  });
});

describe('opening workspaces faster than their bootstraps land', () => {
  const A = 'aaaa000001@teamchat-test';
  const B = 'bbbb000002@teamchat-test';
  afterEach(resetStore);

  function held() {
    const holds = { A: [], B: [] };
    worker({
      '/api/ws/aaaa000001': () => new Promise((r) => holds.A.push(() => r(json(boot('aaaa000001', 'A', { ca: { id: 'ca', name: 'a-general' } }))))),
      '/api/ws/bbbb000002': () => new Promise((r) => holds.B.push(() => r(json(boot('bbbb000002', 'B', { cb: { id: 'cb', name: 'b-general' } }))))),
    });
    return holds;
  }

  for (const order of [['B', 'A0', 'A1'], ['A0', 'A1', 'B'], ['A1', 'B', 'A0']]) {
    it(`A, then B, then A again with all three in flight, answered ${order.join(', ')}: A's document stands and B's never shows`, async () => {
      const holds = held();
      store.user = null;
      const seen = [];
      const off = store.on('workspace', () => seen.push(store.ws?.name || null));
      const pA0 = store.openWorkspace(A);
      const pB = store.openWorkspace(B);
      const pA1 = store.openWorkspace(A);
      await until(() => holds.A.length === 2 && holds.B.length === 1);
      const release = { B: holds.B[0], A0: holds.A[0], A1: holds.A[1] };
      const results = {};
      for (const k of order) {
        release[k]();
        results[k] = await { B: pB, A0: pA0, A1: pA1 }[k];
        expect(store.wsId).toBe(A);
        expect(store.ws?.name ?? 'A').toBe('A');
      }
      off();
      expect(results.B).toBeNull();
      expect(store.ws.id).toBe('aaaa000001');
      expect(store.me.channels).toEqual(['ca']);
      expect(store.channel('cb')).toBeFalsy();
      expect(store.convs.size).toBe(0);
      expect(store.links.size).toBe(0);
      expect(store.huddles).toEqual({});
      expect(seen.filter((n) => n === 'B')).toEqual([]);
      expect(seen).toContain('A');
    });
  }

  it('a refresh answered before the bootstrap it overlaps neither applies nor makes the bootstrap stale', async () => {
    const holds = held();
    store.user = null;
    const p = store.openWorkspace(A);
    await until(() => holds.A.length === 1);
    const r = store.refreshWorkspace();
    await until(() => holds.A.length === 2);
    holds.A[1]();
    await r;
    expect(store.ws).toBeNull();
    holds.A[0]();
    expect(await p).not.toBeNull();
    expect(store.ws.name).toBe('A');
    expect(store._timer).not.toBeNull();
  });
});

describe('a photo or a file the worker will not hand over', () => {
  afterEach(() => {
    vi.useRealTimers();
    clearAvatarCache();
    clearAttachmentCache();
    resetStore();
  });

  it('is not asked for again on every redraw: the refusal is remembered for a while, a new version is asked for at once, and the old one again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const calls = worker({}); // every address answers 404
    const asked = (what) => calls.filter((c) => c.includes(what)).length;
    for (let i = 0; i < 3; i++) await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    expect(asked('u-ann')).toBe(1);
    await expect(avatarUrl(REF, 'u-ann', 4)).rejects.toBeTruthy();
    expect(asked('u-ann')).toBe(2);
    vi.advanceTimersByTime(6 * 60_000);
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    expect(asked('u-ann')).toBe(3);
    for (let i = 0; i < 3; i++) await expect(attachmentUrl(REF, 'f1')).rejects.toBeTruthy();
    expect(asked('/files/f1')).toBe(1);
  });

  it('is asked for again soon when nobody answered at all (the network, not a refusal)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let n = 0;
    globalThis.puter = { workers: { exec: async () => { n++; throw new TypeError('Failed to fetch'); } } };
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    expect(n).toBe(1);
    vi.advanceTimersByTime(20_000);
    await expect(avatarUrl(REF, 'u-ann', 3)).rejects.toBeTruthy();
    expect(n).toBe(2);
  });
});


describe('what the device keeps for a workspace the account has left', () => {
  const OTHER = 'zzz999yyy8@teamchat-test';
  const hadWindow = typeof globalThis.window !== 'undefined';
  // Node's own localStorage (present, but keeping nothing without a file to
  // keep it in) is replaced by one that keeps what it is given, and put back.
  const storageBefore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  beforeAll(() => {
    const map = new Map();
    const fake = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true });
    if (!hadWindow) globalThis.window = { dispatchEvent() {}, addEventListener() {} };
  });
  afterAll(() => {
    if (storageBefore) Object.defineProperty(globalThis, 'localStorage', storageBefore);
    else delete globalThis.localStorage;
    if (!hadWindow) delete globalThis.window;
  });
  afterEach(() => {
    store.user = null;
    store.identity = null;
    _resetDraftCache();
    resetStore();
  });

  it('drops its drafts and its recent conversations and searches when the workspace is forgotten, and leaves other workspaces\' alone', async () => {
    setDraft(draftKey(REF, 'c1'), { text: 'half a thought' });
    setDraft(draftKey(REF, 'c1_t4'), { text: 'a reply' });
    setDraft(draftKey(OTHER, 'c1'), { text: 'keep me' });
    noteRecent(REF, 'c1');
    noteRecent(OTHER, 'c1');
    noteSearch(REF, 'find me');
    noteSearch(OTHER, 'keep me');
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = { v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'Acme' }, { ref: OTHER, name: 'Other' }], worker: null };
    globalThis.puter = { kv: { get: async () => structuredClone(store.user), set: async () => {} }, workers: { exec: async () => json({}) } };
    await store.forgetWorkspace(REF);
    expect(listDrafts(REF)).toEqual([]);
    expect(getDraft(draftKey(REF, 'c1'))).toBeNull();
    expect(getDraft(draftKey(OTHER, 'c1'))?.text).toBe('keep me');
    expect(recentConvs(REF)).toEqual([]);
    expect(recentConvs(OTHER)).toEqual(['c1']);
    expect(recentSearches(REF)).toEqual([]);
    expect(recentSearches(OTHER)).toEqual(['keep me']);
    expect(store.user.workspaces.map((w) => w.ref)).toEqual([OTHER]);
  });
});


describe('a message queued with files still on the device', () => {
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  it('shows the files as waiting to upload on its placeholder (after a reload too), then as attachments as each goes up, then the message itself', async () => {
    let releaseUpload;
    let releaseSend;
    const record = { id: 'f1', name: 'pic.png', size: 5, type: 'image/png' };
    worker({
      '/files': () => new Promise((r) => { releaseUpload = () => r(json(record)); }),
      '/conv/c1/messages': (_, init) => new Promise((r) => { releaseSend = () => r(json({ message: msg(2, 'with file', { attachments: [record], cid: JSON.parse(init.body).cid }) })); }),
    });
    openChannel([msg(1, 'a')]);
    const temp = await store.send('c1', { text: 'with file', files: [{ name: 'pic.png', type: 'image/png', blob: new Blob(['12345'], { type: 'image/png' }) }] });
    expect(temp.queued).toBe(true);
    const waiting = [{ name: 'pic.png', size: 5, type: 'image/png', uploading: true }];
    expect(temp.attachments).toEqual(waiting);
    // A reload: the placeholder comes back from the outbox entry, the file still waiting.
    store.convs.clear();
    openChannel([msg(1, 'a')]);
    await store._restoreQueued();
    const placeholder = () => store.conv('c1').messages.find((m) => m.tempId === temp.tempId);
    expect(placeholder().attachments).toEqual(waiting);
    await until(() => !!releaseUpload, 1000);
    releaseUpload();
    // Uploaded: the placeholder shows the file as an attachment while the message itself is on its way.
    await until(() => placeholder()?.attachments?.[0]?.id === 'f1', 1000);
    expect(placeholder().attachments).toEqual([record]);
    await until(() => !!releaseSend, 1000);
    releaseSend();
    await until(() => store.conv('c1').messages.some((m) => m.seq === 2), 1000);
    expect(placeholder()).toBeUndefined();
    expect(store.conv('c1').messages.find((m) => m.seq === 2).attachments).toEqual([record]);
  });
});
