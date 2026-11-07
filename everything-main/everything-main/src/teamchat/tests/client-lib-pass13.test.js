/**
 * Thirteenth review pass, client libraries. Pure modules are imported
 * straight in; the browser is faked where a test needs one, as in
 * tests/client-lib-pass12.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { formatMessage, previewText, highlightSnippet, initials } from '../src/lib/format.js';
import { firstLinkOf, linkableText, cleanChannelName, LIMITS } from '../src/shared/limits.js';
import { store } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';

describe('drafts when the browser will not store them', () => {
  const had = Object.fromEntries(['window', 'localStorage', 'CustomEvent'].map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
  afterEach(() => {
    for (const [name, d] of Object.entries(had)) {
      if (d) Object.defineProperty(globalThis, name, d);
      else delete globalThis[name];
    }
    vi.resetModules();
  });

  it('keeps every conversation\'s draft in the tab, not only the one typed in last, and throws nothing at the composer', async () => {
    const mem = new Map();
    let writes = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: () => { writes++; throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' }); },
        removeItem: (k) => mem.delete(k),
      },
      configurable: true, writable: true,
    });
    const events = [];
    Object.defineProperty(globalThis, 'window', { value: { dispatchEvent: (e) => events.push(e.type), addEventListener() {} }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'CustomEvent', { value: class { constructor(type) { this.type = type; } }, configurable: true, writable: true });
    vi.resetModules();
    const drafts = await import('../src/lib/drafts.js');
    expect(() => drafts.setDraft('ws1:c1', { text: 'first conversation' })).not.toThrow();
    drafts.setDraft('ws1:c2', { text: 'second conversation' });
    expect(writes).toBe(2);
    expect(drafts.getDraft('ws1:c1')?.text).toBe('first conversation');
    expect(drafts.getDraft('ws1:c2')?.text).toBe('second conversation');
    expect(drafts.listDrafts('ws1').map((d) => d.conv).sort()).toEqual(['c1', 'c2']);
    expect(events.filter((e) => e === 'teamchat:drafts')).toHaveLength(2);
    // Removing one leaves the other, still in the tab.
    drafts.deleteDraft('ws1:c1');
    expect(drafts.getDraft('ws1:c1')).toBeNull();
    expect(drafts.getDraft('ws1:c2')?.text).toBe('second conversation');
  });

  it('reads storage again once a write has gone through', async () => {
    const mem = new Map();
    let full = true;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { if (full) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); mem.set(k, String(v)); },
        removeItem: (k) => mem.delete(k),
      },
      configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, 'window', { value: { dispatchEvent() {}, addEventListener() {} }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'CustomEvent', { value: class { constructor(type) { this.type = type; } }, configurable: true, writable: true });
    vi.resetModules();
    const drafts = await import('../src/lib/drafts.js');
    drafts.setDraft('ws1:c1', { text: 'kept in the tab' });
    full = false;
    drafts.setDraft('ws1:c2', { text: 'written' });
    // Both went into storage with the write that succeeded; from here the store is read as usual.
    expect(JSON.parse(mem.get('teamchat:drafts'))).toMatchObject({ 'ws1:c1': { text: 'kept in the tab' }, 'ws1:c2': { text: 'written' } });
    mem.set('teamchat:drafts', JSON.stringify({ 'ws1:c3': { text: 'from another tab', ts: 1 } }));
    drafts.setDraft('ws1:c4', { text: 'after' });
    expect(drafts.listDrafts('ws1').map((d) => d.conv).sort()).toEqual(['c3', 'c4']);
  });

  it('does not write away what another tab saved while this one held drafts storage would not take', async () => {
    const mem = new Map();
    let full = true;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => { if (full) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); mem.set(k, String(v)); },
        removeItem: (k) => mem.delete(k),
      },
      configurable: true, writable: true,
    });
    const listeners = {};
    Object.defineProperty(globalThis, 'window', { value: { dispatchEvent() {}, addEventListener: (type, fn) => { listeners[type] = fn; } }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'CustomEvent', { value: class { constructor(type) { this.type = type; } }, configurable: true, writable: true });
    vi.resetModules();
    const drafts = await import('../src/lib/drafts.js');
    // This tab's draft would not go into storage. Meanwhile storage came free and another tab wrote its own draft.
    drafts.setDraft('ws1:c1', { text: 'held here' });
    full = false;
    mem.set('teamchat:drafts', JSON.stringify({ 'ws1:c2': { text: 'from the other tab', ts: 1 } }));
    listeners.storage?.({ key: 'teamchat:drafts' });
    expect(drafts.getDraft('ws1:c1')?.text).toBe('held here');
    expect(drafts.getDraft('ws1:c2')?.text).toBe('from the other tab');
    // The first write that goes through carries both, not this tab's alone.
    drafts.setDraft('ws1:c1', { text: 'held here, edited' });
    expect(JSON.parse(mem.get('teamchat:drafts'))).toMatchObject({ 'ws1:c1': { text: 'held here, edited' }, 'ws1:c2': { text: 'from the other tab' } });
  });
});

describe('a workspace being moved to another server', () => {
  afterEach(resetStore);
  const MSG = 'This workspace is being moved to another server; try again in a few minutes.';
  const frozen = () => Object.assign(new Error(MSG), { status: 423, code: 'transferring' });
  const moved = () => Object.assign(new Error('This workspace moved to another address; this copy is read-only'), { status: 423, code: 'moved' });
  const channels = { c1: { id: 'c1', name: 'general' } };
  const arm = (doc) => {
    store.wsId = REF;
    store.ws = doc.workspace;
    store.me = doc.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  };

  it('keeps a queued message for it in the outbox, its turn kept, and sends it when the move is over', async () => {
    const sent = [];
    let freeze = true;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (e.ws === 'a' && freeze) throw frozen(); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'a1', ts: 1 });
    await box.enqueue({ ws: 'b', conv: 'c', text: 'b1', ts: 2 });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'a2', ts: 3 });
    expect(await box.flush()).toEqual({ sent: 1, left: 2 });
    const left = await box.list();
    expect(left.map((e) => [e.text, e.attempts, !!e.failed])).toEqual([['a1', 1, false], ['a2', 0, false]]);
    expect(left[0].lastError).toBe(MSG);
    freeze = false;
    expect(await box.flush()).toEqual({ sent: 2, left: 0 });
    expect(sent).toEqual(['b1', 'a1', 'a2']);
  });

  it('still sets aside a message for a workspace that has moved for good', async () => {
    const box = createOutbox({ storage: memoryStorage(), sendEntry: async () => { throw moved(); }, uploadFile: async () => ({ id: 'file0000' }) });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'a1', ts: 1 });
    expect(await box.flush()).toEqual({ sent: 0, left: 1 });
    expect((await box.list())[0].failed).toBe(true);
  });

  it('is known to the store from the bootstrap, on the worker\'s clock, and only for half an hour', async () => {
    // The worker's clock runs an hour behind this device's.
    const workerNow = Date.now() - 3600_000;
    const doc = boot('abc123def0', 'Acme', channels, { now: workerNow });
    doc.workspace.transferring = { by: 'u-nom', at: workerNow - 20 * 60_000 };
    worker({ abc123def0: () => json(doc) });
    arm(boot('abc123def0', 'Acme', channels));
    expect(store.isTransferring()).toBe(false);
    await store.refreshWorkspace();
    expect(store.ws.transferring).toEqual({ by: 'u-nom', at: workerNow - 20 * 60_000 });
    expect(store.isTransferring()).toBe(true); // ten minutes left, by the worker's clock
    expect(store.isTransferring('c1')).toBe(true);
    // Measured on this device's clock it would already look over.
    store._clockOffset = 0;
    expect(store.isTransferring()).toBe(false);
    store._learnClock(workerNow);
    expect(store.isTransferring()).toBe(true);
    // A freeze half an hour old, or none, is not one.
    store.ws.transferring = { by: 'u-nom', at: workerNow - 31 * 60_000 };
    expect(store.isTransferring()).toBe(false);
    store.ws.transferring = null;
    expect(store.isTransferring()).toBe(false);
  });

  it('lets the worker\'s word through a send and an edit as it is, and queues nothing', async () => {
    worker({
      '/messages': () => json({ code: 'transferring', message: MSG }, 423),
      '/messages/5': () => json({ code: 'transferring', message: MSG }, 423),
    });
    arm(boot('abc123def0', 'Acme', channels));
    await expect(store.send('c1', { text: 'hello' })).rejects.toMatchObject({ status: 423, code: 'transferring', message: MSG });
    const temp = store.conv('c1').messages.find((m) => m.text === 'hello');
    expect(temp.failed).toBe(true);
    expect(temp.error).toMatchObject({ status: 423, code: 'transferring', message: MSG });
    expect(await store.outbox.list()).toEqual([]);
    await expect(store.edit('c1', 5, 'changed')).rejects.toMatchObject({ status: 423, code: 'transferring', message: MSG });
  });
});

describe('the outbox with one workspace server not answering', () => {
  const silent = () => Object.assign(new Error('The server took too long to answer'), { status: 0, code: 'timeout' });

  it('sends what is bound for the other servers, in order, and keeps the silent one waiting its turn', async () => {
    const sent = [];
    let down = true;
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if (e.ws === 'a' && down) throw silent(); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'a1', ts: 1 });
    await box.enqueue({ ws: 'b', conv: 'c', text: 'b1', ts: 2 });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'a2', ts: 3 });
    await box.enqueue({ ws: 'b', conv: 'd', text: 'b2', ts: 4 });
    expect(await box.flush()).toEqual({ sent: 2, left: 2 });
    expect(sent).toEqual(['b1', 'b2']);
    const left = await box.list();
    expect(left.map((e) => e.text)).toEqual(['a1', 'a2']);
    // The second entry for the silent server waited behind the first, untried, so its turn comes in order.
    expect(left.map((e) => e.attempts)).toEqual([1, 0]);
    expect(left.every((e) => !e.failed)).toBe(true);
    down = false;
    expect(await box.flush()).toEqual({ sent: 2, left: 0 });
    expect(sent).toEqual(['b1', 'b2', 'a1', 'a2']);
  });

  it('holds an entry bound for a shared channel behind its host, not its workspace', async () => {
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if ((e.host || e.ws) === 'h') throw silent(); sent.push(e.text); },
      uploadFile: async () => ({ id: 'file0000' }),
    });
    await box.enqueue({ ws: 'a', conv: 'shared', host: 'h', hconv: 'hc', text: 'to the host', ts: 1 });
    await box.enqueue({ ws: 'a', conv: 'c', text: 'to the workspace', ts: 2 });
    expect(await box.flush()).toEqual({ sent: 1, left: 1 });
    expect(sent).toEqual(['to the workspace']);
  });
});

describe('initials of a name with an emoji written as a sequence', () => {
  it('keeps a family, a flag or a hand with a skin tone whole', () => {
    expect(initials('👨‍👩‍👧 Fam')).toBe('👨‍👩‍👧F');
    expect(initials('🇫🇷 Team')).toBe('🇫🇷T');
    expect(initials('🇫🇷team')).toBe('🇫🇷T');
    expect(initials('👍🏽 Ok')).toBe('👍🏽O');
    expect(initials('👨‍👩‍👧')).toBe('👨‍👩‍👧');
    expect(initials('👩‍💻x')).toBe('👩‍💻X');
    // As before.
    expect(initials('🚀 Rocket Team')).toBe('🚀T');
    expect(initials('Ava Chen')).toBe('AC');
    expect(initials('alice')).toBe('AL');
    expect(initials('')).toBe('?');
  });

  it('falls back to whole code points where the browser cannot segment', () => {
    const had = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true });
    try {
      expect(initials('🚀 Rocket Team')).toBe('🚀T');
      expect(initials('🇫🇷 Team')).toBe('🇫T'); // a flag's first half: the best a code point can do
      expect(initials('Ava Chen')).toBe('AC');
    } finally {
      Object.defineProperty(Intl, 'Segmenter', had);
    }
    expect(initials('🇫🇷 Team')).toBe('🇫🇷T');
  });
});

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));

/** Route each call by the end of its path; a handler gets the query and the request init, and may answer later. */
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

