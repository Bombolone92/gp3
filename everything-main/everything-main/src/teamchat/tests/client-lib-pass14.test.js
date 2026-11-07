/**
 * Fourteenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass13.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { previewText, highlightSnippet, formatMessage } from '../src/lib/format.js';
import { store } from '../src/lib/store.js';
import { firstUnfurlableLink, linkableText } from '../src/shared/limits.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';

const REF = 'abc123def0@teamchat-test';
const OTHER = 'bbbbbb0000@teamchat-test';
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

const boot = (id, name, channels) => ({
  now: Date.now(),
  workspace: { id, name, channels, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } },
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
  store._forgotten.clear(); // a workspace forgotten by one test is not forgotten in the next
  store.offline = false;
  store.since = 0;
  store.act = { c: {}, p: {}, w: 0, u: 0 };
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
  delete globalThis.puter;
}

describe('a preview cut to length', () => {
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it('never cuts through an emoji, and keeps one written as a sequence whole', () => {
    // The cut falls inside the party popper (two code units at positions 76 and 77).
    const party = previewText(`${'a'.repeat(76)}🎉 and then a good deal more text after it`, 80);
    expect(party).not.toMatch(LONE_SURROGATE);
    expect(party.endsWith('🎉...')).toBe(true);
    // A family (seven code points, one character) at the cut stays whole or goes whole.
    const family = previewText(`${'a'.repeat(76)}👨‍👩‍👧${' more'.repeat(10)}`, 80);
    expect(family).not.toMatch(LONE_SURROGATE);
    expect(family.endsWith('👨‍👩‍👧...')).toBe(true);
    const before = previewText(`${'a'.repeat(74)}👨‍👩‍👧${' more'.repeat(10)}`, 80);
    expect(before).not.toMatch(LONE_SURROGATE);
    expect(before).not.toMatch(/‍\.\.\.$/);
    expect(before).not.toMatch(/👨\.\.\.$|👩\.\.\.$/);
  });

  it('counts characters as the reader sees them, and cuts plain text as before', () => {
    expect(previewText('x'.repeat(100), 10)).toHaveLength(10);
    expect(previewText('x'.repeat(100), 10).endsWith('...')).toBe(true);
    expect(previewText('short', 80)).toBe('short');
    // Fifty emoji are fifty characters, not a hundred: not cut at eighty.
    expect(previewText('🎉'.repeat(50), 80)).toBe('🎉'.repeat(50));
  });
});

describe('a preview and a search snippet of italics or strikethrough beside bold', () => {
  it('take the marks off against bold both ways round, as the message draws them', () => {
    // What the message draws: bold and italics with nothing between them.
    expect(formatMessage('**a**_b_ c')).toBe('<strong>a</strong><em>b</em> c');
    expect(previewText('**a**_b_ c')).toBe('ab c');
    expect(previewText('_a_**b**')).toBe('ab');
    expect(previewText('x **bold**_it_ and ~gone~**now**')).toBe('x boldit and gonenow');
    expect(previewText('**_both_** and **~struck~**')).toBe('both and struck');
    expect(previewText('_**inner**_')).toBe('inner');
    expect(highlightSnippet('see **Note**_worthy_ item here', ['item'])).toBe('see Noteworthy <mark>item</mark> here');
  });

  it('still leave an underscore inside a word, and a lone mark, as typed', () => {
    expect(previewText('snake_case_name and **x_y**')).toBe('snake_case_name and x_y');
    expect(previewText('MAX_RETRIES > 5')).toBe('MAX_RETRIES > 5');
    expect(previewText('a*_b_')).toBe('a*_b_');
    expect(previewText('_note_: **this**')).toBe('note: this');
  });
});

describe('the workspace read afresh as the connection returns', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };

  it('keeps a mark-unread, a mute and a cleared Activity badge made while that read was on its way', async () => {
    const answers = [];
    worker({
      '/read': () => json({ ok: true }),
      '/notify': () => json({ ok: true }),
      abc123def0: () => new Promise((r) => answers.push(r)),
    });
    const cached = boot('abc123def0', 'Cached', channels);
    cached.me.reads = { c1: 20 };
    cached.me.inbox = 3;
    store.wsId = REF;
    store.ws = cached.workspace;
    store.me = cached.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 20 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.offline = true; // shown from the offline copy; the poll got through and reads the workspace afresh
    const stale = store.refreshStale();
    await tick();
    expect(answers).toHaveLength(1);
    // Meanwhile the reader marks the channel unread, mutes it, and opens Activity; each write lands.
    await store.markUnread('c1', 10);
    await store.setNotify('c1', { mute: true });
    await store.readInbox();
    expect(store.me.reads.c1).toBe(9);
    expect(store.me.notify.c1.mute).toBe(true);
    expect(store.me.inbox).toBe(0);
    // The document, asked for before any of that, lands: it knows none of it.
    const fresh = boot('abc123def0', 'Fresh', channels);
    fresh.me.reads = { c1: 20 };
    fresh.me.inbox = 3;
    answers[0](json(fresh));
    await stale;
    expect(store.ws.name).toBe('Fresh');
    expect(store.offline).toBe(false);
    expect(store.me.reads.c1).toBe(9);
    expect(store.me.notify.c1.mute).toBe(true);
    expect(store.me.inbox).toBe(0);
    // A document asked for after the writes landed is trusted, as ever.
    const later = boot('abc123def0', 'Later', channels);
    later.me.reads = { c1: 9 };
    later.me.notify = { c1: { mute: true } };
    later.me.inbox = 0;
    const refresh = store.refreshWorkspace();
    await tick();
    answers[1](json(later));
    await refresh;
    expect(store.ws.name).toBe('Later');
    expect(store._unreadAt.size).toBe(0);
    expect(store._notifyPending.size).toBe(0);
  });
});

describe('an italic or struck address on a quoted line written without a space after the arrow', () => {
  const href = (text) => /href="([^"]+)"/.exec(formatMessage(text))?.[1] ?? null;

  it('is unfurled as the address the message draws', () => {
    for (const text of ['>_https://x.io/a_', '>~https://x.io/a~', 'see:\n>_https://x.io/a_ there', '> _https://x.io/a_', '>**https://x.io/a**', '>https://x.io/a']) {
      expect(href(text)).toBe('https://x.io/a');
      expect(firstUnfurlableLink(text)).toBe('https://x.io/a');
    }
  });

  it('keeps every address it found before, and a greater-than sign inside a line as it is', () => {
    expect(firstUnfurlableLink('x > y https://x.io/b')).toBe('https://x.io/b');
    expect(firstUnfurlableLink('a>_b_ https://x.io/c')).toBe('https://x.io/c');
    expect(linkableText('a>_b_')).toBe('a>_b_');
    expect(firstUnfurlableLink('`>https://x.io/code`')).toBeNull();
    expect(firstUnfurlableLink('> https://x.io/q?a=1')).toBe('https://x.io/q?a=1');
  });

  it('leaves the arrow where it stands, so a quoted line is still told by it line by line', () => {
    // ui/message.js firstQuotableLink skips lines that start with the arrow: a forwarded message must not quote its own permalink again.
    expect(linkableText('>_x_ y')).toBe('>x  y');
    expect(linkableText('> ~x~ y')).toBe('> x  y');
    expect(linkableText('said:\n>_https://x.io/a_').split('\n')[1].startsWith('>')).toBe(true);
    expect(linkableText('> https://x.io/a').startsWith('>')).toBe(true);
  });
});

/** Wait until `fn()` is truthy, polling; generous so six parallel runs do not make it flaky. */
const until = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await tick(10);
  }
};

