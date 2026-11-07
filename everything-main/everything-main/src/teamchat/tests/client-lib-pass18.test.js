/**
 * Eighteenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass17.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

// Whether the device's UTC offset has moved since the workers were told it
// (see "the clocks change"): the real answer compares against what
// subscribePush last sent, which needs a browser; here it is set by hand.
const tz = vi.hoisted(() => ({ moved: false, real: null }));
vi.mock('../src/lib/pwa.js', async (importOriginal) => {
  const orig = await importOriginal();
  tz.real = orig.pushOffsetMoved;
  return { ...orig, pushOffsetMoved: () => tz.moved };
});

import { store } from '../src/lib/store.js';
import { idb } from '../src/lib/idb.js';
import { isContinuation } from '../src/lib/time.js';
import { highlightSnippet, previewText, formatMessage } from '../src/lib/format.js';
import { toggleWrap } from '../src/lib/formatting.js';
import { parseHash, buildHash, parseAppLink, navigate } from '../src/lib/router.js';
import { dayLabel, relativeLong, fullDateTime } from '../src/lib/time.js';
import * as drafts from '../src/lib/drafts.js';
import { ApiError } from '../src/lib/api.js';
import { pushPrefs, localTzOffset, _notePushOffset } from '../src/lib/pwa.js';
import { pushAllowed } from '../worker/push.js';

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
const channels = { c1: { id: 'c1', name: 'general' } };

/** A workspace open with channel c1's window loaded and holding `messages`. */
function openChannel(messages, extra = {}) {
  store.wsId = REF;
  store.ws = boot('abc123def0', 'Acme', channels).workspace;
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  const newest = messages.reduce((n, m) => Math.max(n, m.seq), 0);
  store.act = { c: { c1: { s: newest, t: newest * 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.convs.clear();
  Object.assign(store.conv('c1'), { loaded: true, seq: newest, hasMore: false, messages, ...extra });
  return store.conv('c1');
}

describe('an edit answered after a range refresh laid fresh copies of the window\'s messages in', () => {
  afterEach(resetStore);

  it('shows the edited text at once, on the copy the window holds now, rather than the text from before until the next poll', async () => {
    const held = [];
    worker({
      '/messages/7': (_, init) => new Promise((r) => held.push(() => r(json({ text: JSON.parse(init.body).text, editedAt: 7500 })))),
      // The range read, answered as the worker had the messages before the edit landed, with someone's reaction on 6.
      '/conv/c1/messages': () => json({ messages: [msg(6, 'six', { reactions: { '+1': { 'u-ann': 1 } } }), msg(7, 'seven')], seq: 7, hasMore: false }),
    });
    openChannel([msg(6, 'six'), msg(7, 'seven')]);
    const edited = store.edit('c1', 7, 'seven, edited');
    await until(() => held.length === 1);
    // A reaction landed meanwhile: the poll re-read the window's range and replaced its copies of 6 and 7.
    await store.refreshRange('c1');
    expect(store.conv('c1').messages.find((m) => m.seq === 6).reactions).toEqual({ '+1': { 'u-ann': 1 } });
    const events = [];
    const off = store.on('messages', (d) => events.push(d.reason));
    held[0]();
    await edited;
    off();
    const seven = store.conv('c1').messages.find((m) => m.seq === 7);
    expect(seven.text).toBe('seven, edited');
    expect(seven.editedAt).toBe(7500);
    expect(events).toContain('range');
  });
});

describe('a permalink opened while the conversation showed the page saved on the device', () => {
  afterEach(resetStore);

  it('is a fresh window once the worker has answered: not "offline, showing saved messages", and not read again as stale by the next poll', async () => {
    const calls = worker({
      '/conv/c1/messages': (q) => (q.get('from')
        ? json({ messages: [msg(4, 'd'), msg(5, 'e'), msg(6, 'f')], seq: 40, hasMore: true })
        : json({ messages: [msg(39, 'y'), msg(40, 'z')], seq: 40, hasMore: true })),
    });
    // The newest page as saved on the device, shown while the connection was away.
    openChannel([msg(1, 'a'), msg(2, 'b')], { stale: Date.now() - 60_000, seq: 2 });
    await store.loadAround('c1', 5);
    const c = store.conv('c1');
    expect(c.loaded).toBe(true);
    expect(c.messages.map((m) => m.seq)).toEqual([4, 5, 6]);
    expect(c.hasNewer).toBe(true);
    expect(c.stale).toBeFalsy();
    // The next poll, finding no stale window, leaves the permalink's window where it is.
    const reads = calls.length;
    await store.refreshStale();
    expect(calls.length).toBe(reads);
    expect(c.messages.map((m) => m.seq)).toEqual([4, 5, 6]);
  });
});

describe('a conversation shown from the page saved on the device whose fresh read fails for want of a connection', () => {
  const get = idb.get;
  afterEach(() => {
    idb.get = get;
    resetStore();
  });

  it('keeps the page where the reader has it, said as a re-read of what the window holds and not as a page landing anew, poll after poll', async () => {
    const savedAt = Date.now() - 60_000;
    const page = [msg(1, 'a'), msg(2, 'b')];
    idb.get = async (storeName, key) => (storeName === 'cache' && key === `conv:${REF}:c1` ? { key, messages: page.map((m) => ({ ...m })), seq: 2, ts: savedAt } : null);
    worker({
      // The workspace's own sync got through, but the messages cannot be read (a host out of reach, a flaky link).
      '/conv/c1/messages': () => { throw new Error('unreachable'); },
    });
    openChannel(page.map((m) => ({ ...m })), { stale: savedAt, seq: 2 });
    const events = [];
    const off = store.on('messages', (d) => { if (d.conv === 'c1') events.push(d.reason); });
    await store.refreshStale();
    await store.refreshStale();
    off();
    const c = store.conv('c1');
    expect(c.loaded).toBe(true);
    expect(c.stale).toBe(savedAt);
    expect(c.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(c.loading).toBe(false);
    // Each attempt is said (the list redraws), but never as a fresh page: that lands the reader at the end of it.
    expect(events.filter((r) => r === 'init')).toEqual([]);
    expect(events.filter((r) => r === 'range').length).toBe(2);
  });

  it('lays a page saved since (another tab read the conversation online) in, as a fresh page', async () => {
    const savedAt = Date.now() - 60_000;
    idb.get = async () => ({ key: `conv:${REF}:c1`, messages: [msg(1, 'a'), msg(2, 'b'), msg(3, 'c')], seq: 3, ts: savedAt + 30_000 });
    worker({ '/conv/c1/messages': () => { throw new Error('unreachable'); } });
    openChannel([msg(1, 'a'), msg(2, 'b')], { stale: savedAt, seq: 2 });
    const events = [];
    const off = store.on('messages', (d) => { if (d.conv === 'c1') events.push(d.reason); });
    await store.refreshStale();
    off();
    const c = store.conv('c1');
    expect(c.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(c.stale).toBe(savedAt + 30_000);
    expect(events).toContain('init');
  });
});

describe('a reminder that came due, beside the member\'s own notes in their self conversation', () => {
  const NOW = new Date(2026, 8, 7, 9, 0).getTime();
  const note = (ts, extra = {}) => ({ user: 'u', ts, kind: 'msg', ...extra });
  const reminder = (ts) => ({ user: 'u', ts, kind: 'rem' });

  it('is never drawn as a continuation of a note, nor a note as one of it, though both are filed under the member', () => {
    expect(isContinuation(reminder(NOW), note(NOW + 60_000))).toBe(false);
    expect(isContinuation(note(NOW), reminder(NOW + 60_000))).toBe(false);
    expect(isContinuation(reminder(NOW), reminder(NOW + 60_000))).toBe(false);
    // Notes among themselves group as before, and a system line still breaks a group.
    expect(isContinuation(note(NOW), note(NOW + 60_000))).toBe(true);
    expect(isContinuation(note(NOW), { user: 'u', ts: NOW + 1000, kind: 'sys' })).toBe(false);
  });
});

describe('a shared channel shown from the offline cache while its host cannot be reached', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(resetStore);

  function openShared() {
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'member', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    // What the cached bootstrap knew of the channel: two messages, an overlay stamp the window has not seen.
    store.act = { c: { s1: { s: 2, t: 2000, x: 5 } }, p: {}, ps: {}, w: 1, u: 0 };
    const link = { ref: HOST, ws: null, me: null, act: null, since: 0, w: 0, u: 0, convs: new Map([['hc', 's1']]), loaded: false, loading: null, syncing: null, error: null, lost: false, failures: 1, retryAt: Date.now() + 60_000, lostConvs: new Map(), rejoinAt: {} };
    store.links = new Map([[HOST, link]]);
    store.convs.clear();
    Object.assign(store.conv('s1'), { loaded: true, stale: Date.now() - 60_000, seq: 2, hasMore: false, messages: [msg(1, 'a'), msg(2, 'b')] });
    return link;
  }

  it('is not read from the host on every poll (each read waited out the whole timeout, holding this workspace\'s own sync back), until the link to the host stands again', async () => {
    const calls = worker({ '/conv/hc/messages': () => json({ messages: [msg(1, 'a'), msg(2, 'b'), msg(3, 'c')], seq: 3, hasMore: false }) });
    const link = openShared();
    await store.refreshStale();
    const tasks = [];
    store._queueWindowUpdates(tasks);
    await Promise.all(tasks);
    expect(calls.filter((c) => c.includes('/conv/hc/messages'))).toEqual([]);
    expect(store.conv('s1').stale).toBeTruthy();
    // The host answers its bootstrap again: the window is read afresh, and its range as usual.
    link.loaded = true;
    await store.refreshStale();
    expect(calls.filter((c) => c.includes('/conv/hc/messages')).length).toBe(1);
    expect(store.conv('s1').stale).toBe(false);
    expect(store.conv('s1').messages.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('leaves this workspace\'s own windows to be read as before', async () => {
    const calls = worker({
      '/conv/hc/messages': () => json({ messages: [], seq: 2, hasMore: false }),
      '/conv/c1/messages': () => json({ messages: [msg(1, 'a'), msg(2, 'b')], seq: 2, hasMore: false }),
    });
    openShared();
    store.ws.channels.c1 = { id: 'c1', name: 'general' };
    store.me.channels.push('c1');
    store.act.c.c1 = { s: 2, t: 2000, x: 1 };
    Object.assign(store.conv('c1'), { loaded: true, stale: Date.now() - 60_000, seq: 2, hasMore: false, messages: [msg(1, 'a')] });
    await store.refreshStale();
    expect(calls.filter((c) => c.includes('/conv/c1/messages')).length).toBe(1);
    expect(calls.filter((c) => c.includes('/conv/hc/messages'))).toEqual([]);
    expect(store.conv('c1').stale).toBe(false);
  });
});

describe('leaving a shared channel whose host does not answer', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(() => {
    vi.useRealTimers();
    resetStore();
  });

  it('leaves it here within a few seconds rather than after the request\'s whole timeout, the word to the host going on in the background', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hostAsked = 0;
    worker({
      '/channels/hc/leave': () => { hostAsked++; return new Promise(() => {}); }, // the host hangs
      '/channels/s1/leave': () => json({ ok: true }),
      abc123def0: () => json(boot('abc123def0', 'Acme', {})), // the document after the leave: no channels
    });
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'member', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.links = new Map([[HOST, { ref: HOST, ws: { channels: {}, members: {} }, me: { channels: ['hc'] }, convs: new Map([['hc', 's1']]), loaded: true, loading: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {} }]]);
    let done = false;
    const left = store.leaveChannel('s1').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(4500);
    expect(done).toBe(true);
    await left;
    expect(hostAsked).toBe(1);
    expect(store.me.channels).not.toContain('s1');
  });
});

describe('an admin removing a shared channel whose host does not answer', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(() => {
    vi.useRealTimers();
    resetStore();
  });

  it('has the entry removed here within a few seconds, the word that ends the connection going on to the host in the background', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hostTold = 0;
    const calls = worker({
      '/channels/s1/attest': () => json({ ref: HOST, conn: 'k1', token: 't0k' }),
      '/connect/disconnect': () => { hostTold++; return new Promise(() => {}); }, // the host hangs
      '/channels/s1': () => json({ ok: true }),
      abc123def0: () => json(boot('abc123def0', 'Acme', {})),
    });
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'admin', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    let done = false;
    const removed = store.disconnectShared('s1').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(4500);
    expect(done).toBe(true);
    await removed;
    expect(hostTold).toBe(1);
    expect(calls.some((c) => c.startsWith('DELETE ') && c.endsWith('/channels/s1'))).toBe(true);
    expect(store.ws.channels.s1).toBeUndefined();
  });
});

describe('leaving a workspace with a shared channel whose host does not answer', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(() => {
    vi.useRealTimers();
    resetStore();
  });

  it('is through with the hosts within a few seconds, the word to the one that hangs going on in the background', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hostAsked = 0;
    worker({ '/channels/hc/leave': () => { hostAsked++; return new Promise(() => {}); } });
    const chans = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', chans).workspace;
    store.me = { role: 'member', channels: ['s1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.links = new Map([[HOST, { ref: HOST, ws: { channels: {}, members: {} }, me: { role: 'external', channels: ['hc'] }, convs: new Map([['hc', 's1']]), loaded: true, loading: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {} }]]);
    let done = false;
    const left = store.leaveHosts().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(4500);
    expect(done).toBe(true);
    await left;
    expect(hostAsked).toBe(1);
  });
});

describe('saving the profile card, or a status, while one workspace\'s server does not answer', () => {
  const TWO = 'bbbbbb0000@teamchat-two';
  afterEach(() => {
    vi.useRealTimers();
    store.user = null;
    store.identity = null;
    store.workspaces = [];
    resetStore();
  });

  /** Two workspaces on two servers; the second server hangs on every PUT of the card. */
  function twoServers() {
    const told = [];
    const doc = () => ({ v: 1, profile: { name: 'Me' }, prefs: {}, workspaces: [{ ref: REF, name: 'A' }, { ref: TWO, name: 'B' }], worker: null });
    globalThis.puter = {
      kv: { get: async () => doc(), set: async () => true },
      workers: {
        exec: async (url, init = {}) => {
          const u = new URL(url);
          if (u.pathname === '/api/me' && init.method === 'PUT') {
            told.push(u.hostname);
            if (u.hostname === 'teamchat-two.puter.work') return new Promise(() => {});
            return json({ ok: true });
          }
          return json({ code: 'not_found', message: 'nope' }, 404);
        },
      },
    };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = doc();
    store._composeProfile();
    store._composeWorkspaces();
    return told;
  }

  it('is done within a few seconds, the card kept in the account and the copies sent to every server, the one that hangs included', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const told = twoServers();
    let done = false;
    const saved = store.updateProfile({ name: 'New name' }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(4500);
    expect(done).toBe(true);
    await saved;
    expect(store.profile.name).toBe('New name');
    expect(told.sort()).toEqual(['teamchat-test.puter.work', 'teamchat-two.puter.work']);
  });

  it('the same for a status', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const told = twoServers();
    let done = false;
    const set = store.updateStatus({ emoji: '', text: 'Out for lunch' }).then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(4500);
    expect(done).toBe(true);
    await set;
    expect(store.profile.status?.text).toBe('Out for lunch');
    expect(told.length).toBe(2);
  });
});

describe('the clocks change (daylight saving) while a device is subscribed to pushes', () => {
  afterEach(() => {
    tz.moved = false;
    _notePushOffset(null);
    resetStore();
  });

  it('is what the workers keep quiet hours by: the offset they were told, which the client tells them once as a workspace opens or a setting changes', () => {
    // Quiet hours 22:00-08:00 as the client sends them, judged by the worker at 22:30 local by the offset it was told.
    const sent = pushPrefs({ dnd: { enabled: true, from: '22:00', to: '08:00' } });
    expect(sent.tzOffset).toBe(localTzOffset());
    const utc2230 = Date.UTC(2026, 2, 29, 22, 30) - sent.tzOffset * 60_000; // 22:30 by this device's clock
    expect(pushAllowed(sent, utc2230)).toBe(false);
    // The same moment, judged by an offset an hour off (the clocks moved since): a different hour, so a different verdict at the window's edge.
    const stale = { ...sent, tzOffset: sent.tzOffset - 60 };
    expect(pushAllowed(stale, Date.UTC(2026, 2, 29, 21, 30) - sent.tzOffset * 60_000)).toBe(true); // 21:30 here, read as 20:30 there: not quiet yet either way
    expect(pushAllowed(stale, Date.UTC(2026, 2, 29, 22, 30) - sent.tzOffset * 60_000)).toBe(true); // 22:30 here, read as 21:30 there: rings inside the quiet hour
    // Nothing has moved while nothing was told; moved once the device's offset differs from the one told.
    expect(tz.real()).toBe(false);
    _notePushOffset(localTzOffset() + 60);
    expect(tz.real()).toBe(true);
    _notePushOffset(localTzOffset());
    expect(tz.real()).toBe(false);
  });

  it('is told to the workers again by the next poll, once, rather than at the next opening of the app', async () => {
    worker({ '/sync': () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {} }) });
    openChannel([msg(1, 'a')]);
    const resent = vi.spyOn(store, 'syncPushPrefs').mockResolvedValue(undefined);
    store._timer = setTimeout(() => {}, 0); // polling is "on" for the poll's own rescheduling
    await store.poll();
    expect(resent).not.toHaveBeenCalled();
    tz.moved = true;
    await store.poll();
    expect(resent).toHaveBeenCalledTimes(1);
    // A poll while the last telling is still on its way does not tell again.
    let release;
    resent.mockImplementation(() => new Promise((r) => { release = r; }));
    await store.poll();
    await store.poll();
    expect(resent).toHaveBeenCalledTimes(2);
    release();
    await tick(5);
    tz.moved = false;
    await store.poll();
    expect(resent).toHaveBeenCalledTimes(2);
    store.stopPolling();
    resent.mockRestore();
  });
});