/** A bootstrap document for a workspace with these channels, all joined. */
const boot = (id, name, channels, extra = {}) => ({
  now: Date.now(),
  workspace: { id, name, channels, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } },
  me: { role: 'member', channels: Object.keys(channels), dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
  activity: { c: {}, p: {}, w: 1, u: {} },
  ...extra,
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
  store._saved = null;
  store._savedDone = new Set();
  store._savedCount = 0;
  store._savedWrites = 0;
  store._wsFetch = 0;
  store._wsApplied = 0;
  store._clockOffset = 0;
  store.offline = false;
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
  delete globalThis.puter;
}

describe('a permalink read as words whose words carry the marker characters', () => {
  const APP = 'https://app.example/#/ws/abc123def0@srv/c/dm_1/m/5';
  // The private-use characters the preview and the snippet work with: U+E000 parks code spans, U+E001/U+E002 mark hits.
  const PH = String.fromCharCode(0xe000);
  const OPEN = String.fromCharCode(0xe001);
  const CLOSE = String.fromCharCode(0xe002);

  it('does not let the placeholder in a name lay lifted code into the preview', () => {
    // A direct message's title is its people's names; a name may carry the
    // private-use character the preview parks code spans behind.
    const label = () => `message in your DM with ${PH}0${PH} Bob`;
    expect(previewText(`see \`x\` ${APP} now`, 200, { appLink: label })).toBe('see x message in your DM with 0 Bob now');
    expect(previewText(`see ${APP} now`, 200, { appLink: label })).toBe('see message in your DM with 0 Bob now');
    // Unchanged: an address inside code stays as written, and one nobody can name keeps its address.
    expect(previewText(`\`${APP}\``, 200, { appLink: label })).toBe(APP);
    expect(previewText(`see ${APP}`, 200, { appLink: () => null })).toBe(`see ${APP}`);
  });

  it('does not let the mark characters in a name open a highlight in a search result', () => {
    const label = () => `thread in #${OPEN}gen${CLOSE}eral`;
    expect(highlightSnippet(`see ${APP} now`, ['now'], 180, { appLink: label })).toBe('see thread in #general <mark>now</mark>');
    // A search word inside the words themselves is marked, as it is anywhere in the line.
    expect(highlightSnippet(`see ${APP} now`, ['general'], 180, { appLink: () => 'thread in #general' })).toBe('see thread in #<mark>general</mark> now');
    // A stray mark character in the message text itself is still taken off, as before.
    expect(highlightSnippet(`a${OPEN}bc${CLOSE}`, ['abc'])).toBe('<mark>abc</mark>');
  });
});

describe('the workspace read again when the connection is back', () => {
  afterEach(resetStore);

  it('takes its place among the document refreshes: an older answer landing after it does not put the document back', async () => {
    const answers = [];
    worker({ abc123def0: () => new Promise((r) => answers.push(r)) });
    const channels = { c1: { id: 'c1', name: 'general' } };
    const cached = boot('abc123def0', 'Cached', channels);
    store.wsId = REF;
    store.ws = cached.workspace;
    store.me = cached.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.offline = true; // shown from the offline copy
    // A refresh asked for first (a change made as the connection returned), then the poll gets through and reads the workspace afresh.
    const refresh = store.refreshWorkspace();
    await tick();
    const stale = store.refreshStale();
    await tick();
    expect(answers).toHaveLength(2);
    answers[1](json(boot('abc123def0', 'Fresh', channels)));
    await stale;
    expect(store.ws.name).toBe('Fresh');
    expect(store.offline).toBe(false);
    // The earlier-asked document lands last: it is older, and does not stand.
    answers[0](json(boot('abc123def0', 'Older', channels)));
    await refresh;
    expect(store.ws.name).toBe('Fresh');
  });

  it('gives way to a fresher document applied while it was on its way', async () => {
    const answers = [];
    worker({ abc123def0: () => new Promise((r) => answers.push(r)) });
    const channels = { c1: { id: 'c1', name: 'general' } };
    const cached = boot('abc123def0', 'Cached', channels);
    store.wsId = REF;
    store.ws = cached.workspace;
    store.me = cached.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.offline = true;
    const stale = store.refreshStale();
    await tick();
    const refresh = store.refreshWorkspace();
    await tick();
    answers[1](json(boot('abc123def0', 'Fresher', channels)));
    await refresh;
    answers[0](json(boot('abc123def0', 'Bootstrap', channels)));
    await stale;
    expect(store.ws.name).toBe('Fresher');
  });
});

describe('the read cursor while a read is on its way', () => {
  afterEach(resetStore);
  const channels = { c1: { id: 'c1', name: 'general' } };
  const me = (reads) => ({ role: 'member', channels: ['c1'], dms: {}, reads, mentions: {}, notify: {}, threads: {} });
  const arm = () => {
    store.wsId = REF;
    store.ws = boot('abc123def0', 'Acme', channels).workspace;
    store.me = me({ c1: 5 });
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    store.act = { c: { c1: { s: 20 } }, p: {}, ps: {}, w: 1, u: 0 };
  };

  it('is not put back by a document asked for before the read was taken, and follows the worker once the read has landed', async () => {
    const answers = [];
    let reads = 0;
    worker({
      abc123def0: () => new Promise((r) => answers.push(r)),
      '/read': () => { reads++; return json({ ok: true }); },
    });
    arm();
    // A document is asked for; then the reader reaches the end of the conversation.
    const refresh = store.refreshWorkspace();
    await tick();
    store.markRead('c1', 20);
    expect(store.unreadCount('c1')).toBe(0);
    // The document, from before the read, carries the old cursor: it does not step the cursor back.
    answers[0](json(boot('abc123def0', 'Acme', channels, { me: me({ c1: 5 }) })));
    await refresh;
    expect(store.me.reads.c1).toBe(20);
    expect(store.unreadCount('c1')).toBe(0);
    // The read goes out and is taken. A document asked for after that says
    // what the worker holds, a mark-unread made on another device included.
    await tick(700);
    expect(reads).toBe(1);
    const later = store.refreshWorkspace();
    await tick();
    answers[1](json(boot('abc123def0', 'Acme', channels, { me: me({ c1: 9 }) })));
    await later;
    expect(store.me.reads.c1).toBe(9);
  });

  it('stands over a mark-unread made before the read, and under one made after it', async () => {
    const answers = [];
    worker({
      abc123def0: () => new Promise((r) => answers.push(r)),
      '/read': () => json({ ok: true }),
    });
    arm();
    const refresh = store.refreshWorkspace();
    await tick();
    // Marked unread from message 10, then read to the end after all.
    store.markUnread('c1', 10);
    await tick(3);
    store.markRead('c1', 20);
    answers[0](json(boot('abc123def0', 'Acme', channels, { me: me({ c1: 5 }) })));
    await refresh;
    expect(store.me.reads.c1).toBe(20);
    expect(store.unreadCount('c1')).toBe(0);
    // Read to the end, then marked unread from message 10: the mark is the newer word.
    const again = store.refreshWorkspace();
    await tick();
    store.markRead('c1', 20);
    await tick(3);
    store.markUnread('c1', 10);
    answers[1](json(boot('abc123def0', 'Acme', channels, { me: me({ c1: 20 }) })));
    await again;
    expect(store.me.reads.c1).toBe(9);
    expect(store.unreadCount('c1')).toBe(11);
  });
});

describe('the saved list read while a save lands', () => {
  afterEach(resetStore);

  it('is not laid over the save: read again, and the mark and the count stand meanwhile', async () => {
    const answers = [];
    let gets = 0;
    const calls = worker({
      '/saved': (_, init) => {
        if ((init.method || 'GET') === 'POST') return json({ ok: true, saved: true });
        gets++;
        return new Promise((r) => answers.push(r));
      },
    });
    const doc = boot('abc123def0', 'Acme', { c1: { id: 'c1', name: 'general' } });
    store.wsId = REF;
    store.ws = doc.workspace;
    store.me = doc.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    // The list is asked for as the workspace opens; a message is saved before it answers.
    const loading = store.loadSaved();
    await tick();
    expect(gets).toBe(1);
    await store.save('c1', 5);
    expect(store.isSaved('c1', 5)).toBe(true);
    expect(store.savedCount()).toBe(1);
    // The list from before the save lands: the save is not undone by it.
    answers[0](json({ items: [] }));
    await tick(5);
    expect(store.isSaved('c1', 5)).toBe(true);
    expect(store.savedCount()).toBe(1);
    expect(gets).toBe(2);
    answers[1](json({ items: [{ c: 'c1', s: 5, ts: 1, done: false }] }));
    const items = await loading;
    expect(items.map((i) => `${i.c}:${i.s}`)).toEqual(['c1:5']);
    expect(store.isSaved('c1', 5)).toBe(true);
    expect(store.savedCount()).toBe(1);
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it('is applied as it is when nothing was saved meanwhile', async () => {
    let gets = 0;
    worker({ '/saved': () => { gets++; return json({ items: [{ c: 'c1', s: 2, ts: 1, done: true }, { c: 'c1', s: 3, ts: 2, done: false }] }); } });
    const doc = boot('abc123def0', 'Acme', { c1: { id: 'c1', name: 'general' } });
    store.wsId = REF;
    store.ws = doc.workspace;
    store.me = doc.me;
    store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
    await store.loadSaved();
    expect(gets).toBe(1);
    expect(store.isSaved('c1', 2)).toBe(true);
    expect(store.savedCount()).toBe(1);
  });
});

describe('a channel name cut to its length', () => {
  it('does not end in the hyphen the cut left standing', () => {
    const max = LIMITS.channelName;
    expect(cleanChannelName(`${'a'.repeat(max - 1)}-b`)).toBe('a'.repeat(max - 1));
    expect(cleanChannelName(`${'a'.repeat(max - 1)} b`)).toBe('a'.repeat(max - 1));
    expect(cleanChannelName(`${'a'.repeat(max - 1)}--b`)).toBe('a'.repeat(max - 1));
    expect(cleanChannelName('a-'.repeat(max))).toBe('a-'.repeat(max / 2 - 1) + 'a');
  });

  it('keeps every name it made before', () => {
    const max = LIMITS.channelName;
    expect(cleanChannelName('  Design Team ')).toBe('design-team');
    expect(cleanChannelName('Launch!! Q3')).toBe('launch-q3');
    expect(cleanChannelName('a-b_c')).toBe('a-b_c');
    expect(cleanChannelName(`-${'a'.repeat(max + 5)}`)).toBe('a'.repeat(max));
    expect(cleanChannelName(`${'-'.repeat(50)}x`)).toBe('x');
    expect(cleanChannelName('a'.repeat(100))).toHaveLength(max);
    expect(cleanChannelName('---')).toBeNull();
    expect(cleanChannelName('-'.repeat(60))).toBeNull();
    expect(cleanChannelName('   ')).toBeNull();
    expect(cleanChannelName(null)).toBeNull();
  });
});

const A = 'target="_blank" rel="noopener noreferrer nofollow"';
const hrefOf = (html) => /href="([^"]*)"/.exec(html)?.[1] ?? null;

describe('the notification chime after the clock was set back', () => {
  const had = { window: Object.getOwnPropertyDescriptor(globalThis, 'window'), localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') };
  const restore = (name) => {
    if (had[name]) Object.defineProperty(globalThis, name, had[name]);
    else delete globalThis[name];
  };
  afterEach(() => {
    restore('window');
    restore('localStorage');
    vi.resetModules();
  });

  it('rings though the last chime is noted at a moment still to come, and puts the note right', async () => {
    let started = 0;
    class FakeAudioContext {
      state = 'running';
      currentTime = 0;
      destination = {};
      createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { return { type: '', frequency: { value: 0 }, connect() {}, start() { started++; }, stop() {} }; }
    }
    const mem = new Map();
    Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'window', { value: { AudioContext: FakeAudioContext }, configurable: true, writable: true });
    // The note of a chime rung while the clock stood an hour ahead, before it was corrected.
    mem.set('teamchat:chime', String(Date.now() + 3600_000));
    vi.resetModules();
    const notify = await import('../src/lib/notify.js');
    notify.playNotificationSound();
    expect(started).toBe(3); // the two notes and the shimmer
    expect(Number(mem.get('teamchat:chime'))).toBeLessThanOrEqual(Date.now());
    // Just rung: the two-second quiet holds as ever.
    notify.playNotificationSound();
    expect(started).toBe(3);
  });
});

describe('a link with bold right beside it', () => {
  it('is unfurled as the address the renderer draws, not one joined to the bold text', () => {
    // The renderer bolds first, so bold marks end an address; taking them
    // off the words instead ran the address into the text beside it.
    expect(hrefOf(formatMessage('https://x.io/a**b**'))).toBe('https://x.io/a');
    expect(firstLinkOf('https://x.io/a**b**')).toBe('https://x.io/a');
    expect(hrefOf(formatMessage('see**https://x.io/a**'))).toBe('https://x.io/a');
    expect(firstLinkOf('see**https://x.io/a**')).toBe('https://x.io/a');
    expect(hrefOf(formatMessage('**https://x.io/a**b'))).toBe('https://x.io/a');
    expect(firstLinkOf('**https://x.io/a**b')).toBe('https://x.io/a');
  });

  it('keeps every address it found before', () => {
    expect(firstLinkOf('**https://x.io/z**')).toBe('https://x.io/z');
    expect(firstLinkOf('see **https://x.io/a** now')).toBe('https://x.io/a');
    expect(firstLinkOf('(_https://x.io/a_)')).toBe('https://x.io/a');
    expect(firstLinkOf('see _https://x.io/a_: now')).toBe('https://x.io/a');
    expect(firstLinkOf('`https://x.io/code` https://x.io/real')).toBe('https://x.io/real');
    expect(firstLinkOf('bold **words** only')).toBeNull();
    // Lines stay lines for the readers that split on them.
    expect(linkableText('**a**\n**b**').split('\n')).toHaveLength(2);
  });
});

describe('emphasis on the first line of a quote, and inside bold', () => {
  it('renders italics and strikethrough on the first line of a quote as on the lines after it', () => {
    expect(formatMessage('> _hi_ there')).toBe('<blockquote class="quote"><em>hi</em> there</blockquote>');
    expect(formatMessage('> ~done~ next')).toBe('<blockquote class="quote"><s>done</s> next</blockquote>');
    expect(formatMessage('> quote\n> _second_ line')).toBe('<blockquote class="quote">quote<br><em>second</em> line</blockquote>');
  });

  it('nests italics or strikethrough inside bold, and strikethrough inside italics', () => {
    expect(formatMessage('**_x_**')).toBe('<strong><em>x</em></strong>');
    expect(formatMessage('**~x~**')).toBe('<strong><s>x</s></strong>');
    expect(formatMessage('x **_y_** z')).toBe('x <strong><em>y</em></strong> z');
    expect(formatMessage('(**_x_**)')).toBe('(<strong><em>x</em></strong>)');
    expect(formatMessage('_~x~_')).toBe('<em><s>x</s></em>');
    // As before: bold inside italics.
    expect(formatMessage('_**x**_')).toBe('<em><strong>x</strong></em>');
  });

  it('draws as a link the address the worker unfurls when it is written in bold italics or quoted in italics', () => {
    expect(formatMessage('**_https://x.io/a_**')).toBe(`<strong><em><a href="https://x.io/a" ${A}>https://x.io/a</a></em></strong>`);
    expect(firstLinkOf('**_https://x.io/a_**')).toBe('https://x.io/a');
    expect(formatMessage('> _https://x.io/q_')).toBe(`<blockquote class="quote"><em><a href="https://x.io/q" ${A}>https://x.io/q</a></em></blockquote>`);
    expect(firstLinkOf('> _https://x.io/q_')).toBe('https://x.io/q');
    // The plain-text preview reads them the same way.
    expect(previewText('> _hi_ there')).toBe('hi there');
    expect(previewText('**_x_**')).toBe('x');
  });

  it('is still nothing an underscore inside a word, or an angle bracket the user typed, can start', () => {
    expect(formatMessage('snake_case_name: value')).toBe('snake_case_name: value');
    expect(formatMessage('a>_b_')).toBe('a&gt;_b_');
    expect(formatMessage('_b_<c')).toBe('_b_&lt;c');
  });

  it('draws bold and italics with nothing between them both ways round, and links an italic address beside bold', () => {
    expect(formatMessage('**a**_b_')).toBe('<strong>a</strong><em>b</em>');
    expect(formatMessage('_a_**b**')).toBe('<em>a</em><strong>b</strong>');
    expect(formatMessage('**a**~b~')).toBe('<strong>a</strong><s>b</s>');
    // The worker unfurls this address (a bold mark reads as a space there): the message must draw it as a link.
    expect(formatMessage('_https://x.io/a_**b**')).toBe(`<em><a href="https://x.io/a" ${A}>https://x.io/a</a></em><strong>b</strong>`);
    expect(firstLinkOf('_https://x.io/a_**b**')).toBe('https://x.io/a');
    expect(formatMessage('**b**_https://x.io/a_')).toBe(`<strong>b</strong><em><a href="https://x.io/a" ${A}>https://x.io/a</a></em>`);
    expect(firstLinkOf('**b**_https://x.io/a_')).toBe('https://x.io/a');
  });
});