describe('a read whose request fails', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const me = (reads) => ({ role: 'member', channels: ['c1'], dms: {}, reads, mentions: {}, notify: {}, threads: {} });
  const arm = () => {
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = me({ c1: 5 });
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 20 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.since = 1;
  };
  const sync = () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 });
  const readsOf = (calls) => calls.filter((c) => c.endsWith('/conv/c1/read'));

  it('is sent again by the next sync that gets through, and the cursor is held meanwhile', async () => {
    let down = true;
    const bodies = [];
    const calls = worker({
      '/sync': sync,
      '/read': (_, init) => { bodies.push(JSON.parse(init.body)); return down ? json({ code: 'error', message: 'boom' }, 503) : json({ ok: true }); },
    });
    arm();
    store.markRead('c1', 20);
    await until(() => readsOf(calls).length === 1);
    await tick(20);
    // Failed: the cursor stays where the reader left it, the read is not given up on.
    expect(store.me.reads.c1).toBe(5);
    expect(store.unreadCount('c1')).toBe(0);
    expect(store._seenAt.get('c1')?.acked).toBe(0);
    // A sync gets through while the read route still fails: tried again (its wait over), and still held.
    expect(store._readRetry.get(`${REF}:c1`)?.nextAt).toBeGreaterThan(Date.now());
    store._readRetry.get(`${REF}:c1`).nextAt = 0;
    await store.poll();
    await until(() => readsOf(calls).length === 2);
    await tick(20);
    expect(store._seenAt.get('c1')?.acked).toBe(0);
    // The worker takes reads again: the next sync re-sends it, and it lands.
    down = false;
    store._readRetry.get(`${REF}:c1`).nextAt = 0;
    await store.poll();
    await until(() => readsOf(calls).length === 3 && store.me.reads.c1 === 20);
    expect(bodies.every((b) => b.seq === 20 && !b.back)).toBe(true);
    expect(store._seenAt.get('c1')?.acked).toBeGreaterThan(0);
    expect(store._readRetry.size).toBe(0);
    // Nothing more goes out on the syncs after that.
    await store.poll();
    await tick(20);
    expect(readsOf(calls)).toHaveLength(3);
  });

  it('gives way to a mark-unread made meanwhile, and to a newer read', async () => {
    let down = true;
    const bodies = [];
    const calls = worker({
      '/sync': sync,
      '/read': (_, init) => { const b = JSON.parse(init.body); bodies.push(b); return down && !b.back ? json({ code: 'error', message: 'boom' }, 503) : json({ ok: true }); },
    });
    arm();
    store.markRead('c1', 20);
    await until(() => readsOf(calls).length === 1);
    await tick(20);
    await store.markUnread('c1', 10);
    expect(store.me.reads.c1).toBe(9);
    down = false;
    await store.poll();
    await tick(30);
    // The failed read is not sent again over the mark-unread: only the mark went out after it.
    expect(bodies.slice(1)).toEqual([{ seq: 9, back: true }]);
    expect(store.me.reads.c1).toBe(9);
    expect(store._readRetry.size).toBe(0);
    // A newer read supersedes an older failed one: only the newer target goes out again.
    down = true;
    store.act.c.c1.s = 30;
    store.markRead('c1', 25);
    await until(() => bodies.length === 3);
    await tick(20);
    store.markRead('c1', 30);
    await until(() => bodies.length === 4);
    await tick(20);
    down = false;
    for (const r of store._readRetry.values()) r.nextAt = 0;
    await store.poll();
    await until(() => bodies.length === 5);
    expect(bodies.slice(2).map((b) => b.seq)).toEqual([25, 30, 30]);
    await until(() => store.me.reads.c1 === 30);
  });

  it('gives up on a refusal: a workspace that moved for good, or a conversation that is gone', async () => {
    const calls = worker({
      '/sync': sync,
      '/read': () => json({ code: 'moved', message: 'This workspace moved to another address; this copy is read-only' }, 423),
    });
    arm();
    store.markRead('c1', 20);
    await until(() => readsOf(calls).length === 1);
    await tick(20);
    expect(store._readRetry.size).toBe(0);
    expect(store._seenAt.get('c1')?.acked).toBeGreaterThan(0);
    await store.poll();
    await tick(20);
    expect(readsOf(calls)).toHaveLength(1);
  });

  it('is sent again when the workspace is read afresh as the connection returns', async () => {
    let down = true;
    const calls = worker({
      '/read': () => (down ? json({ code: 'error', message: 'boom' }, 503) : json({ ok: true })),
      abc123def0: () => { const d = boot('abc123def0', 'Acme', channels); d.me.reads = { c1: 5 }; return json(d); },
    });
    arm();
    store.markRead('c1', 20);
    await until(() => readsOf(calls).length === 1);
    await tick(20);
    down = false;
    store._readRetry.get(`${REF}:c1`).nextAt = 0;
    store.offline = true;
    await store.refreshStale();
    await until(() => readsOf(calls).length === 2 && store.me.reads.c1 === 20);
    // The bootstrap's document (cursor 5) did not put the held cursor back, and the read landed after it.
    expect(store.unreadCount('c1')).toBe(0);
  });
});

