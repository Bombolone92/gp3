/**
 * Sixteenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass15.test.js.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';

const REF = 'abc123def0@teamchat-test';
const OTHER = 'bbbbbb0000@teamchat-test';
const HOST = 'cccccc0000@teamchat-test';
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

/** This workspace with the entry s1 for the host's channel hc and a loaded link to the host, which carries a direct message and a huddle too. */
function armShared() {
  const channels = { c1: { id: 'c1', name: 'general' }, s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
  const a = boot('abc123def0', 'Acme', channels);
  store.wsId = REF;
  store.ws = a.workspace;
  store.me = { ...a.me, reads: { s1: 5, c1: 2 }, mentions: {}, dms: { h_dmz: { members: ['u-me', 'u-h'], host: HOST } } };
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.act = { c: { c1: { s: 3, t: 3000 }, s1: { s: 9, t: 9000, u: 'u-h', x: 4 }, h_dmz: { s: 2, t: 2000, u: 'u-h' } }, p: { 'u-h': Date.now() }, ps: {}, w: 1, u: 0 };
  store.huddles = { s1: { by: 'u-h', at: Date.now(), m: { 'u-h': { j: 1 } } } };
  const link = {
    ref: HOST,
    ws: { id: 'cccccc0000', name: 'Host', channels: { hc: { id: 'hc', name: 'hc' } }, members: { 'u-h': { role: 'member', name: 'H', username: 'h' } } },
    me: { role: 'external', channels: ['hc'], dms: { dmz: { members: ['u-me', 'u-h'] } }, reads: { hc: 5 }, mentions: {}, notify: {}, threads: {} },
    act: null, since: 1, w: 1, u: 0, convs: new Map([['hc', 's1']]), loaded: true, loading: null, syncing: null,
    error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {},
  };
  store.links = new Map([[HOST, link]]);
  return { link, channels };
}

describe('the workspace read afresh while a shared channel\'s host is already loaded', () => {
  afterEach(resetStore);

  it('keeps what the host said of its conversations: their counters, the direct message\'s, its huddle, its people\'s presence', () => {
    const { channels } = armShared();
    // The workspace's own document, as the connection returns (see refreshStale): it knows nothing of the host's conversations.
    const d = boot('abc123def0', 'Acme', channels);
    d.me.reads = { s1: 5, c1: 3 };
    d.activity.c = { c1: { s: 4, t: 4000, u: 'u-ann' } };
    d.activity.p = { 'u-ann': Date.now() };
    store._applyBootstrap(d);
    // This workspace's own entries are the document's.
    expect(store.latestSeq('c1')).toBe(4);
    expect(store.me.reads.c1).toBe(3);
    // The shared channel is still unread past 5, and its direct message is still known and dated.
    expect(store.latestSeq('s1')).toBe(9);
    expect(store.unreadCount('s1')).toBe(4);
    expect(store.act.c.s1).toMatchObject({ s: 9, t: 9000, x: 4 });
    expect(store.me.dms.h_dmz).toBeTruthy();
    expect(store.dms().find((dm) => dm.id === 'h_dmz')?.lastTs).toBe(2000);
    // The huddle in progress on the host still shows, and its people are still here.
    expect(store.huddleIn('s1')).toBeTruthy();
    expect(store.huddleMembers('s1')).toEqual(['u-h']);
    expect(store.presenceOf('u-h')).toBe('active');
    expect(store.presenceOf('u-ann')).toBe('active');
  });
});

describe('a save, a removal from Later or a done mark answered after a switch to another workspace', () => {
  afterEach(() => { resetStore(); store._saved = null; store._savedDone = new Set(); store._savedCount = 0; });
  // The same two people share one direct message id across workspaces (see dmConvId): the message 7 of it is saved in both.
  const dms = { dm_x: { members: ['u-me', 'u-ann'], createdAt: 1 } };
  const open = (ref, id, name, { saved, done, count }) => {
    store.wsId = ref;
    store.ws = boot(id, name, {}).workspace;
    store.me = { role: 'member', channels: [], dms, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store._saved = new Set(saved);
    store._savedDone = new Set(done);
    store._savedCount = count;
  };

  it('moves nothing of the workspace now open: its list, its done marks and its Later count stand', async () => {
    const held = [];
    worker({ '/saved': () => new Promise((r) => held.push(r)) });
    open(REF, 'abc123def0', 'A', { saved: ['dm_x:7', 'dm_x:9'], done: [], count: 2 });
    const removal = store.unsave('dm_x', 7);
    const marked = store.saveDone({ c: 'dm_x', s: 9 }, true);
    const saved = store.save('dm_x', 11);
    await until(() => held.length === 3);
    // The switch to B, where the direct message's message 7 is saved too, and 9 is not.
    open(OTHER, 'bbbbbb0000', 'B', { saved: ['dm_x:7'], done: [], count: 1 });
    for (const r of held) r(json({ ok: true }));
    await Promise.all([removal, marked, saved]);
    expect([...store._saved].sort()).toEqual(['dm_x:7']);
    expect(store._savedDone.size).toBe(0);
    expect(store.savedCount()).toBe(1);
  });
});

describe('a pin or an unpin answered after a switch to another workspace', () => {
  afterEach(() => { resetStore(); store._pins = new Map(); });
  const dms = { dm_x: { members: ['u-me', 'u-ann'], createdAt: 1 } };
  const msg = (seq, extra = {}) => ({ seq, user: 'u2', text: `m${seq}`, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });
  const open = (ref, id, name, pc) => {
    store.wsId = ref;
    store.ws = boot(id, name, {}).workspace;
    store.me = { role: 'member', channels: [], dms, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { dm_x: { s: 9, pc } }, p: {}, ps: {}, w: 1, u: 0 };
    store.convs.clear();
    Object.assign(store.conv('dm_x'), { loaded: true, seq: 9, messages: [msg(7, { pinned: ref === REF }), msg(9)] });
    store._pins = new Map([['dm_x', { stamp: `${pc}:0`, items: [] }]]);
  };

  it('moves nothing of the workspace now open: its pinned count, its pin list and the pin marks on its messages stand', async () => {
    const held = [];
    worker({ '/pins': () => new Promise((r) => held.push(r)), '/pins/7': () => new Promise((r) => held.push(r)) });
    open(REF, 'abc123def0', 'A', 1);
    const unpinned = store.unpin('dm_x', 7);
    const pinned = store.pin('dm_x', 9);
    await until(() => held.length === 2);
    // The switch to B, where the same two people's direct message has two pins, 7 not among them.
    open(OTHER, 'bbbbbb0000', 'B', 2);
    for (const r of held) r(json({ ok: true, already: true })); // (the pin was there already: it counts nothing new)
    await Promise.all([unpinned, pinned]);
    expect(store.pinCount('dm_x')).toBe(2);
    expect(store._pins.get('dm_x')?.items).toEqual([]);
    expect(store.conv('dm_x').messages.map((m) => !!m.pinned)).toEqual([false, false]);
  });
});

describe('a message set to send later, or a reminder, answered after a switch to another workspace', () => {
  afterEach(() => { resetStore(); store._scheduledCount = 0; store._reminderCount = 0; });
  const channels = { c1: { id: 'c1', name: 'general' } };
  const open = (ref, id, name, scheduled, reminders) => {
    store.wsId = ref;
    store.ws = boot(id, name, channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store._scheduledCount = scheduled;
    store._reminderCount = reminders;
  };

  it('does not count towards the Later badge of the workspace now open', async () => {
    const held = [];
    worker({
      '/scheduled': (_, init) => new Promise((r) => held.push(() => r(json({ scheduled: { id: 's1', kind: 'message', conv: 'c1', text: 'later', dueAt: JSON.parse(init.body).dueAt, createdAt: 1 } })))),
      '/reminders': (_, init) => new Promise((r) => held.push(() => r(json({ reminder: { id: 'r1', kind: 'reminder', conv: 'c1', seq: 3, dueAt: JSON.parse(init.body).dueAt, createdAt: 1 } })))),
    });
    open(REF, 'abc123def0', 'A', 2, 1);
    const soon = Math.floor(Date.now() / 60_000) * 60_000 + 60_000 + 22_000;
    const scheduled = store.schedule('c1', { text: 'later', dueAt: soon });
    const reminded = store.remind('c1', 3, soon, 'note');
    await until(() => held.length === 2);
    // The switch to B, which has nothing waiting in Later.
    open(OTHER, 'bbbbbb0000', 'B', 0, 0);
    for (const release of held) release();
    const [s, r] = await Promise.all([scheduled, reminded]);
    expect(s.dueAt).toBe(soon);
    expect(r.dueAt).toBe(soon);
    expect(store.scheduledCount()).toBe(0);
    expect(store.reminderCount()).toBe(0);
  });
});

describe('a page read while a message is being written (its number taken, its text not yet in its block)', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const msg = (seq) => ({ seq, user: 'u2', text: `m${seq}`, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0 });
  const seqs = () => store.conv('c1').messages.map((m) => m.seq);
  const sync = (s) => ({ now: Date.now(), ts: Date.now(), c: { c1: { s, t: s * 1000, u: 'u2' } }, p: {}, w: 1, u: 0 });
  /** A worker whose counter stands at 12 while message 12 is in its block only once `state.appended`. */
  function arm(state) {
    return worker({
      '/conv/c1/messages': (q) => {
        const upto = state.appended ? 12 : 11;
        const after = q.has('after') ? Number(q.get('after')) : Math.max(0, upto - 100);
        const messages = [];
        for (let s = after + 1; s <= upto; s++) messages.push(msg(s));
        return json({ messages, seq: 12, hasMore: false });
      },
    });
  }
  function open() {
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: { c1: 10 }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 10, t: 10_000, u: 'u2' } }, p: {}, ps: {}, w: 1, u: 0 };
  }

  it('does not count the message as reached by a page fetched for an earlier one: it is fetched, and announced, when the poll says it is in', async () => {
    const state = { appended: false };
    const calls = arm(state);
    open();
    Object.assign(store.conv('c1'), { loaded: true, seq: 10, messages: Array.from({ length: 10 }, (_, i) => msg(i + 1)) });
    const incoming = [];
    const off = store.on('incoming', (l) => incoming.push(...l));
    // The poll announces message 11; its page comes back while 12 has its number and no text yet.
    await store._applySync(sync(11));
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(store.conv('c1').seq).toBe(11);
    expect(store.latestSeq('c1')).toBe(11);
    expect(store.unreadCount('c1')).toBe(1);
    expect(incoming).toEqual([{ conv: 'c1', from: 'u2', seq: 11 }]);
    // Message 12 is in, and announced: it is news, and it is fetched.
    state.appended = true;
    await store._applySync(sync(12));
    expect(incoming).toEqual([{ conv: 'c1', from: 'u2', seq: 11 }, { conv: 'c1', from: 'u2', seq: 12 }]);
    expect(seqs()).toContain(12);
    expect(store.conv('c1').seq).toBe(12);
    expect(store.unreadCount('c1')).toBe(2);
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(2);
    off();
  });

  it('nor by the newest page a conversation opens with', async () => {
    const state = { appended: false };
    arm(state);
    open();
    store.act.c.c1 = { s: 11, t: 11_000, u: 'u2' };
    await store.loadConversation('c1');
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(store.conv('c1').seq).toBe(11);
    expect(store.latestSeq('c1')).toBe(11);
    state.appended = true;
    await store._applySync(sync(12));
    expect(seqs()).toContain(12);
    expect(store.conv('c1').seq).toBe(12);
  });

  it('fetches a message announced after a later-numbered one the window already holds (two people posting in the same moment)', async () => {
    // Two posts at once: 13 is appended and announced first; 12 has its number, and is appended and announced a moment later.
    const state = { twelveIn: false };
    const calls = worker({
      '/conv/c1/messages': (q) => {
        if (q.has('from')) {
          const from = Number(q.get('from'));
          const to = Number(q.get('to'));
          const messages = [];
          for (let s = from; s <= to; s++) if (s === 13 || (s === 12 && state.twelveIn) || s < 12) messages.push(msg(s));
          return json({ messages, seq: 13, hasMore: false });
        }
        const after = Number(q.get('after'));
        const messages = [];
        for (let s = after + 1; s <= 13; s++) if (s !== 12 || state.twelveIn) messages.push(msg(s));
        return json({ messages, seq: 13, hasMore: false });
      },
    });
    open();
    store.act.c.c1 = { s: 11, t: 11_000, u: 'u2' };
    Object.assign(store.conv('c1'), { loaded: true, seq: 11, messages: Array.from({ length: 11 }, (_, i) => msg(i + 1)) });
    const incoming = [];
    const off = store.on('incoming', (l) => incoming.push(...l));
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 13, t: 13_000, u: 'u3' } }, p: {}, w: 1, u: 0 });
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
    expect(store.conv('c1').seq).toBe(13);
    // Now 12 is in, and the worker's entry for the conversation says so, under the number below the one that stands.
    state.twelveIn = true;
    await store._applySync(sync(12));
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(store.latestSeq('c1')).toBe(13);
    expect(incoming.map((i) => i.seq)).toEqual([13, 12]);
    // Said once: the same word again reads nothing more.
    await store._applySync(sync(12));
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(2);
    // The worker's entry keeps the lower number from here (it wrote 12 last): a reaction after that comes
    // with it, and is still taken as the change it is, the count standing where it stood.
    store.conv('c1').xSeen = 0;
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 12, t: 12_000, u: 'u2', x: 9 } }, p: {}, w: 1, u: 0 });
    expect(store.act.c.c1).toMatchObject({ s: 13, x: 9 });
    expect(calls.filter((c) => c.includes('/conv/c1/messages') && c.includes('from='))).toHaveLength(2);
    off();
  });

  it('looks for a message announced late once, not with every change in the conversation after it (it was deleted before any page held it)', async () => {
    const calls = worker({ '/conv/c1/messages': () => json({ messages: [], seq: 13, hasMore: false }) });
    open();
    store.act.c.c1 = { s: 13, t: 13_000, u: 'u3', x: 5 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 13, xSeen: 5, messages: [...Array.from({ length: 11 }, (_, i) => msg(i + 1)), msg(13)] });
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 12, t: 12_000, u: 'u2', x: 5 } }, p: {}, w: 1, u: 0 });
    const reads = () => calls.filter((c) => c.includes('from=12') && c.includes('to=12')).length;
    expect(reads()).toBe(1);
    // Reactions after that come with the same lower number: nothing to look for again.
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 12, t: 12_000, u: 'u2', x: 6 } }, p: {}, w: 1, u: 0 });
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 12, t: 12_000, u: 'u2', x: 7 } }, p: {}, w: 1, u: 0 });
    expect(reads()).toBe(1);
    expect(store.act.c.c1).toMatchObject({ s: 13, x: 7 });
  });

  it('is not taken out again by a re-read of the overlays asked for before it was in and answered after', async () => {
    const held = [];
    worker({
      '/conv/c1/messages': (q) => {
        if (q.get('from') === '12' && q.get('to') === '12') return json({ messages: [msg(12)], seq: 13, hasMore: false });
        // The range read for a reaction on 13: its blocks were read before 12 was in, and it answers late.
        const page = [...Array.from({ length: 11 }, (_, i) => msg(i + 1)), { ...msg(13), reactions: { tada: { u2: 1 } } }];
        return new Promise((r) => held.push(() => r(json({ messages: page, seq: 13, hasMore: false }))));
      },
    });
    open();
    store.act.c.c1 = { s: 13, t: 13_000, u: 'u3', x: 5 };
    Object.assign(store.conv('c1'), { loaded: true, seq: 13, xSeen: 5, messages: [...Array.from({ length: 11 }, (_, i) => msg(i + 1)), msg(13)] });
    const first = store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 13, t: 13_000, u: 'u3', x: 6 } }, p: {}, w: 1, u: 0 });
    await until(() => held.length === 1);
    // Meanwhile 12 is announced, late, and read on its own.
    const second = store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 12, t: 12_000, u: 'u2', x: 6 } }, p: {}, w: 1, u: 0 });
    await until(() => seqs().includes(12));
    // The second word's re-read shares the one still out (see refreshRange), rather than reading the same range again.
    expect(held).toHaveLength(1);
    for (const release of held) release();
    await Promise.all([first, second]);
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(store.conv('c1').messages.find((m) => m.seq === 13).reactions).toEqual({ tada: { u2: 1 } });
  });

  it('does not touch a detached window (opened around an older message) for a number past its newest, nor one before its oldest', async () => {
    const calls = worker({ '/conv/c1/messages': () => json({ messages: [], seq: 500, hasMore: false }) });
    open();
    store.act.c.c1 = { s: 500, t: 500_000, u: 'u2' };
    Object.assign(store.conv('c1'), { loaded: true, seq: 500, hasNewer: true, hasMore: true, messages: [100, 101, 102].map(msg) });
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 400, t: 400_000, u: 'u2' } }, p: {}, w: 1, u: 0 });
    await store._applySync({ now: Date.now(), ts: Date.now(), c: { c1: { s: 50, t: 50_000, u: 'u2' } }, p: {}, w: 1, u: 0 });
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(0);
    expect(store.latestSeq('c1')).toBe(500);
  });

  it('still takes the counter for a newest message that was deleted, which no page ever returns, so the window is not forever behind', async () => {
    const calls = arm({ appended: false }); // the counter says 12, and 12 was announced: its author deleted it since
    open();
    store.act.c.c1 = { s: 12, t: 12_000, u: 'u2' };
    await store.loadConversation('c1');
    expect(seqs()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(store.conv('c1').seq).toBe(12);
    const tasks = [];
    store._queueWindowUpdates(tasks);
    await Promise.all(tasks);
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(1);
  });
});