describe('bold, italics, strikethrough or code applied to a selection over several lines', () => {
  it('marks each line, since no mark is drawn across a line break, and takes the marks off each line when applied again', () => {
    const once = toggleWrap({ value: 'one\ntwo', start: 0, end: 7 }, '**');
    expect(once.value).toBe('**one**\n**two**');
    expect([once.start, once.end]).toEqual([0, once.value.length]);
    expect(formatMessage(once.value)).toBe('<strong>one</strong><br><strong>two</strong>');
    // Wrapped whole, the marks were drawn as typed.
    expect(formatMessage('**one\ntwo**')).toBe('**one<br>two**');
    const back = toggleWrap({ value: once.value, start: once.start, end: once.end }, '**');
    expect(back.value).toBe('one\ntwo');
    for (const mark of ['_', '~', '`']) {
      const v = toggleWrap({ value: 'see one\ntwo now', start: 4, end: 11 }, mark).value;
      expect(v).toBe(`see ${mark}one${mark}\n${mark}two${mark} now`);
    }
  });

  it('leaves blank lines and a line\'s indentation as they are, and the text around the selection', () => {
    const r = toggleWrap({ value: 'a\n\n  b  \nc', start: 0, end: 8 }, '_');
    expect(r.value).toBe('_a_\n\n  _b_  \nc');
    const back = toggleWrap({ value: r.value, start: 0, end: r.end }, '_');
    expect(back.value).toBe('a\n\n  b  \nc');
    // One line still wraps and unwraps as before, the selection kept inside the marks.
    expect(toggleWrap({ value: 'ab', start: 0, end: 2 }, '**')).toEqual({ value: '**ab**', start: 2, end: 4 });
  });
});