describe('the outbox with an entry whose send throws something that is not the worker answering', () => {
  it('sets it aside with the message, rather than trying it for good as if the device were offline', async () => {
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (e.text === 'bad') throw new TypeError('f.blob is undefined'); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'bad', ts: 1 });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'good', ts: 2 });
    expect(await box.flush()).toEqual({ sent: 1, left: 1 });
    const [left] = await box.list();
    expect(left.text).toBe('bad');
    expect(left.failed).toBe(true);
    expect(left.lastError).toBe('f.blob is undefined');
    expect(sent).toEqual(['good']);
  });

  it('still keeps an entry the network could not carry, and one a worker could not take for the moment', async () => {
    let down = true;
    const errs = {
      a: () => Object.assign(new Error('Could not reach the workspace server'), { status: 0, code: 'network' }),
      b: () => Object.assign(new Error('No Teamchat server answers at this address'), { status: 404, code: 'no_backend' }),
      c: () => Object.assign(new Error('busy'), { status: 503, code: 'error' }),
    };
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (down) throw errs[e.ws](); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'a1', ts: 1 });
    await box.enqueue({ ws: 'b', conv: 'c', text: 'b1', ts: 2 });
    await box.enqueue({ ws: 'c', conv: 'c', text: 'c1', ts: 3 });
    expect(await box.flush()).toEqual({ sent: 0, left: 3 });
    expect((await box.list()).map((e) => [e.attempts, !!e.failed])).toEqual([[1, false], [1, false], [1, false]]);
    down = false;
    expect(await box.flush()).toEqual({ sent: 3, left: 0 });
  });
});

