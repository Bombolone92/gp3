/**
 * Twenty-third review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass22.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { store } from '../src/lib/store.js';
import { createOutbox, memoryStorage, layeredStorage } from '../src/lib/outbox.js';
import { formatMessage } from '../src/lib/format.js';
import { extractMentionNames, broadcastKind } from '../src/shared/limits.js';
import { installDom } from './helpers/dom.js';

/* ---- the store, driven in node with a fake Puter (as tests/client-lib-pass22.test.js) ---- */

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
function openChannel(messages, extra = {}, wsId = REF) {
  store.wsId = wsId;
  store.ws = boot(wsId.split('@')[0], 'Acme', channels).workspace;
  store.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  const newest = messages.reduce((n, m) => Math.max(n, m.seq), 0);
  store.act = { c: { c1: { s: newest, t: newest * 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.convs.clear();
  Object.assign(store.conv('c1'), { loaded: true, seq: newest, hasMore: false, messages, ...extra });
  return store.conv('c1');
}

/**
 * A messages route over a history of `total` messages numbered 1..total
 * (message n at n seconds), answering the reads the store makes (a page
 * from/to, the newest page, after, before), each after a short wait so a
 * caller can act between two of them.
 */
function history(total, { wait = 3 } = {}) {
  const all = Array.from({ length: total }, (_, i) => msg(i + 1, `m${i + 1}`));
  return async (q) => {
    await tick(wait);
    const from = Number(q.get('from'));
    const to = Number(q.get('to'));
    const after = Number(q.get('after'));
    let page;
    let hasMore = false;
    if (from) page = all.filter((m) => m.seq >= from && m.seq <= to);
    else if (after) page = all.filter((m) => m.seq > after);
    else {
      page = all.slice(-50);
      hasMore = total > 50;
    }
    return json({ messages: page, seq: total, hasMore });
  };
}

describe('a jump to a date whose search is still under way when the reader moves on', () => {
  afterEach(resetStore);

  it('yields to the latest messages (or the beginning) asked for meanwhile, rather than taking the list back to the date once found', async () => {
    worker({ '/conv/c1/messages': history(400) });
    openChannel(Array.from({ length: 50 }, (_, i) => msg(351 + i, `m${351 + i}`)));
    const jump = store.jumpToDate('c1', 200_000); // message 200, found by a dozen reads in turn
    await tick(8);
    await store.jumpToLatest('c1');
    const c = await jump;
    expect(c).toBe(store.conv('c1'));
    expect(store.conv('c1').hasNewer).toBe(false);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual(Array.from({ length: 50 }, (_, i) => 351 + i));
  });

  it('nor lands the other workspace\'s conversation of the same id at a place from this one\'s history after a switch of workspace', async () => {
    const calls = worker({ '/conv/c1/messages': history(400) });
    openChannel(Array.from({ length: 50 }, (_, i) => msg(351 + i, `m${351 + i}`)));
    const jump = store.jumpToDate('c1', 200_000);
    await tick(8);
    // Switched: the other workspace's c1 (a direct message shares its id across workspaces) has a window of its own.
    store.convs.clear();
    openChannel([msg(1, 'theirs'), msg(2, 'and theirs')], {}, 'fedcba9876@teamchat-test');
    await jump;
    await tick(30);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(store.conv('c1').hasNewer).toBe(false);
    // Nothing was read from the other workspace's server for it.
    expect(calls.filter((c) => c.includes('fedcba9876'))).toEqual([]);
  });
});

describe('a handle inside a link, or written in italics', () => {
  const members = { alice: { uuid: 'u1', name: 'Alice' }, bob: { uuid: 'u2', name: 'Bob' } };
  const drawn = (text) => /class="mention/.test(formatMessage(text, { members }));

  it('rings nobody when it is part of an address (the renderer draws the address whole, with no chip in it)', () => {
    for (const text of [
      'see https://mastodon.social/@alice',
      'npm i https://npmjs.com/package/@alice/x',
      '(https://x.io/@alice)',
      '_https://x.io/@alice_ ok',
      '**https://x.io/@alice**',
      'https://x.io/@alice.',
    ]) {
      expect(drawn(text), text).toBe(false);
      expect(extractMentionNames(text), text).toEqual([]);
    }
  });

  it('nor asks everyone when the address happens to hold @channel, @here or @everyone', () => {
    expect(extractMentionNames('https://mastodon.social/@channel')).toEqual([]);
    expect(broadcastKind(extractMentionNames('read https://x.io/@here/@everyone first'))).toBeNull();
  });

  it('takes the widest broadcast a text asks for: everyone, then channel, then here', () => {
    expect(broadcastKind(extractMentionNames('@here @channel deploy at 5'))).toBe('channel');
    expect(broadcastKind(extractMentionNames('@channel @here deploy at 5'))).toBe('channel');
    expect(broadcastKind(extractMentionNames('@here @everyone @channel'))).toBe('everyone');
    expect(broadcastKind(extractMentionNames('@here only'))).toBe('here');
  });

  it('while a handle beside an address, and one written in italics or bold (drawn as a chip), still ring', () => {
    expect(extractMentionNames('https://x.io/@bob and @alice')).toEqual(['alice']);
    for (const text of ['_@alice_', '**@alice**', '~@alice~', '(_@alice_)', '> _@alice_ said']) {
      expect(drawn(text), text).toBe(true);
      expect(extractMentionNames(text), text).toEqual(['alice']);
    }
    // Code keeps its words as they are, and rings nobody, as before.
    expect(extractMentionNames('`@alice` and ```\n@bob\n``` and https://x.io/@bob')).toEqual([]);
    expect(extractMentionNames('snake_@alice')).toEqual([]);
  });
});

/* ---- the device's store failing a read once ---- */

describe('IndexedDB refusing a read once (the connection closed under the page, a transaction aborted)', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  afterEach(() => {
    if (had) Object.defineProperty(globalThis, 'indexedDB', had);
    else delete globalThis.indexedDB;
    vi.resetModules();
  });

  /** A database whose reads fail as `how` says: the transaction erroring, or the connection closed so that opening one throws. */
  const install = (how) => {
    let opens = 0;
    const fakeDb = () => ({
      objectStoreNames: { contains: () => true },
      close() {},
      transaction() {
        if (how === 'throw') throw new DOMException('The database connection is closing', 'InvalidStateError');
        const t = {};
        const req = {};
        queueMicrotask(() => {
          if (how === 'error') t.onerror?.();
          else {
            req.result = [];
            req.onsuccess?.();
            t.oncomplete?.();
          }
        });
        t.objectStore = () => ({ getAll: () => req, getAllKeys: () => req });
        return t;
      },
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        open() {
          opens++;
          const req = {};
          if (how === 'open-fails') queueMicrotask(() => req.onerror?.());
          else queueMicrotask(() => { req.result = fakeDb(); req.onsuccess?.(); });
          return req;
        },
      },
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    return () => opens;
  };

  it('answers null for the records, not an empty list (which reads as every unsent message gone)', async () => {
    for (const how of ['error', 'throw', 'open-fails']) {
      install(how);
      const { idb } = await import('../src/lib/idb.js');
      expect(await idb.all('outbox'), how).toBeNull();
      expect(await idb.keys('cache'), how).toBeNull();
    }
    // A database that answers: its records, empty or not.
    install('ok');
    const { idb } = await import('../src/lib/idb.js');
    expect(await idb.all('outbox')).toEqual([]);
  });

  it('while a browser with no IndexedDB at all answers an empty list, for this tab\'s memory to stand in', async () => {
    delete globalThis.indexedDB;
    vi.resetModules();
    const { idb } = await import('../src/lib/idb.js');
    expect(await idb.all('outbox')).toEqual([]);
    expect(await idb.keys('cache')).toEqual([]);
  });
});

/** An outbox storage whose reads can be made to fail (answer null) for a while. */
function failableStorage() {
  const mem = memoryStorage();
  let failing = false;
  const durable = { all: async () => (failing ? null : mem.all()), put: mem.put, del: mem.del };
  return { storage: layeredStorage(durable), mem, fail: (on) => { failing = on; } };
}

describe('the outbox when the device\'s store cannot be read this once', () => {
  it('lists nothing (null), sends nothing, drops nothing, and goes on as before once the store answers again', async () => {
    const { storage, mem, fail } = failableStorage();
    const sent = [];
    const box = createOutbox({ storage, sendEntry: async (e) => { sent.push(e.text); }, uploadFile: async () => ({ id: 'f' }) });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'one', ts: 1 });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'two', ts: 2 });
    fail(true);
    expect(await box.list()).toBeNull();
    expect(await box.flush()).toEqual({ sent: 0, left: 0 });
    expect(sent).toEqual([]);
    expect((await mem.all()).map((e) => e.text).sort()).toEqual(['one', 'two']);
    expect(await box.retry('nothing')).toBeNull();
    await box.forget('w'); // nothing to forget that can be read; no fault
    fail(false);
    expect((await box.list()).map((e) => e.text)).toEqual(['one', 'two']);
    expect(await box.flush()).toEqual({ sent: 2, left: 0 });
    expect(sent).toEqual(['one', 'two']);
  });

  it('takes an entry whose file just went up as standing when the store cannot say, and sends it, rather than as discarded with the file left to go up again', async () => {
    const { storage, mem, fail } = failableStorage();
    const sent = [];
    let uploads = 0;
    const box = createOutbox({
      storage,
      sendEntry: async (e) => { sent.push(e.attachments.map((a) => a.id)); },
      uploadFile: async () => { uploads++; fail(true); return { id: `f${uploads}` }; },
    });
    await box.enqueue({ ws: 'w', conv: 'c', text: 'with a picture', ts: 1, files: [{ name: 'a.png', type: 'image/png', blob: new Blob(['x']) }] });
    await box.flush();
    expect(uploads).toBe(1);
    expect(sent).toEqual([['f1']]);
    fail(false);
    expect(await mem.all()).toEqual([]);
  });
});