describe('a message written offline whose worker refuses it when the connection is back', () => {
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  it('is let go with a word when its conversation no longer exists (the channel was deleted meanwhile): the entry, and its placeholder, go', async () => {
    const calls = worker({ '/conv/gone1/messages': () => json({ code: 'not_found', message: 'No such conversation' }, 404) });
    openChannel([msg(1, 'a')]);
    await store.outbox.enqueue({ id: 'q1', ws: REF, conv: 'gone1', text: 'hello there, this is the note I wrote offline', ts: 1 });
    await store._restoreQueued();
    expect(store.conv('gone1').messages.map((m) => m.tempId)).toEqual(['q1']);
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    off();
    expect(await store.outbox.list()).toEqual([]);
    expect(store.conv('gone1').messages).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/dropped/);
    expect(notices[0]).toContain('“hello there, this is the note I wrote');
    expect(calls.filter((c) => c.includes('/conv/gone1/messages'))).toHaveLength(1);
    // Nothing tries it again.
    await store.outbox.flush();
    expect(calls.filter((c) => c.includes('/conv/gone1/messages'))).toHaveLength(1);
  });

  it('is set aside with a Retry, as before, when the channel still exists but the reader is out of it, and is found there when the channel is next opened', async () => {
    worker({ '/conv/c1/messages': () => json({ code: 'not_joined', message: 'Join the channel first' }, 403) });
    openChannel([msg(1, 'a')]);
    store.me.channels = []; // left it while the message waited
    await store.outbox.enqueue({ id: 'q2', ws: REF, conv: 'c1', text: 'kept', ts: 1 });
    const notices = [];
    const off = store.on('notice', (n) => notices.push(n));
    await store.outbox.flush();
    off();
    const [e] = await store.outbox.list();
    expect(e).toMatchObject({ id: 'q2', failed: true, lastError: 'Join the channel first' });
    expect(notices).toEqual([]);
  });

  it('is tried once per flush while the worker errors, one request per worker a pass, never set aside and with no cap on attempts', async () => {
    const calls = worker({ '/conv/c1/messages': () => json({ code: 'internal', message: 'boom' }, 500) });
    openChannel([msg(1, 'a')]);
    await store.outbox.enqueue({ id: 'q3', ws: REF, conv: 'c1', text: 'first', ts: 1 });
    await store.outbox.enqueue({ id: 'q4', ws: REF, conv: 'c1', text: 'second', ts: 2 });
    for (let i = 0; i < 3; i++) await store.outbox.flush();
    const list = await store.outbox.list();
    expect(list.map((e) => [e.id, e.attempts, !!e.failed])).toEqual([['q3', 3, false], ['q4', 0, false]]);
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(3);
  });
});