describe('the workspace list asked of the servers while a workspace is left', () => {
  afterEach(() => {
    resetStore();
    store.user = null;
    store.identity = null;
    store.workspaces = [];
    store._forgotten?.clear?.();
  });

  it('does not put the workspace just left back into the list when the answer lands', async () => {
    let kvDoc = { v: 1, profile: {}, prefs: {}, workspaces: [{ ref: REF, name: 'A' }, { ref: OTHER, name: 'B' }], worker: null };
    const answers = [];
    worker({ '/api/me': () => new Promise((r) => answers.push(r)) });
    globalThis.puter.kv = {
      get: async () => JSON.parse(JSON.stringify(kvDoc)),
      set: async (k, v) => { kvDoc = JSON.parse(JSON.stringify(v)); },
    };
    store.identity = { uuid: 'u-me', username: 'me' };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.user = JSON.parse(JSON.stringify(kvDoc));
    store._composeWorkspaces();
    // The servers are asked as the app boots; the answer is slow.
    const refresh = store.refreshWorkspaces();
    await tick();
    expect(answers).toHaveLength(1);
    // Meanwhile the member leaves B (or is told they were removed from it).
    await store.forgetWorkspace(OTHER);
    expect(store.user.workspaces.map((w) => w.ref)).toEqual([REF]);
    // The server's answer, computed before the leave, still lists both.
    answers[0](json({ workspaces: [{ id: 'abc123def0', name: 'A' }, { id: 'bbbbbb0000', name: 'B' }] }));
    await refresh;
    expect(store.user.workspaces.map((w) => w.ref)).toEqual([REF]);
    expect(store.workspaces.map((w) => w.ref)).toEqual([REF]);
    expect(kvDoc.workspaces.map((w) => w.ref)).toEqual([REF]);
    // A workspace joined afresh after that is listed again by the next asking.
    await store._addWorkspace({ ref: OTHER, name: 'B again' });
    const again = store.refreshWorkspaces();
    await tick();
    answers[1](json({ workspaces: [{ id: 'abc123def0', name: 'A' }, { id: 'bbbbbb0000', name: 'B' }] }));
    await again;
    expect(store.user.workspaces.map((w) => w.ref).sort()).toEqual([REF, OTHER].sort());
  });
});