describe('the placeholders of queued messages when the device\'s store cannot be read this once', () => {
  let had;
  afterEach(() => {
    if (had) store.outbox = had;
    had = null;
    resetStore();
  });

  it('stay where they are, and the polls keep flushing, rather than every queued row leaving the screen as sent or discarded elsewhere', async () => {
    const { storage, mem, fail } = failableStorage();
    had = store.outbox;
    store.outbox = createOutbox({
      storage,
      owner: () => null,
      uploadFile: async () => ({ id: 'file0000' }),
      sendEntry: (e) => store._deliverQueued(e),
      onChange: () => { store._syncQueued().catch(() => {}); store.emit('outbox'); },
    });
    worker({ '/sync': () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 }) });
    openChannel([msg(1, 'a')]);
    store.since = 1;
    await storage.put({ id: 'c_q1', ws: REF, conv: 'c1', text: 'waiting', ts: 2 });
    await storage.put({ id: 'c_q2', ws: REF, conv: 'c1', text: 'set aside', ts: 3, failed: true, lastError: 'Only admins can post' });
    await store._restoreQueued();
    await store._syncQueued();
    expect(store._hasQueued).toBe(true);
    expect(store.conv('c1').messages.map((m) => m.tempId ?? m.seq)).toEqual([1, 'c_q1', 'c_q2']);
    fail(true);
    const emits = [];
    const off = store.on('messages', (d) => emits.push(d));
    await store._syncQueued();
    await store.poll();
    await tick(20);
    off();
    expect(store.conv('c1').messages.map((m) => m.tempId ?? m.seq)).toEqual([1, 'c_q1', 'c_q2']);
    expect(emits.filter((d) => d.conv === 'c1')).toEqual([]);
    expect(store._hasQueued).toBe(true);
    // The store answers again, and one entry is gone (discarded from another tab): that row goes, the other stays.
    fail(false);
    await mem.del('c_q1');
    await store._syncQueued();
    expect(store.conv('c1').messages.map((m) => m.tempId ?? m.seq)).toEqual([1, 'c_q2']);
  });
});