describe('the chime for one message, heard of by two tabs of the browser seconds apart', () => {
  const had = { ls: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), win: Object.getOwnPropertyDescriptor(globalThis, 'window') };
  let started = 0;
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() { started++; }, stop() {} }; }
  }
  /** Two tabs: two instances of the module over one browser storage. */
  async function twoTabs() {
    started = 0;
    const mem = new Map();
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: { AudioContext: FakeAudioContext }, configurable: true, writable: true });
    vi.resetModules();
    const a = await import('../src/lib/notify.js');
    vi.resetModules();
    const b = await import('../src/lib/notify.js');
    return { a, b };
  }
  afterEach(() => {
    vi.useRealTimers();
    for (const [k, d] of [['localStorage', had.ls], ['window', had.win]]) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });

  it('rings once between them when the chime is named by the message, the second tab hearing of it three seconds on staying quiet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 0));
    const { a, b } = await twoTabs();
    a.playNotificationSound({ key: 'ws:c1:41' });
    expect(started).toBe(3); // the two notes and the shimmer
    vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 3));
    b.playNotificationSound({ key: 'ws:c1:41' });
    expect(started).toBe(3);
    // Another message rings, in either tab; the same one again does not, for a minute.
    b.playNotificationSound({ key: 'ws:c1:42' });
    expect(started).toBe(6);
    vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 30));
    a.playNotificationSound({ key: 'ws:c1:41' });
    expect(started).toBe(6);
    vi.setSystemTime(new Date(2026, 8, 7, 10, 1, 31));
    a.playNotificationSound({ key: 'ws:c1:41' });
    expect(started).toBe(9);
  });

  it('keeps the two-second quiet alone for a chime named nothing, which is why the tabs rang twice for one message before', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 0));
    const { a, b } = await twoTabs();
    a.playNotificationSound();
    expect(started).toBe(3);
    vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 1));
    b.playNotificationSound();
    expect(started).toBe(3);
    vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 3));
    b.playNotificationSound();
    expect(started).toBe(6);
  });
});

