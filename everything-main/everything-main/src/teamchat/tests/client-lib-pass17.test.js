/**
 * Seventeenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass16.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { ApiError } from '../src/lib/api.js';
import { installDom } from './helpers/dom.js';

// For the one test that drives a dialog (see "a shared channel entry whose
// connection is over"): the toast, the theme, the modal layer and navigation
// mocked as tests/ui-conv-pass16.test.js mocks them. The store imports none
// of these, so the store tests above and below are untouched.
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
vi.mock('../src/ui/theme.js', () => ({ applyTheme: vi.fn(), currentTheme: () => 'system', isDark: () => false }));
vi.mock('../src/ui/modal.js', () => ({
  confirmDialog: vi.fn(async () => true),
  closeAllModals: vi.fn(),
  openModal: vi.fn(({ content, onClose }) => {
    document.body.append(content);
    const close = vi.fn(() => { content.remove(); onClose?.(); });
    return { close, panel: content, root: content };
  }),
}));
vi.mock('../src/lib/router.js', async (importOriginal) => ({ ...(await importOriginal()), navigate: vi.fn() }));
vi.mock('../src/lib/archive.js', async (importOriginal) => ({ ...(await importOriginal()), exportWorkspace: vi.fn(), transferWorkspace: vi.fn() }));

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

const msg = (seq, text, extra = {}) => ({ seq, user: 'u-me', text, ts: seq * 1000, kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, ...extra });
// The same two people share one direct message id across workspaces (see dmConvId).
const dms = { dm_x: { members: ['u-me', 'u-ann'], createdAt: 1 } };
/** A workspace open with the direct message's window loaded and holding `messages`. */
function openWith(ref, id, name, messages) {
  store.wsId = ref;
  store.ws = boot(id, name, {}).workspace;
  store.me = { role: 'member', channels: [], dms, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  const newest = messages.reduce((n, m) => Math.max(n, m.seq), 0);
  store.act = { c: { dm_x: { s: newest, t: newest * 1000 } }, p: {}, ps: {}, w: 1, u: 0 };
  store.convs.clear();
  Object.assign(store.conv('dm_x'), { loaded: true, seq: newest, messages });
}

describe('a message with a link whose send is answered with another workspace open', () => {
  afterEach(resetStore);

  it('asks the workspace it was written in for the preview card, as a queued message delivered after a switch does, and lays nothing into the workspace now open', async () => {
    const held = [];
    const calls = worker({
      '/conv/dm_x/messages': (_, init) => new Promise((r) => held.push(() => r(json({ message: msg(7, JSON.parse(init.body).text) })))),
      '/unfurl': () => json({ unfurl: null }),
    });
    openWith(REF, 'abc123def0', 'A', [msg(6, 'hi')]);
    const sent = store.send('dm_x', { text: 'see https://example.com/page' });
    await until(() => held.length === 1);
    // The switch to B, whose direct message with the same person holds its own message 6.
    openWith(OTHER, 'bbbbbb0000', 'B', [msg(6, 'other')]);
    held[0]();
    const m = await sent;
    expect(m.seq).toBe(7);
    expect(calls.filter((c) => c.includes('/unfurl'))).toEqual(['POST /api/ws/abc123def0/conv/dm_x/messages/7/unfurl']);
    expect(store.conv('dm_x').messages.map((x) => x.seq)).toEqual([6]);
    expect(store.latestSeq('dm_x')).toBe(6);
  });
});

describe('an edit that changes the link a message carries, answered with another workspace open', () => {
  afterEach(resetStore);

  it('asks the workspace the message lives in for the new card, and neither asks the workspace now open nor lays anything into its window', async () => {
    const held = [];
    const card = { url: 'https://b.example/', title: 'B' };
    const calls = worker({
      '/messages/7': (_, init) => new Promise((r) => held.push(() => r(json({ text: JSON.parse(init.body).text, editedAt: 7500, relink: true })))),
      // Both workers would answer a card for message 7; only A's must be asked.
      '/unfurl': () => json({ unfurl: card }),
    });
    openWith(REF, 'abc123def0', 'A', [msg(7, 'see https://a.example/', { unfurl: { url: 'https://a.example/', title: 'A' } })]);
    const edited = store.edit('dm_x', 7, 'see https://c.example/ instead');
    await until(() => held.length === 1);
    // The switch to B, whose direct message with the same person has a message 7 of its own, with a link and no card.
    openWith(OTHER, 'bbbbbb0000', 'B', [msg(7, 'https://b.example/')]);
    const events = [];
    const off = store.on('messages', (d) => events.push(d));
    held[0]();
    await edited;
    await tick(20);
    off();
    expect(calls.filter((c) => c.includes('/unfurl'))).toEqual(['POST /api/ws/abc123def0/conv/dm_x/messages/7/unfurl']);
    const seven = store.conv('dm_x').messages.find((m) => m.seq === 7);
    expect(seven.text).toBe('https://b.example/');
    expect(seven.editedAt).toBeUndefined();
    expect(seven.unfurl).toBeUndefined();
    expect(events).toEqual([]);
  });
});

describe('a deletion, or a preview taken down, answered with another workspace open', () => {
  afterEach(resetStore);

  it('takes nothing off the window of the workspace now open: its messages of those numbers stand, card and all', async () => {
    const held = [];
    worker({
      '/messages/7': () => new Promise((r) => held.push(() => r(json({ ok: true })))),
      '/messages/9': () => new Promise((r) => held.push(() => r(json({ ok: true })))),
      '/unfurl': () => new Promise((r) => held.push(() => r(json({ ok: true })))),
    });
    const page = () => [msg(7, 'seven'), msg(9, 'nine', { replyCount: 2 }), msg(11, 'https://x.example/', { unfurl: { url: 'https://x.example/', title: 'X' } })];
    openWith(REF, 'abc123def0', 'A', page());
    const removals = [store.remove('dm_x', 7), store.remove('dm_x', 9), store.removeUnfurl('dm_x', 11)];
    await until(() => held.length === 3);
    // The switch to B, whose direct message with the same person holds messages of the same numbers.
    openWith(OTHER, 'bbbbbb0000', 'B', page());
    const events = [];
    const off = store.on('messages', (d) => events.push(d));
    for (const release of held) release();
    await Promise.all(removals);
    off();
    const list = store.conv('dm_x').messages;
    expect(list.map((m) => m.seq)).toEqual([7, 9, 11]);
    expect(list.find((m) => m.seq === 9).deleted).toBeUndefined();
    expect(list.find((m) => m.seq === 11).unfurl).toEqual({ url: 'https://x.example/', title: 'X' });
    expect(events).toEqual([]);
  });
});

describe('a conversation shown from the offline cache as the connection returns', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };

  it('keeps the saved messages on screen while its fresh page is read, and shows the page when it lands', async () => {
    const held = [];
    worker({
      '/conv/c1/messages': () => new Promise((r) => held.push(() => r(json({ messages: [msg(1, 'a'), msg(2, 'b'), msg(3, 'c')], seq: 3, hasMore: false })))),
      abc123def0: () => json(boot('abc123def0', 'Acme', channels)),
    });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 2 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.offline = true; // shown from the offline copy, the window's page with it
    Object.assign(store.conv('c1'), { loaded: true, stale: Date.now() - 60_000, seq: 2, hasMore: false, messages: [msg(1, 'a'), msg(2, 'b')] });
    // What the list would draw at each word about the window: a window not loaded is drawn as a loading skeleton.
    const drawn = [];
    const off = store.on('messages', (d) => { if (d.conv === 'c1') drawn.push({ reason: d.reason, loaded: store.conv('c1').loaded, seqs: store.conv('c1').messages.map((m) => m.seq) }); });
    const stale = store.refreshStale();
    await until(() => held.length === 1);
    expect(store.conv('c1').loaded).toBe(true);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 2]);
    held[0]();
    await stale;
    off();
    expect(store.conv('c1').stale).toBe(false);
    expect(store.conv('c1').loaded).toBe(true);
    expect(store.conv('c1').messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(drawn.length).toBeGreaterThan(0);
    for (const d of drawn) {
      expect(d.loaded).toBe(true);
      expect(d.seqs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives way to the worker\'s refusal as a first load does: the window is no longer loaded, and says why', async () => {
    worker({
      '/conv/c1/messages': () => json({ code: 'forbidden', message: 'You are not in this channel any more' }, 403),
      abc123def0: () => json(boot('abc123def0', 'Acme', channels)),
    });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 2 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.offline = true;
    Object.assign(store.conv('c1'), { loaded: true, stale: Date.now() - 60_000, seq: 2, hasMore: false, messages: [msg(1, 'a'), msg(2, 'b')] });
    await store.refreshStale();
    const c = store.conv('c1');
    expect(c.error?.status).toBe(403);
    expect(c.loaded).toBe(false);
    expect(c.stale).toBe(false);
    expect(c.loading).toBe(false);
  });
});

describe('IndexedDB that could not be opened once', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  afterEach(() => {
    if (had) Object.defineProperty(globalThis, 'indexedDB', had);
    else delete globalThis.indexedDB;
    vi.resetModules();
  });

  it('is opened anew on the next call, rather than every read and write answering nothing for the rest of the tab\'s life', async () => {
    let opens = 0;
    const fakeDb = () => ({
      objectStoreNames: { contains: () => true },
      close() {},
      transaction() {
        const t = {};
        const req = {};
        queueMicrotask(() => {
          req.result = { key: 'k', n: opens };
          req.onsuccess?.();
          t.oncomplete?.();
        });
        t.objectStore = () => ({ get: () => req });
        return t;
      },
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      value: {
        open() {
          opens++;
          const req = {};
          // The first open fails (the browser under storage pressure, a passing fault); the next succeeds.
          if (opens === 1) queueMicrotask(() => req.onerror?.());
          else queueMicrotask(() => { req.result = fakeDb(); req.onsuccess?.(); });
          return req;
        },
      },
      configurable: true,
      writable: true,
    });
    vi.resetModules();
    const { idb } = await import('../src/lib/idb.js');
    expect(await idb.get('cache', 'k')).toBeNull();
    expect(await idb.get('cache', 'k')).toEqual({ key: 'k', n: 2 });
    expect(await idb.get('cache', 'k')).toEqual({ key: 'k', n: 2 });
    expect(opens).toBe(2);
  });
});