/* ---- the composer's formatting helpers ---- */

describe('Quote applied to whole lines taken with Shift+Down (the selection ending right after a line break)', () => {
  it('quotes the lines selected and not the one the selection stops before', async () => {
    const { toggleQuote, toggleWrap } = await import('../src/lib/formatting.js');
    // "one\ntwo\n" selected: the caret stands at the start of "three".
    expect(toggleQuote({ value: 'one\ntwo\nthree', start: 0, end: 8 })).toEqual({ value: '> one\n> two\nthree', start: 2, end: 12 });
    // And back again from the same selection.
    expect(toggleQuote({ value: '> one\n> two\nthree', start: 0, end: 12 })).toEqual({ value: 'one\ntwo\nthree', start: 0, end: 8 });
    // A selection ending before an empty line does not quote the empty line.
    expect(toggleQuote({ value: 'one\n\nthree', start: 0, end: 4 })).toEqual({ value: '> one\n\nthree', start: 2, end: 6 });
    // Bold over the same selection marks the same lines (as it did), and the caret alone still takes its own line.
    expect(toggleWrap({ value: 'one\ntwo\nthree', start: 0, end: 8 }, '**').value).toBe('**one**\n**two**\nthree');
    expect(toggleQuote({ value: 'one\ntwo', start: 4, end: 4 })).toEqual({ value: 'one\n> two', start: 6, end: 6 });
  });
});