describe('a sync of the workspace left behind, failing after the switch', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const sync = () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 });

  /** Workspace A's sync is held; the reader switches to B, whose poll loop waits its turn behind A's. */
  async function switchedWhileSyncing() {
    const held = [];
    const calls = worker({
      '/api/ws/abc123def0/sync': () => new Promise((r) => held.push(r)),
      '/api/ws/bbbbbb0000/sync': sync,
    });
    const errors = [];
    const off = store.on('error', (e) => errors.push(e));
    const a = boot('abc123def0', 'A', channels);
    store.wsId = REF;
    store.ws = a.workspace;
    store.me = a.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.since = 1;
    const polling = store.poll();
    await tick();
    expect(held).toHaveLength(1);
    // The switch: what openWorkspace does, then B's poll loop starts and finds A's poll still in flight.
    const b = boot('bbbbbb0000', 'B', channels);
    store.stopPolling();
    store.wsId = OTHER;
    store.ws = b.workspace;
    store.me = b.me;
    store.since = 1;
    store._schedule(10);
    await tick(30);
    expect(store._timer).not.toBeNull(); // B waits its turn
    return { held, calls, errors, off, polling };
  }

  it('is not read as B losing access: no error is raised, and B goes on polling', async () => {
    const { held, calls, errors, off, polling } = await switchedWhileSyncing();
    held[0](json({ code: 'forbidden', message: 'You are not a member of this workspace' }, 403));
    await polling;
    expect(errors).toEqual([]);
    expect(store._timer).not.toBeNull();
    await until(() => calls.some((c) => c.startsWith('GET /api/ws/bbbbbb0000/sync')));
    off();
  });

  it('is not read as B being out of reach either', async () => {
    const { held, calls, errors, off, polling } = await switchedWhileSyncing();
    held[0](Promise.reject(new TypeError('fetch failed')));
    await polling;
    expect(errors).toEqual([]);
    await until(() => calls.some((c) => c.startsWith('GET /api/ws/bbbbbb0000/sync')));
    off();
  });
});

describe('a queued message that the worker took', () => {
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  it('leaves the outbox even when laying it into the window fails, rather than being set aside or tried again', async () => {
    const channels = { c1: { id: 'c1', name: 'general' } };
    const calls = worker({
      messages: () => json({ message: { seq: 7, user: 'u-me', text: 'hi', ts: Date.now(), kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, cid: 'c_9' } }),
    });
    const b = boot('abc123def0', 'Acme', channels);
    store.wsId = REF;
    store.ws = b.workspace;
    store.me = b.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    // A fault in the bookkeeping after the send (here, a member document with no cursors to write into).
    store.me.reads = null;
    await store.outbox.enqueue({ id: 'c_9', ws: REF, conv: 'c1', text: 'hi', attachments: [], ts: 1 });
    expect(await store.outbox.flush()).toEqual({ sent: 1, left: 0 });
    expect(calls.filter((c) => c.endsWith('/conv/c1/messages'))).toHaveLength(1);
    expect(await store.outbox.list()).toEqual([]);
  });
});

describe('a send to a shared channel whose host asks for a fresh attestation while it is briefly failing', () => {
  const HOST = 'cccccc0000@teamchat-test';
  afterEach(async () => {
    for (const e of await store.outbox.list()) await store.outbox.remove(e.id);
    resetStore();
  });

  /** This workspace with the entry s1 for the host's channel hc, and a loaded link to the host. */
  function armShared() {
    const channels = { s1: { id: 's1', name: 'shared', shared: { ref: HOST, ch: 'hc', conn: 'k1', host: 'Host' } } };
    const a = boot('abc123def0', 'Acme', channels);
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
    return link;
  }
  const reattest = () => json({ code: 'reattest', message: 'Your standing here has lapsed' }, 403);

  it('fails a queued send with the host\'s passing failure, which the outbox tries again, not with the refusal', async () => {
    worker({
      '/conv/hc/messages': reattest,
      cccccc0000: () => json({ code: 'error', message: 'busy' }, 503),
    });
    const link = armShared();
    const entry = { id: 'c_5', ws: REF, conv: 's1', host: HOST, hconv: 'hc', text: 'to the host', attachments: [] };
    await expect(store._deliverQueued(entry)).rejects.toMatchObject({ status: 503 });
    expect(link.loaded).toBe(false);
    expect(link.error).toMatchObject({ status: 503 });
  });

  it('still fails it with the host\'s word when the channel was left meanwhile', async () => {
    worker({
      '/conv/hc/messages': reattest,
      cccccc0000: () => { store.links = new Map(); return json({ code: 'error', message: 'busy' }, 503); },
    });
    armShared();
    const entry = { id: 'c_6', ws: REF, conv: 's1', host: HOST, hconv: 'hc', text: 'to the host', attachments: [] };
    await expect(store._deliverQueued(entry)).rejects.toMatchObject({ status: 403, code: 'reattest' });
  });

  it('puts a live send into the outbox when the host could not be reached for the renewal', async () => {
    worker({
      '/conv/hc/messages': reattest,
      cccccc0000: () => { throw new TypeError('fetch failed'); },
    });
    armShared();
    const temp = await store.send('s1', { text: 'live one' });
    expect(temp.queued).toBe(true);
    expect(temp.failed).toBeFalsy();
    const [queued] = await store.outbox.list();
    expect(queued).toMatchObject({ ws: REF, conv: 's1', host: HOST, hconv: 'hc', text: 'live one' });
  });
});