describe('a star, a section or a preference the account\'s storage would not save', () => {
  afterEach(() => {
    store.user = null;
    store.identity = null;
    store.workspaces = [];
    resetStore();
  });

  /** The signed-in account with one workspace; its storage refuses every save when `saveFails`. */
  function account({ saveFails }) {
    const doc = () => ({ v: 1, profile: { name: 'Me' }, prefs: { enterSends: false }, workspaces: [{ ref: REF, name: 'A' }], worker: null });
    globalThis.puter = {
      kv: { get: async () => doc(), set: async () => { if (saveFails) throw new Error('Puter storage is not reachable'); return true; } },
      workers: { exec: async () => json({ ok: true }) },
    };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = doc();
    store._composeProfile();
    store._composeWorkspaces();
    store.wsId = REF;
  }

  it('is undone on screen along with the failure: the star off again, the preference and the name as they were, the profile redrawn', async () => {
    account({ saveFails: true });
    const events = [];
    const off = store.on('profile', () => events.push(store.isStarred('c1')));
    await expect(store.toggleStar('c1')).rejects.toThrow('Puter storage');
    expect(store.isStarred('c1')).toBe(false);
    expect(store.profile.prefs.starred).toBeUndefined();
    expect(store.user.prefs.starred).toBeUndefined();
    expect(events[0]).toBe(true); // shown starred at once
    expect(events[events.length - 1]).toBe(false); // and unstarred with the failure
    await expect(store.moveToSection('c1', 'sec1')).rejects.toThrow();
    expect(store.sections()).toEqual([]);
    await expect(store.updatePrefs({ enterSends: true })).rejects.toThrow();
    expect(store.profile.prefs.enterSends).toBe(false);
    await expect(store.updateProfile({ name: 'Someone else' })).rejects.toThrow();
    expect(store.profile.name).toBe('Me');
    off();
  });

  it('stands when the save goes through, applied to the copy here when the account cannot be read (offline)', async () => {
    account({ saveFails: false });
    globalThis.puter.kv.get = async () => { throw new Error('offline'); };
    await store.toggleStar('c1');
    expect(store.isStarred('c1')).toBe(true);
    await store.updatePrefs({ enterSends: true });
    expect(store.profile.prefs.enterSends).toBe(true);
  });
});