/* ---- a read still in its debounce when the page is put away or goes ---- */

describe('a conversation read in the last half-second before the page is put away or goes', () => {
  afterEach(resetStore);
  const reads = (calls) => calls.filter((c) => c.includes('/read'));

  it('has its read sent at once (what visibilitychange to hidden and pagehide do), once, and the debounce sends it no second time', async () => {
    const calls = worker({ '/read': () => json({ ok: true }) });
    openChannel([msg(1, 'a'), msg(2, 'b'), msg(3, 'c'), msg(4, 'd'), msg(5, 'e')]);
    store.markRead('c1', 5);
    expect(reads(calls)).toEqual([]);
    expect(store._readPending.size).toBe(1);
    store._flushReads();
    await tick(100); // well within the 600 ms the debounce would have taken
    expect(reads(calls).length).toBe(1);
    expect(store._readTimers.size).toBe(0);
    expect(store._readPending.size).toBe(0);
    await tick(700);
    expect(reads(calls).length).toBe(1);
    expect(store.me.reads.c1).toBe(5);
  });

  it('sends nothing for a read a mark-unread has since replaced, nor for one of a workspace since forgotten', async () => {
    const bodies = [];
    const calls = worker({ '/read': (q, init) => { bodies.push(JSON.parse(init.body)); return json({ ok: true }); } });
    openChannel([msg(1, 'a'), msg(2, 'b'), msg(3, 'c')]);
    store.markRead('c1', 3);
    await store.markUnread('c1', 2);
    store._flushReads();
    await tick(30);
    expect(bodies).toEqual([{ seq: 1, back: true }]);
    // A workspace forgotten with a read still waiting: nothing goes to it.
    store.markRead('c1', 3);
    const doc = { v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'Acme' }], worker: null };
    globalThis.puter.kv = { get: async () => structuredClone(doc), set: async () => {} };
    store.user = structuredClone(doc);
    await store.forgetWorkspace(REF);
    store._flushReads();
    await tick(30);
    expect(reads(calls).length).toBe(1);
    expect(store._readPending.size).toBe(0);
  });

  it('goes out from the page itself as it is hidden, and as it goes', async () => {
    const dom = installDom();
    vi.resetModules();
    let fresh;
    try {
      ({ store: fresh } = await import('../src/lib/store.js'));
      const calls = worker({ '/read': () => json({ ok: true }) });
      fresh.wsId = REF;
      fresh.ws = boot('abc123def0', 'Acme', channels).workspace;
      fresh.me = { role: 'member', channels: ['c1', 'c2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
      fresh.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
      fresh.act = { c: { c1: { s: 6, t: 6000 } }, p: {}, ps: {}, w: 1, u: 0 };
      Object.assign(fresh.conv('c1'), { loaded: true, seq: 6, hasMore: false, messages: [msg(5, 'e'), msg(6, 'f')] });
      fresh.markRead('c1', 5);
      document.hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await tick(100); // well within the 600 ms the debounce would have taken
      expect(reads(calls).length).toBe(1);
      document.hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      fresh.markRead('c1', 6);
      window.dispatchEvent(new Event('pagehide'));
      await tick(100);
      expect(reads(calls).length).toBe(2);
      await tick(700);
      expect(reads(calls).length).toBe(2);
    } finally {
      fresh?.stopPolling();
      dom.uninstall();
      delete globalThis.puter;
    }
  });
});