describe('a read waiting to be sent again', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const arm = () => {
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = { role: 'member', channels: ['c1'], dms: {}, reads: { c1: 5 }, mentions: {}, notify: {}, threads: {} };
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 20 } }, p: {}, ps: {}, w: 1, u: 0 };
    store.since = 1;
  };
  const sync = () => json({ now: Date.now(), ts: Date.now(), c: {}, p: {}, w: 1, u: 0 });
  const readsOf = (calls) => calls.filter((c) => c.endsWith('/conv/c1/read'));

  it('is forgotten with a workspace the member has left, and never sent to it again', async () => {
    const calls = worker({ '/sync': sync, '/read': () => json({ code: 'error', message: 'boom' }, 503) });
    arm();
    store.markRead('c1', 20);
    await until(() => readsOf(calls).length === 1);
    await tick(20);
    expect(store._readRetry.size).toBe(1);
    await store.forgetWorkspace(REF);
    expect(store._readRetry.size).toBe(0);
    // Whatever syncs next sends nothing to it.
    await store.poll();
    await tick(20);
    expect(readsOf(calls)).toHaveLength(1);
  });

  it('holds the cursor over a document asked for before it landed, and trusts one asked for after', async () => {
    let down = true;
    const answers = [];
    const calls = worker({
      '/read': () => (down ? json({ code: 'error', message: 'boom' }, 503) : json({ ok: true })),
      abc123def0: () => new Promise((r) => answers.push(r)),
    });
    arm();
    store.markRead('c1', 20);
    await until(() => readsOf(calls).length === 1);
    await tick(20);
    // The connection returns: the workspace is asked for afresh, and while that document is on its way
    // the read is sent again (the online event) and lands.
    store.offline = true;
    const stale = store.refreshStale();
    await tick();
    expect(answers).toHaveLength(1);
    down = false;
    store._readRetry.get(`${REF}:c1`).nextAt = 0;
    store._resendReads();
    await until(() => readsOf(calls).length === 2 && store.me.reads.c1 === 20);
    expect(store._seenAt.get('c1').acked).toBeGreaterThan(0);
    // The document lands: computed before the read, it carries the old cursor, and does not lower the held one.
    const older = boot('abc123def0', 'Acme', channels);
    older.me.reads = { c1: 5 };
    answers[0](json(older));
    await stale;
    expect(store.offline).toBe(false);
    expect(store.me.reads.c1).toBe(20);
    expect(store.unreadCount('c1')).toBe(0);
    expect(store._seenAt.has('c1')).toBe(true);
    // A document asked for after the read landed is trusted, and knows the read: the hold is over.
    const refresh = store.refreshWorkspace();
    await tick();
    const later = boot('abc123def0', 'Acme', channels);
    later.me.reads = { c1: 20 };
    answers[1](json(later));
    await refresh;
    expect(store.me.reads.c1).toBe(20);
    expect(store._seenAt.has('c1')).toBe(false);
    expect(store._readRetry.size).toBe(0);
  });
});

describe('a queued message that lands with another workspace open', () => {
  afterEach(resetStore);

  it('still asks the worker for its link preview, as a live send does', async () => {
    const channels = { c1: { id: 'c1', name: 'general' } };
    const calls = worker({
      unfurl: () => json({ unfurl: null }),
      messages: () => json({ message: { seq: 7, user: 'u-me', text: 'see https://example.com/page', ts: Date.now(), kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, cid: 'c_1' } }),
    });
    // Workspace B is open; the entry was written in workspace A.
    const b = boot('bbbbbb0000', 'Other', channels);
    store.wsId = OTHER;
    store.ws = b.workspace;
    store.me = b.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    await store._deliverQueued({ id: 'c_1', ws: REF, conv: 'c1', text: 'see https://example.com/page', attachments: [] });
    await tick(5);
    expect(calls).toContain('POST /api/ws/abc123def0/conv/c1/messages');
    expect(calls).toContain('POST /api/ws/abc123def0/conv/c1/messages/7/unfurl');
    // Nothing of workspace A was laid into workspace B's windows.
    expect(store.convs.has('c1')).toBe(false);
  });

  it('asks nothing for a message without a link', async () => {
    const channels = { c1: { id: 'c1', name: 'general' } };
    const calls = worker({
      unfurl: () => json({ unfurl: null }),
      messages: () => json({ message: { seq: 8, user: 'u-me', text: 'no link here', ts: Date.now(), kind: 'msg', attachments: [], mentions: [], reactions: {}, replyCount: 0, cid: 'c_2' } }),
    });
    const b = boot('bbbbbb0000', 'Other', channels);
    store.wsId = OTHER;
    store.ws = b.workspace;
    store.me = b.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    await store._deliverQueued({ id: 'c_2', ws: REF, conv: 'c1', text: 'no link here', attachments: [] });
    await tick(5);
    expect(calls.some((c) => c.endsWith('/unfurl'))).toBe(false);
  });
});