describe('an italic or struck run bounded by punctuation of another script', () => {
  it('is drawn as one, and read as one by the preview, the search snippet and the link finder, as a run bounded by ASCII punctuation is', async () => {
    const { formatMessage, previewText, highlightSnippet } = await import('../src/lib/format.js');
    const { linkableText } = await import('../src/shared/limits.js');
    // An Arabic comma, a CJK full stop, closing guillemets and corner brackets after the mark; opening ones before it.
    expect(formatMessage('مرحبا _بالعالم_، كيف')).toBe('مرحبا <em>بالعالم</em>، كيف');
    expect(formatMessage('_強調_。 ~取消~、')).toBe('<em>強調</em>。 <s>取消</s>、');
    expect(formatMessage('«_x_» “_y_” 「_z_」 _w_؟')).toBe('«<em>x</em>» “<em>y</em>” 「<em>z</em>」 <em>w</em>؟');
    expect(previewText('مرحبا _بالعالم_، كيف «~x~»')).toBe('مرحبا بالعالم، كيف «x»');
    expect(highlightSnippet('_強調_。', ['強調'])).toBe('<mark>強調</mark>。');
    expect(linkableText('«_https://x.io/a_»')).toBe('«https://x.io/a »');
    expect(linkableText('見て _https://x.io/a_ 。')).toBe('見て https://x.io/a  。');
    // What was never emphasis stays so: a name in snake case, a run closed against a letter or a dash, the connector
    // itself, and a mark right after a letter of any script (no boundary before it).
    expect(formatMessage('snake_case_name _a_b_ _x_-y a_b_ そして~取消~、')).toBe('snake_case_name _a_b_ _x_-y a_b_ そして~取消~、');
    expect(previewText('snake_case_name _a_b_')).toBe('snake_case_name _a_b_');
    expect(linkableText('x_https://x.io/a_y')).toBe('x_https://x.io/a_y');
    // An ampersand is no boundary anywhere: the user's angle bracket is an entity by the time the message is drawn.
    expect(formatMessage('_b_<c and _d_&e')).toBe('_b_&lt;c and _d_&amp;e');
    expect(previewText('_b_<c and _d_&e')).toBe('_b_<c and _d_&e');
    expect(linkableText('_b_&e')).toBe('_b_&e');
  });
});