/* ---- a workspace named by a reference spelled another way ---- */

describe('a workspace opened by a link whose reference is spelled another way (capitals, the server\'s long name)', () => {
  afterEach(resetStore);

  it('opens under the one spelling the list holds, adds no second entry for it, lists a new one under that spelling, and is forgotten by either', async () => {
    const doc = { v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'Acme' }], worker: null };
    worker({
      '/api/ws/abc123def0': () => json(boot('abc123def0', 'Acme', channels)),
      '/api/ws/fedcba9876': () => json(boot('fedcba9876', 'Globex', channels)),
    });
    globalThis.puter.kv = { get: async () => structuredClone(doc), set: async (k, v) => { Object.assign(doc, structuredClone(v)); } };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = structuredClone(doc);
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    await store.openWorkspace('abc123def0@TEAMCHAT-TEST.puter.work');
    expect(store.wsId).toBe(REF);
    await tick(40);
    expect(doc.workspaces.map((w) => w.ref)).toEqual([REF]);
    // One not on the list yet, opened by a link spelled the long way: listed once, under the one spelling.
    await store.openWorkspace('fedcba9876@Teamchat-Test.puter.work');
    expect(store.wsId).toBe('fedcba9876@teamchat-test');
    await until(() => doc.workspaces.length === 2);
    expect(doc.workspaces.map((w) => w.ref)).toEqual([REF, 'fedcba9876@teamchat-test']);
    // Forgotten by another spelling of it: the entry goes all the same.
    await store.forgetWorkspace('fedcba9876@TEAMCHAT-TEST.puter.work');
    expect(doc.workspaces.map((w) => w.ref)).toEqual([REF]);
    expect(store._forgotten.has('fedcba9876@teamchat-test')).toBe(true);
  });
});

/* ---- routes with a query tacked on after the fragment ---- */