describe('routes with odd numbers, encodings and endings', () => {
  it('reads a thread or message number that is not a number, or negative, as no number, and the rest of the route as it stands', () => {
    expect(parseHash('#/ws/abc@srv/c/c1/t/abc')).toMatchObject({ name: 'conversation', ws: 'abc@srv', conv: 'c1', thread: null, message: null });
    expect(parseHash('#/ws/abc@srv/c/c1/m/-1')).toMatchObject({ conv: 'c1', message: null, details: false });
    expect(parseHash('#/ws/abc@srv/c/c1/t/5/m/-1')).toMatchObject({ conv: 'c1', thread: 5, message: null });
    // A reference with two @ is carried as typed for the workspace loader to refuse.
    expect(parseHash('#/ws/a@b@c/c/c1').ws).toBe('a@b@c');
  });

  it('decodes a percent-encoded reference or query, keeps a mangled escape as typed, and reads search links with a trailing slash or a query in the address', () => {
    expect(parseHash(buildHash({ ws: 'abc@srv', conv: 'c1' }))).toMatchObject({ ws: 'abc@srv', conv: 'c1' });
    expect(buildHash({ ws: 'abc@srv' })).toBe('#/ws/abc%40srv');
    expect(parseHash('#/ws/abc%40srv/search/caf%C3%A9%20au%2Flait')).toMatchObject({ name: 'search', ws: 'abc@srv', query: 'café au/lait' });
    expect(parseHash('#/ws/abc%4/c/c1').ws).toBe('abc%4');
    expect(parseAppLink('https://app.example/x/?v=2#/ws/abc%40srv/search/hello')).toMatchObject({ name: 'search', ws: 'abc@srv', query: 'hello' });
    expect(parseAppLink('https://app.example/x/#/ws/abc%40srv/c/c1/')).toMatchObject({ name: 'conversation', ws: 'abc@srv', conv: 'c1' });
    expect(parseAppLink('https://app.example/x/#/join/srv/ABCD-EFGH-JKLM')).toBeNull();
    expect(parseAppLink('not a url')).toBeNull();
  });

  it('adds no history entry with "replace", only announces the same address, and keeps a list pane beside the conversation', () => {
    const had = ['location', 'history', 'window', 'HashChangeEvent'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
    const pushes = [];
    let hash = '#/ws/abc';
    const dispatched = [];
    Object.defineProperty(globalThis, 'location', { value: { get hash() { return hash; }, set hash(v) { hash = v; pushes.push(v); } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'history', { value: { replaceState: (_s, _t, url) => { hash = url; } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: { dispatchEvent: (e) => dispatched.push(e.type) }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'HashChangeEvent', { value: class HashChangeEvent extends Event {}, configurable: true, writable: true });
    try {
      navigate({ ws: 'abc', conv: 'c1' }, { replace: true });
      expect(hash).toBe('#/ws/abc/c/c1');
      expect(pushes).toEqual([]);
      expect(dispatched).toEqual(['hashchange']);
      navigate({ ws: 'abc', conv: 'c2' });
      expect(pushes).toEqual(['#/ws/abc/c/c2']);
      expect(dispatched).toEqual(['hashchange']); // the browser announces a changed hash itself
      navigate({ ws: 'abc', conv: 'c2' });
      expect(pushes).toHaveLength(1);
      expect(dispatched).toEqual(['hashchange', 'hashchange']);
      hash = '#/ws/abc/dms';
      navigate({ ws: 'abc', conv: 'c3' });
      expect(hash).toBe('#/ws/abc/dms/c/c3');
    } finally {
      for (const [k, d] of had) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
    }
  });
});

describe('day labels and relative times at the edges of days and weeks', () => {
  it('tells Yesterday by the calendar at half past midnight, a day a week ago as a date, and counts calendar days across the clock changes', () => {
    const now = new Date(2026, 8, 7, 0, 0, 30).getTime();
    expect(dayLabel(new Date(2026, 8, 6, 23, 59).getTime(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 8, 7, 0, 0, 10).getTime(), now)).toBe('Today');
    expect(relativeLong(new Date(2026, 8, 6, 23, 0).getTime(), now)).toMatch(/^yesterday at /);
    expect(relativeLong(new Date(2026, 8, 6, 23, 59, 50).getTime(), now)).toBe('just now');
    // Six days back is a weekday; seven is a date.
    const noon = new Date(2026, 8, 7, 12).getTime();
    const six = new Date(2026, 8, 1, 12);
    expect(dayLabel(six.getTime(), noon)).toBe(six.toLocaleDateString(undefined, { weekday: 'long' }));
    const seven = new Date(2026, 7, 31, 12);
    expect(dayLabel(seven.getTime(), noon)).not.toBe(seven.toLocaleDateString(undefined, { weekday: 'long' }));
    expect(dayLabel(seven.getTime(), noon)).toMatch(/\d/);
    // Across the spring and autumn changes (a 23- or 25-hour day in zones that have them): two calendar days back is that weekday.
    for (const [from, to] of [[new Date(2026, 2, 7, 12), new Date(2026, 2, 9, 12)], [new Date(2026, 9, 31, 12), new Date(2026, 10, 2, 12)]]) {
      expect(dayLabel(from.getTime(), to.getTime())).toBe(from.toLocaleDateString(undefined, { weekday: 'long' }));
      expect(relativeLong(from.getTime(), to.getTime())).toMatch(new RegExp(`^${from.toLocaleDateString(undefined, { weekday: 'long' })} at `));
    }
  });

  it('writes no AM or PM for a locale with a 24-hour clock', () => {
    const ts = new Date(2026, 8, 7, 21, 5).getTime();
    expect(fullDateTime(ts, 'de-DE')).not.toMatch(/AM|PM/);
    expect(fullDateTime(ts, 'de-DE')).toMatch(/21:05/);
    expect(fullDateTime(ts, 'en-US')).toMatch(/PM/);
  });
});

describe('the drafts kept on the device, two hundred at most', () => {
  const had = { ls: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), win: Object.getOwnPropertyDescriptor(globalThis, 'window') };
  afterEach(() => {
    vi.useRealTimers();
    drafts._resetDraftCache();
    for (const [k, d] of [['localStorage', had.ls], ['window', had.win]]) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });

  it('lets go of the one least recently written, not the first written', () => {
    const mem = new Map();
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: { dispatchEvent() {} }, configurable: true, writable: true });
    drafts._resetDraftCache();
    vi.useFakeTimers();
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(i + 1);
      drafts.setDraft(`w:c${i}`, { text: `d${i}` });
    }
    vi.setSystemTime(300);
    drafts.setDraft('w:c0', { text: 'd0 written again' }); // the oldest conversation's draft, freshly written
    vi.setSystemTime(301);
    drafts.setDraft('w:c200', { text: 'd200' });
    const convs = drafts.listDrafts('w').map((d) => d.conv);
    expect(convs).toHaveLength(200);
    expect(convs).toContain('c0');
    expect(convs).not.toContain('c1');
    expect(convs[0]).toBe('c200');
  });
});

describe('the store, at a few edges looked into', () => {
  afterEach(resetStore);

  it('leaves a conversation marked unread alone when a document from before the mark still counts a mention on it, and heals a stuck mention otherwise', async () => {
    worker({ '/read': () => json({ ok: true }), '/unread': () => json({ ok: true }) });
    openChannel([msg(1, 'a'), msg(2, 'b', { mentions: ['u-me'] })]);
    store.me.mentions = { c1: 1 };
    store.me.reads = { c1: 2 };
    store._localSeen.set('c1', 2);
    store._readAcked.set('c1', { target: 2, x: 0, at: Date.now() });
    const reads = vi.spyOn(store, 'markRead');
    await store.markUnread('c1', 2);
    expect(store.me.reads.c1).toBe(1);
    store._healStuckMentions([['c1', { s: 2, x: 0 }]], REF);
    expect(reads).not.toHaveBeenCalled();
    expect(store.me.reads.c1).toBe(1);
    // Read again to the end and taken: the same document now heals the count.
    store._localSeen.set('c1', 2);
    store.me.reads.c1 = 2;
    store._unreadAt.clear();
    store._readAcked.set('c1', { target: 2, x: 0, at: Date.now() });
    store._healStuckMentions([['c1', { s: 2, x: 0 }]], REF);
    expect(reads).toHaveBeenCalledWith('c1', 2);
    reads.mockRestore();
  });

  it('opens the direct message with someone who has left where one exists, and refuses with a word where none does', async () => {
    const calls = worker({});
    openChannel([msg(1, 'a')]);
    store.ws.former = { 'u-old': { name: 'Old Hand', username: 'old' } };
    store.me.dms = { dm_old: { members: ['u-me', 'u-old'], createdAt: 1 } };
    expect(await store.openDmWith('u-old')).toEqual({ ws: REF, conv: 'dm_old' });
    store.me.dms = {};
    await expect(store.openDmWith('u-old')).rejects.toMatchObject({ status: 404, code: 'gone', message: expect.stringContaining('Old Hand') });
    expect(calls).toEqual([]);
  });

  it('reads a skipped message once, a deleted one included, and never again for the same number', async () => {
    const calls = worker({ '/conv/c1/messages': (q) => json({ messages: q.get('from') === '2' ? [] : [msg(2, 'b')], seq: 3, hasMore: false }) });
    openChannel([msg(1, 'a'), msg(3, 'c')]);
    await store._fillSkipped('c1', 2);
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(1);
    expect(store.conv('c1').sought.has(2)).toBe(true);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 3]);
    await store._fillSkipped('c1', 2);
    expect(calls.filter((c) => c.includes('/conv/c1/messages'))).toHaveLength(1);
  });

  it('does not drop a window being read around a permalinked message for being idle, and drops the longest-idle loaded one', () => {
    openChannel([msg(1, 'a')]);
    for (let i = 0; i < 13; i++) Object.assign(store.conv(`x${i}`), { loaded: true, openedAt: 1000 + i, messages: [msg(1, 'a')] });
    Object.assign(store.conv('p1'), { loading: true, loaded: false, openedAt: 1, messages: [] });
    store.setOpen('c1');
    expect(store.convs.has('p1')).toBe(true);
    expect(store.convs.has('c1')).toBe(true);
    expect(store.convs.has('x0')).toBe(false);
    expect(store.convs.has('x12')).toBe(true);
  });
});