describe('a link followed by punctuation of another script', () => {
  it('ends before it, in the message as drawn and in what the workers read as a link, while a trailing slash or hash stays', async () => {
    const { formatMessage } = await import('../src/lib/format.js');
    const { firstLinkOf, firstUnfurlableLink } = await import('../src/shared/limits.js');
    const A = 'target="_blank" rel="noopener noreferrer nofollow"';
    expect(formatMessage('見て https://x.io/a。')).toBe(`見て <a href="https://x.io/a" ${A}>https://x.io/a</a>。`);
    expect(formatMessage('انظر https://x.io/a، ثم')).toBe(`انظر <a href="https://x.io/a" ${A}>https://x.io/a</a>، ثم`);
    expect(formatMessage('«https://x.io/a» “https://x.io/b”')).toBe(`«<a href="https://x.io/a" ${A}>https://x.io/a</a>» “<a href="https://x.io/b" ${A}>https://x.io/b</a>”`);
    expect(firstLinkOf('見て https://x.io/a。')).toBe('https://x.io/a');
    expect(firstLinkOf('リンク：https://x.io/a、b')).toBe('https://x.io/a');
    expect(formatMessage('https://x.io/a。次')).toBe(`<a href="https://x.io/a" ${A}>https://x.io/a</a>。次`);
    expect(firstUnfurlableLink('_https://x.io/a_」')).toBe('https://x.io/a');
    // As before: a slash, a hash, an ampersand or a bracket pair at the end belong to the address.
    expect(firstLinkOf('https://x.io/a/ and')).toBe('https://x.io/a/');
    expect(firstLinkOf('https://x.io/a# and')).toBe('https://x.io/a#');
    expect(firstLinkOf('https://x.io/?a=1& and')).toBe('https://x.io/?a=1&');
    expect(firstLinkOf('https://en.wikipedia.org/wiki/Foo_(bar).')).toBe('https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(formatMessage('https://x.io/a/')).toBe(`<a href="https://x.io/a/" ${A}>https://x.io/a/</a>`);
  });
});

describe('a shortcode-shaped run inside a word', () => {
  it('stays as typed (a ratio, a key, a clock), while a code at a word\'s start turns, two in a row included', async () => {
    const { loadEmoji, replaceShortcodes, emojiFor } = await import('../src/lib/emoji.js');
    const { formatMessage } = await import('../src/lib/format.js');
    await loadEmoji();
    // Each of these is a shortcode on its own (b, x, o, id, v), and turned inside a word before.
    for (const code of ['b', 'x', 'o', 'id', 'v']) expect(emojiFor(code)).toBeTruthy();
    expect(replaceShortcodes('a:b:c')).toBe('a:b:c');
    expect(replaceShortcodes('type:x:1 and ns:id:7')).toBe('type:x:1 and ns:id:7');
    expect(replaceShortcodes('at 10:100:00')).toBe('at 10:100:00');
    expect(replaceShortcodes(':b: b')).toBe(`${emojiFor('b')} b`);
    expect(replaceShortcodes('ok :+1::-1: done')).toBe('ok 👍👎 done');
    expect(replaceShortcodes('(:x:) [:o:] ":v:"')).toBe(`(${emojiFor('x')}) [${emojiFor('o')}] "${emojiFor('v')}"`);
    expect(replaceShortcodes('un:smile:')).toBe('un:smile:');
    expect(replaceShortcodes('_:smile:')).toBe('_😄');
    // The renderer works on escaped text: a code after a quote (an entity by then) or a tag still turns.
    expect(formatMessage("'it's :+1:'")).toBe('&#39;it&#39;s 👍&#39;');
    expect(formatMessage('**bold**:100:')).toBe('<strong>bold</strong>💯');
    expect(formatMessage('see a:b:c here')).toBe('see a:b:c here');
  });
});

describe('a shared channel the host\'s admins had removed the member from, restored by them while the member is still on the host through another channel', () => {
  afterEach(resetStore);
  const channels = {
    s1: { id: 's1', name: 'design', shared: { ref: HOST, ch: 'h1', conn: 'k1', host: 'Host' } },
    s2: { id: 's2', name: 'ops', shared: { ref: HOST, ch: 'h2', conn: 'k2', host: 'Host' } },
  };
  const hostDoc = (inH2) => ({
    now: Date.now(),
    workspace: { id: 'cccccc0000', name: 'Host', channels: { h1: { id: 'h1', name: 'design', count: 3 }, ...(inH2 ? { h2: { id: 'h2', name: 'ops', count: 2 } } : {}) }, members: {} },
    me: { role: 'external', channels: inH2 ? ['h1', 'h2'] : ['h1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
    activity: { c: {}, p: {} },
  });

  it('opens again on the host\'s next document, which lists the member in it, rather than saying they were removed for the rest of the session', async () => {
    let restored = false;
    worker({ cccccc0000: () => json(hostDoc(restored)) });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['s1', 's2'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 1, u: 0 };
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(link.loaded).toBe(true);
    // The host's word on #ops, as the last attestation for it brought it back (see _attestLink): removed by its admins.
    const removed = new ApiError(403, 'removed', 'An admin of Host removed you from its shared channels');
    link.lostConvs.set('h2', removed);
    store.ws.channels.s2.lost = removed;
    expect(store.postAccess('s2')).toEqual({ ok: false, reason: 'shared_lost' });
    expect(store.postAccess('s1')).toEqual({ ok: true, reason: null });
    // Restored on the host: its next document lists the member in #ops again.
    restored = true;
    await store._refreshLink(link);
    expect(store.channel('s2').lost).toBeUndefined();
    expect(link.lostConvs.has('h2')).toBe(false);
    expect(store.postAccess('s2')).toEqual({ ok: true, reason: null });
    // A refresh of this workspace (a fresh copy of the entry) does not bring the old verdict back.
    store.ws = { ...store.ws, channels: { ...channels } };
    store._syncLinks();
    expect(store.channel('s2').lost).toBeUndefined();
  });
});

describe('a shared channel entry whose connection is over, which the member has not joined', () => {
  let dom = null;
  afterEach(async () => {
    await dom?.tick(5);
    dom?.uninstall();
    dom = null;
    delete globalThis.puter;
    vi.restoreAllMocks();
  });

  it('is offered nowhere to join (not counted, not a row of Browse channels), while one the member is in is still listed to open', async () => {
    dom = installDom({});
    vi.resetModules();
    globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
    const { store: s } = await import('../src/lib/store.js');
    const { ApiError } = await import('../src/lib/api.js');
    const lost = new ApiError(410, 'connection_ended', 'Acme ended the connection');
    const entry = (id, name, ch, over) => ({ id, name, count: 4, shared: { ref: HOST, ch, conn: `k-${ch}`, host: 'Acme' }, ...(over ? { lost } : {}) });
    s.wsId = REF;
    s.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    s.ws = {
      id: 'abc123def0', name: 'Globex', owner: 'u-me',
      channels: {
        c1: { id: 'c1', name: 'general', def: true, count: 3 },
        c2: { id: 'c2', name: 'random', count: 2 },
        s1: entry('s1', 'acme-joined', 'h1', true),
        s2: entry('s2', 'acme-gone', 'h2', true),
        s3: entry('s3', 'acme-live', 'h3', false),
      },
      members: { 'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 } },
    };
    s.me = { role: 'member', channels: ['c1', 's1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    s.act = { c: {}, p: {}, w: 0, u: 0 };
    // The store's lists: the count beside "Browse channels" and the sidebar's filter read the first.
    expect(s.browsableChannels().map((c) => c.id)).toEqual(['s3', 'c2']);
    expect(s.joinedChannels().map((c) => c.id)).toEqual(['s1', 'c1']);
    // The Browse channels dialog: the same rows, the joined lost entry to open, the unjoined one nowhere.
    const { browseChannelsDialog } = await import('../src/ui/dialogs.js');
    const { openModal } = await import('../src/ui/modal.js');
    browseChannelsDialog();
    await dom.tick(5);
    const content = openModal.mock.calls.at(-1)[0].content;
    const rows = [...content.querySelectorAll('.pick-item button')].map((b) => b.getAttribute('aria-label'));
    expect(rows).toEqual(['Join #acme-live', 'Join #random', 'Open #acme-joined', 'Open #general']);
    expect(content.textContent).not.toContain('acme-gone');
    expect(content.textContent).toContain('No longer shared with this workspace');
  });

  it('is not a row of the Directory\'s Channels tab either, where every other public channel is, the joined lost one to open', async () => {
    dom = installDom({});
    vi.resetModules();
    globalThis.puter = { workers: { exec: async () => json({ code: 'not_found', message: 'nope' }, 404) } };
    const { store: s } = await import('../src/lib/store.js');
    const { ApiError } = await import('../src/lib/api.js');
    const lost = new ApiError(410, 'connection_ended', 'Acme ended the connection');
    const entry = (id, name, ch, over) => ({ id, name, count: 4, shared: { ref: HOST, ch, conn: `k-${ch}`, host: 'Acme' }, ...(over ? { lost } : {}) });
    s.wsId = REF;
    s.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    s.ws = {
      id: 'abc123def0', name: 'Globex', owner: 'u-me',
      channels: {
        c1: { id: 'c1', name: 'general', def: true, count: 3 },
        c2: { id: 'c2', name: 'random', count: 2 },
        s1: entry('s1', 'acme-joined', 'h1', true),
        s2: entry('s2', 'acme-gone', 'h2', true),
        s3: entry('s3', 'acme-live', 'h3', false),
      },
      members: { 'u-me': { role: 'member', name: 'Me', username: 'me', color: 1 } },
    };
    s.me = { role: 'member', channels: ['c1', 's1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    s.act = { c: {}, p: {}, w: 0, u: 0 };
    const { createDirectoryView } = await import('../src/ui/directory.js');
    const dir = createDirectoryView();
    document.body.append(dir.el);
    dir.el.querySelectorAll('.conv-tab')[1].click();
    await dom.tick(5);
    // The name is the first text of the row's title (a pill may follow it: Archived, No longer shared).
    expect([...dir.el.querySelectorAll('.dir-row-text strong')].map((n) => n.firstChild.textContent)).toEqual(['acme-joined', 'acme-live', 'general', 'random']);
    const actions = [...dir.el.querySelectorAll('.dir-list button')].map((b) => b.getAttribute('aria-label')).filter((l) => /^(Join|Open) #/.test(l));
    expect(actions).toEqual(['Open #acme-joined', 'Join #acme-live', 'Open #general', 'Join #random']);
    dir.destroy();
  });
});
describe('a link to a host whose connection is over, as the workspace is read again', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' }, s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
  const gone = () => json({ code: 'forbidden', message: 'Your standing here has lapsed' }, 403);
  const over = () => json({ code: 'connection_ended', message: 'Host ended the connection' }, 410);
  const hostReads = (calls) => calls.filter((c) => c.startsWith('GET /api/ws/cccccc0000'));

  function arm() {
    const calls = worker({ '/attest': over, cccccc0000: gone });
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1', 's1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: {}, p: {}, ps: {}, w: 1, u: 0 };
    return calls;
  }

  it('is not read again before the wait its last failure earned is over, and is read at once when the entry\'s connection is renewed', async () => {
    const calls = arm();
    // The first look: the host refuses, the workspace's word is refused too, the connection is over.
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(link.lost).toBe(true);
    expect(link.failures).toBe(1);
    expect(link.retryAt).toBeGreaterThan(Date.now());
    expect(hostReads(calls)).toHaveLength(1);
    // The workspace is read again and again (a member joins, a role changes): the host is left alone while the wait stands.
    for (let i = 0; i < 4; i++) {
      store._syncLinks();
      await (link.loading || Promise.resolve());
    }
    expect(hostReads(calls)).toHaveLength(1);
    expect(link.failures).toBe(1);
    // The wait over, one more look.
    link.retryAt = Date.now() - 1;
    store._syncLinks();
    await link.loading;
    expect(hostReads(calls)).toHaveLength(2);
    expect(link.failures).toBe(2);
    expect(link.retryAt).toBeGreaterThan(Date.now());
    // An admin reconnects the channel (the entry carries a new connection): read now, whatever the wait.
    store.ws.channels.s1.shared = { ...store.ws.channels.s1.shared, conn: 'k2' };
    store._syncLinks();
    expect(link.loading).toBeTruthy();
    await link.loading;
    expect(hostReads(calls)).toHaveLength(3);
  });
});