describe('a link with a query appended after its route (a tracker\'s ?utm_source=…, or a hand\'s)', () => {
  it('reads the route as it stands before the question mark: the invite or share code whole, the permalink with its message', async () => {
    const { parseHash, parseAppLink, buildHash } = await import('../src/lib/router.js');
    const { normalizeInviteCode } = await import('../src/shared/ids.js');
    const join = parseHash('#/join/teamchat-x/ABCD-EFGH-JKLM?utm_source=mail');
    expect(join).toMatchObject({ name: 'join', server: 'teamchat-x', code: 'ABCD-EFGH-JKLM' });
    expect(normalizeInviteCode(join.code)).toBe('ABCD-EFGH-JKLM');
    expect(parseHash('#/connect/teamchat-x/ABCD-EFGH-JKLM?ref=x')).toMatchObject({ name: 'connect', server: 'teamchat-x', code: 'ABCD-EFGH-JKLM' });
    expect(parseHash('#/ws/abc@srv/c/c1/m/5?utm_source=newsletter')).toMatchObject({ name: 'conversation', ws: 'abc@srv', conv: 'c1', message: 5 });
    expect(parseHash('#/ws/abc@srv/c/c1?x=1')).toMatchObject({ conv: 'c1', message: null });
    expect(parseAppLink('https://app.example/x/?v=2#/ws/abc%40srv/c/c1/t/3?utm=1')).toMatchObject({ conv: 'c1', thread: 3 });
    // A question mark a search query holds travels encoded, and stays.
    expect(parseHash(buildHash({ ws: 'abc@srv', query: 'why? not' }))).toMatchObject({ name: 'search', query: 'why? not' });
    expect(parseHash('#/ws/abc@srv/search/why%3F')).toMatchObject({ query: 'why?' });
  });
});

/* ---- a route whose workspace reference is spelled another way ---- */

describe('a route naming a workspace by another spelling of its reference (capitals, the server\'s long name)', () => {
  it('parses to the one spelling the store, the switcher and every navigate() use, from the first route on', async () => {
    const { parseHash, parseAppLink, buildHash } = await import('../src/lib/router.js');
    expect(parseHash('#/ws/abc123def0@TEAMCHAT-TEST.puter.work/c/c1').ws).toBe('abc123def0@teamchat-test');
    expect(parseHash('#/ws/abc123def0%40Teamchat-Test/c/c1/m/5')).toMatchObject({ ws: 'abc123def0@teamchat-test', conv: 'c1', message: 5 });
    expect(parseAppLink('https://app.example/x/#/ws/abc123def0%40TEAMCHAT-TEST.puter.work/threads').ws).toBe('abc123def0@teamchat-test');
    // Building a route from the canonical id and parsing it back is the identity.
    expect(parseHash(buildHash({ ws: 'abc123def0@teamchat-test', conv: 'c1' })).ws).toBe('abc123def0@teamchat-test');
    // What is not a reference is carried as typed, for the workspace loader to refuse.
    expect(parseHash('#/ws/a@b@c/c/c1').ws).toBe('a@b@c');
    expect(parseHash('#/ws/abc123def0@evil.example/c/c1').ws).toBe('abc123def0@evil.example');
    // The server an invite or share link names is filed under its short name too.
    expect(parseHash('#/join/TEAMCHAT-TEST.puter.work/ABCD-EFGH-JKLM')).toMatchObject({ name: 'join', server: 'teamchat-test', code: 'ABCD-EFGH-JKLM' });
    expect(parseHash('#/connect/Teamchat-Test/ABCD-EFGH-JKLM')).toMatchObject({ name: 'connect', server: 'teamchat-test' });
  });
});

/* ---- requests per poll with a shared channel in the workspace ---- */

/**
 * A partner workspace (two channels of its own and one shared from a host,
 * the link loaded) with a counting worker: `calls` lists every request,
 * `delta` is what this workspace's next sync says of its conversations, and
 * `history` the messages the reads answer with.
 */