describe('a draft removed while the browser will not store drafts', () => {
  const had = Object.fromEntries(['window', 'localStorage', 'CustomEvent'].map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  afterEach(() => {
    for (const [name, d] of Object.entries(had)) {
      if (d) Object.defineProperty(globalThis, name, d);
      else delete globalThis[name];
    }
    vi.resetModules();
  });

  const fake = () => {
    const mem = new Map();
    const state = { full: false, mem };
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { if (state.full) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); mem.set(k, String(v)); },
        removeItem: (k) => mem.delete(k),
      },
      configurable: true, writable: true,
    });
    const listeners = {};
    Object.defineProperty(globalThis, 'window', { value: { dispatchEvent() {}, addEventListener: (type, fn) => { listeners[type] = fn; } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'CustomEvent', { value: class { constructor(type) { this.type = type; } }, configurable: true, writable: true });
    state.listeners = listeners;
    return state;
  };

  it('does not come back from storage when the next conversation is typed in, nor when another tab writes', async () => {
    const st = fake();
    vi.resetModules();
    const drafts = await import('../src/lib/drafts.js');
    // Written while storage worked; then storage is full when the message is sent and its draft cleared.
    drafts.setDraft('ws1:c1', { text: 'sent a moment later' });
    st.full = true;
    drafts.setDraft('ws1:c1', { text: '' });
    expect(drafts.hasDraft('ws1:c1')).toBe(false);
    // Typing in the next conversation reads storage under the tab's copy: the sent draft must not return.
    drafts.setDraft('ws1:c2', { text: 'next' });
    expect(drafts.getDraft('ws1:c1')).toBeNull();
    expect(drafts.listDrafts('ws1').map((d) => d.conv)).toEqual(['c2']);
    // Another tab writes (its copy still carries the sent draft): still gone here.
    st.listeners.storage?.({ key: 'teamchat:drafts' });
    expect(drafts.getDraft('ws1:c1')).toBeNull();
    expect(drafts.getDraft('ws1:c2')?.text).toBe('next');
    // The first write that goes through leaves it out of storage too.
    st.full = false;
    drafts.setDraft('ws1:c3', { text: 'after' });
    expect(Object.keys(JSON.parse(st.mem.get('teamchat:drafts'))).sort()).toEqual(['ws1:c2', 'ws1:c3']);
  });

  it('takes a draft another tab wrote for that conversation after the removal', async () => {
    const st = fake();
    vi.resetModules();
    const drafts = await import('../src/lib/drafts.js');
    drafts.setDraft('ws1:c1', { text: 'old' });
    st.full = true;
    drafts.deleteDraft('ws1:c1');
    const map = JSON.parse(st.mem.get('teamchat:drafts'));
    map['ws1:c1'] = { text: 'written afresh elsewhere', attachments: [], ts: Date.now() + 5 };
    st.mem.set('teamchat:drafts', JSON.stringify(map));
    st.listeners.storage?.({ key: 'teamchat:drafts' });
    expect(drafts.getDraft('ws1:c1')?.text).toBe('written afresh elsewhere');
  });

  it('forgets everything at sign-out even when the write does not go through', async () => {
    const st = fake();
    vi.resetModules();
    const drafts = await import('../src/lib/drafts.js');
    drafts.setDraft('ws1:c1', { text: 'mine' });
    st.full = true;
    drafts.clearDrafts();
    drafts.setDraft('ws2:c9', { text: 'the next account' });
    expect(drafts.getDraft('ws1:c1')).toBeNull();
    expect(drafts.listDrafts('ws1')).toEqual([]);
  });
});