describe('a search result whose message has code in it', () => {
  it('shows the code as written: underscores, asterisks, tildes and an address inside a code span are the code\'s own, as the message and its preview have them', () => {
    expect(highlightSnippet('use `_.map(a, _.identity)` here', ['here'])).toBe('use _.map(a, _.identity) <mark>here</mark>');
    expect(highlightSnippet('call `f(**a, **b)` now', ['now'])).toBe('call f(**a, **b) <mark>now</mark>');
    expect(highlightSnippet('`~x~` and ~y~', ['and'])).toBe('~x~ <mark>and</mark> y');
    expect(highlightSnippet('see `https://x.io/a` there', ['there'], 180, { appLink: () => 'thread in #general' })).toBe('see https://x.io/a <mark>there</mark>');
    for (const s of ['use `_.map(a, _.identity)` here', 'call `f(**a, **b)` now', '`~x~` and ~y~']) {
      expect(highlightSnippet(s, []).replace(/<[^>]+>/g, '')).toBe(previewText(s, 1000));
    }
  });

  it('keeps a fenced block\'s text the same way, less the renderer\'s language hint, and still finds and marks the words inside code', () => {
    expect(highlightSnippet('see ```\n_a_ **b**\n``` there', ['there'])).toBe('see _a_ **b** <mark>there</mark>');
    expect(highlightSnippet('see ```js\nconst _a_ = 1;\n``` there', ['const'])).toBe('see <mark>const</mark> _a_ = 1; there');
    expect(highlightSnippet('run `make _all_` now', ['make'])).toBe('run <mark>make</mark> _all_ now');
    // A stray fence with nothing closing it goes as before, and the private-use marks are never the message's to write.
    expect(highlightSnippet('```js\nconst a = 1;', ['const'])).toBe('<mark>const</mark> a = 1;');
    expect(highlightSnippet('a `x` b', ['b'])).toBe('a x <mark>b</mark>');
  });
});