async function partnerWithHost() {
  const HOST = 'host00host@teamchat-test';
  const calls = [];
  const history = { c1: [msg(1, 'a'), msg(2, 'b'), msg(3, 'c')], c2: [msg(1, 'x')] };
  const state = { delta: {} };
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        const m = init.method || 'GET';
        const mm = /^\/api\/ws\/([a-z0-9]+)(\/.*)?$/.exec(u.pathname);
        const ws = mm?.[1];
        const p = mm ? (mm[2] || '/') : u.pathname;
        calls.push(`${m} ${ws}${p}${u.search}`);
        let r;
        if (p === '/' && ws === 'host00host') {
          r = { now: Date.now(), workspace: { id: 'host00host', name: 'Acme', channels: { hch: { id: 'hch', name: 'design', count: 3 } }, members: {} }, me: { role: 'external', channels: ['hch'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} }, activity: { c: {}, p: {}, w: 1, u: {} } };
        } else if (p === '/sync') r = { now: Date.now(), ts: Date.now(), c: ws === 'abc123def0' ? state.delta : {}, p: {}, ps: {}, t: {}, h: {}, w: 1, u: 0 };
        else if ((r = /^\/conv\/([^/]+)\/messages$/.exec(p))) {
          const all = history[decodeURIComponent(r[1])] || [];
          const q = u.searchParams;
          const after = Number(q.get('after'));
          const from = Number(q.get('from'));
          const to = Number(q.get('to'));
          const page = after ? all.filter((y) => y.seq > after) : from ? all.filter((y) => y.seq >= from && y.seq <= to) : all;
          r = { messages: page, seq: all.length, hasMore: false };
        } else if (p === '/saved') r = { items: [] };
        else if (p === '/scheduled') r = { scheduled: [], reminders: [] };
        else return json({ code: 'not_found', message: 'nope' }, 404);
        return json(r);
      },
    },
  };
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = { id: 'abc123def0', name: 'Globex', channels: { c1: { id: 'c1', name: 'general' }, c2: { id: 'c2', name: 'random' }, e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' }, 'u-dan': { role: 'member', name: 'Dan', username: 'dan' } } };
  store.me = { role: 'admin', channels: ['c1', 'c2', 'e1'], dms: {}, reads: { c1: 3, c2: 1 }, mentions: {}, notify: {}, threads: {} };
  store.act = { c: { c1: { s: 3, t: 3, u: 'u-dan', x: 0 }, c2: { s: 1, t: 1, u: 'u-dan', x: 0 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.since = 1;
  store._syncLinks();
  await store.links.get(HOST).loading;
  await store.loadConversation('c1');
  calls.length = 0;
  return { calls, history, state, reads: (re) => calls.filter((c) => re.test(c)) };
}

describe('a poll bringing news to a loaded window, with a shared channel in the workspace (two syncs land within the same moment)', () => {
  afterEach(resetStore);

  it('reads a new message in the open channel once, not once per sync answer', async () => {
    const { calls, history, state, reads } = await partnerWithHost();
    history.c1.push(msg(4, 'd'));
    state.delta = { c1: { s: 4, t: 4, u: 'u-dan', x: 0 } };
    await store.poll();
    await tick(40);
    expect(reads(/\/sync/)).toHaveLength(2);
    expect(reads(/\/conv\/c1\/messages\?after=3/)).toHaveLength(1);
    expect(calls).toHaveLength(3);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
  });

  it('re-reads the window once for a reaction, and once each for a message and an overlay change together', async () => {
    const { calls, state, reads, history } = await partnerWithHost();
    state.delta = { c1: { s: 3, t: 3, u: 'u-dan', x: 1 } };
    await store.poll();
    await tick(40);
    expect(reads(/\/conv\/c1\/messages\?from=1&to=3/)).toHaveLength(1);
    expect(calls).toHaveLength(3);
    calls.length = 0;
    history.c1.push(msg(4, 'd'));
    state.delta = { c1: { s: 4, t: 4, u: 'u-dan', x: 2 } };
    await store.poll();
    await tick(40);
    expect(reads(/\?after=3/)).toHaveLength(1);
    expect(reads(/\?from=1&to=3/)).toHaveLength(1);
    expect(calls).toHaveLength(4);
  });

  it('and a window kept for a channel not open (opened before) the same', async () => {
    const { calls, history, state, reads } = await partnerWithHost();
    await store.loadConversation('c2');
    calls.length = 0;
    history.c2.push(msg(2, 'y'));
    state.delta = { c2: { s: 2, t: 2, u: 'u-dan', x: 0 } };
    await store.poll();
    await tick(40);
    expect(reads(/\/conv\/c2\/messages\?after=1/)).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('while a poll with nothing new makes the two syncs and nothing else', async () => {
    const { calls } = await partnerWithHost();
    await store.poll();
    await tick(40);
    expect(calls.filter((c) => /\/sync/.test(c))).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });
});

/* ---- requests at a bootstrap with a shared channel ---- */

describe('opening a workspace with a shared channel (the Later counts read as it opens, and again as the host answers)', () => {
  afterEach(resetStore);

  it('reads this workspace\'s saved items and scheduled messages once, and the host\'s once, rather than this workspace\'s twice', async () => {
    const HOST = 'host00host@teamchat-test';
    const calls = [];
    globalThis.puter = {
      workers: {
        exec: async (url, init = {}) => {
          const u = new URL(url);
          const mm = /^\/api\/ws\/([a-z0-9]+)(\/.*)?$/.exec(u.pathname);
          const ws = mm?.[1];
          const p = mm ? (mm[2] || '/') : u.pathname;
          calls.push(`${init.method || 'GET'} ${ws}${p}`);
          let r;
          if (p === '/' && ws === 'abc123def0') {
            r = { now: Date.now(), workspace: { id: 'abc123def0', name: 'Globex', channels: { c1: { id: 'c1', name: 'general', def: true }, e1: { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } } }, members: { 'u-me': { role: 'admin', name: 'Me', username: 'me' } } }, me: { role: 'admin', channels: ['c1', 'e1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} }, activity: { c: {}, p: {}, w: 1, u: {} } };
          } else if (p === '/' && ws === 'host00host') {
            r = { now: Date.now(), workspace: { id: 'host00host', name: 'Acme', channels: { hch: { id: 'hch', name: 'design', count: 3 } }, members: {} }, me: { role: 'external', channels: ['hch'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} }, activity: { c: {}, p: {}, w: 1, u: {} } };
          } else if (p === '/saved') r = { items: ws === 'host00host' ? [{ c: 'hch', s: 7, ts: 7 }] : [{ c: 'c1', s: 2, ts: 2 }] };
          else if (p === '/scheduled') r = { scheduled: [], reminders: ws === 'host00host' ? [{ id: 'r1', conv: 'hch', dueAt: 2 }] : [] };
          else return json({ code: 'not_found', message: 'nope' }, 404);
          return json(r);
        },
      },
    };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.user = { v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'Globex' }], worker: null };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    await store.openWorkspace(REF);
    store.stopPolling();
    await until(() => store.savedCount() === 2 && store.reminderCount() === 1);
    await tick(40);
    const of = (ws, path) => calls.filter((c) => c === `GET ${ws}${path}`).length;
    expect(of('abc123def0', '/saved')).toBe(1);
    expect(of('abc123def0', '/scheduled')).toBe(1);
    expect(of('host00host', '/saved')).toBe(1);
    expect(of('host00host', '/scheduled')).toBe(1);
    expect(calls).toHaveLength(6); // the two bootstraps and the four reads
    // The counts and marks are whole: this workspace's and the host's.
    expect(store.isSaved('c1', 2)).toBe(true);
    expect(store.isSaved('e1', 7)).toBe(true);
    expect(store.savedCount()).toBe(2);
    expect(store.reminderCount()).toBe(1);
    // Opened afresh from the Later view, the lists are read again (they are not cached past the moment).
    calls.length = 0;
    await store.loadSaved();
    expect(of('abc123def0', '/saved')).toBe(1);
    expect(of('host00host', '/saved')).toBe(1);
  });
});
