/**
 * Eleventh review pass, client libraries: the message window when a send
 * lands while a page of a detached window is still on its way, the huddle
 * a second join leaves behind, and the loaded windows a switch of workspace
 * leaves mid-refresh. Puter is faked at `puter.workers.exec`, as in
 * tests/store.test.js.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { store } from '../src/lib/store.js';
import { createOutbox, memoryStorage } from '../src/lib/outbox.js';
import { Huddle } from '../src/lib/huddle.js';

const REF = 'abc123def0@teamchat-test';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const tick = (ms = 2) => new Promise((r) => setTimeout(r, ms));
const msgs = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, text: `m${from + i}`, user: 'u2', ts: 1000 + from + i }));

/** Route each call by the end of its path; a handler may return a promise that waits. */
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

function openPlain() {
  store.wsId = REF;
  store.profile = { uuid: 'u-me', username: 'me', name: 'Me', prefs: {} };
  store.ws = { id: 'abc123def0', name: 'Globex', channels: { c1: { id: 'c1', name: 'ops' } }, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } };
  store.me = { role: 'member', channels: ['c1'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} };
  store.act = { c: {}, p: {}, w: 0, u: 0 };
}

afterEach(() => {
  store.stopPolling();
  store.wsId = null;
  store.ws = null;
  store.me = null;
  store.profile = null;
  store.links = new Map();
  store.convs.clear();
  store._localSeen.clear();
  store._seenAt.clear();
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
  delete globalThis.puter;
});

describe('a send from a window opened at an older message', () => {
  it('jumps to the newest page even while a page of that window is still on its way, rather than leaving a gap', async () => {
    // The window stands at 75..125 of 500, paging forward; the reader
    // scrolls to its edge (a page after 125 goes out) and sends a message
    // in the same breath.
    let releasePage;
    const page = new Promise((r) => { releasePage = r; });
    worker({
      '/messages': async (q, init) => {
        if (init.method === 'POST') return json({ message: { seq: 501, text: 'hi', user: 'u-me', ts: 2000, kind: 'msg', attachments: [], mentions: [], reactions: {} } });
        if (q.get('after')) {
          await page;
          return json({ seq: 501, hasMore: true, messages: msgs(126, 275) });
        }
        // The newest page.
        return json({ seq: 501, hasMore: true, messages: msgs(452, 501) });
      },
    });
    openPlain();
    const c = store.conv('c1');
    Object.assign(c, { loaded: true, seq: 500, hasMore: true, hasNewer: true, messages: msgs(75, 125) });
    const paging = store.loadNewer('c1');
    await tick();
    expect(c.loading).toBe(true);
    await store.send('c1', { text: 'hi' });
    releasePage();
    await paging;
    await tick(10);
    const seqs = c.messages.map((m) => m.seq);
    // The window is the end of the conversation now: the newest page, whole, and nothing older left dangling before it.
    expect(c.hasNewer).toBe(false);
    expect(seqs[0]).toBe(452);
    expect(seqs[seqs.length - 1]).toBe(501);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });
});

describe('a workspace document asked for before a switch away and back', () => {
  const OTHER = 'other00000@teamchat-test';
  const boot = (id, name, channels) => ({
    now: Date.now(),
    workspace: { id, name, channels, members: { 'u-me': { role: 'member', name: 'Me', username: 'me' } } },
    me: { role: 'member', channels: Object.keys(channels), dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
    activity: { c: {}, p: {}, w: 1, u: {} },
  });

  it('is not laid over the fresh bootstrap the return brought', async () => {
    let releaseStale;
    const stale = new Promise((r) => { releaseStale = r; });
    let reads = 0;
    worker({
      '/api/ws/abc123def0': async () => {
        if (++reads === 1) {
          // The refresh that went out first is slow, and answers a document from before the channel was joined.
          await stale;
          return json(boot('abc123def0', 'Globex', { c1: { id: 'c1', name: 'ops' } }));
        }
        return json(boot('abc123def0', 'Globex', { c1: { id: 'c1', name: 'ops' }, c2: { id: 'c2', name: 'design' } }));
      },
      '/api/ws/other00000': () => json(boot('other00000', 'Initech', { g: { id: 'g', name: 'general' } })),
    });
    openPlain();
    const refresh = store.refreshWorkspace();
    await tick();
    await store.openWorkspace(OTHER);
    await store.openWorkspace(REF);
    expect(Object.keys(store.ws.channels)).toEqual(['c1', 'c2']);
    releaseStale();
    await refresh;
    expect(Object.keys(store.ws.channels)).toEqual(['c1', 'c2']);
    expect(store.isJoined('c2')).toBe(true);
  });
});

describe('the outbox when one worker is down and another is not', () => {
  const down = (status, code) => Object.assign(new Error('down'), { status, code });

  it('sends what is bound for the worker that answers, holding back only what is bound for the one that does not, in order', async () => {
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => {
        if (e.ws === 'a@x') throw down(503, 'http_503'); // a's worker is being redeployed
        sent.push(e.text);
      },
      uploadFile: async () => ({ id: 'f' }),
    });
    await box.enqueue({ ws: 'a@x', conv: 'c', text: 'to a, first', ts: 1 });
    await box.enqueue({ ws: 'b@y', conv: 'c', text: 'to b', ts: 2 });
    await box.enqueue({ ws: 'a@x', conv: 'c', text: 'to a, second', ts: 3 });
    await box.enqueue({ ws: 'b@y', conv: 'd', text: 'to b again', ts: 4 });
    expect(await box.flush()).toEqual({ sent: 2, left: 2 });
    expect(sent).toEqual(['to b', 'to b again']);
    const left = await box.list();
    // The first entry for a's worker was tried once; the one behind it waits its turn without being tried out of order.
    expect(left.map((e) => [e.text, e.attempts, !!e.failed])).toEqual([['to a, first', 1, false], ['to a, second', 0, false]]);
  });

  it('sends nothing when it is the device that is offline, trying each server once', async () => {
    // Offline, no server answers (a fake in which the second one did answer
    // modelled not an offline device but a server that hangs, for which the
    // others' entries must go out; see tests/client-lib-pass13.test.js).
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async () => { throw down(0, 'network'); },
      uploadFile: async () => ({ id: 'f' }),
    });
    await box.enqueue({ ws: 'a@x', conv: 'c', text: 'to a', ts: 1 });
    await box.enqueue({ ws: 'b@y', conv: 'c', text: 'to b', ts: 2 });
    await box.enqueue({ ws: 'a@x', conv: 'c', text: 'to a again', ts: 3 });
    expect(await box.flush()).toEqual({ sent: 0, left: 3 });
    expect(sent).toEqual([]);
    expect((await box.list()).map((e) => e.attempts)).toEqual([1, 1, 0]);
  });

  it('holds back a shared channel\'s entries by the host they are bound for', async () => {
    const sent = [];
    const box = createOutbox({
      storage: memoryStorage(),
      sendEntry: async (e) => { if ((e.host || e.ws) === 'h@z') throw down(404, 'no_backend'); sent.push(e.text); },
      uploadFile: async () => ({ id: 'f' }),
    });
    await box.enqueue({ ws: 'a@x', conv: 'e1', host: 'h@z', hconv: 'hch', text: 'to the host', ts: 1 });
    await box.enqueue({ ws: 'a@x', conv: 'c', text: 'to a itself', ts: 2 });
    await box.enqueue({ ws: 'a@x', conv: 'e1', host: 'h@z', hconv: 'hch', text: 'to the host again', ts: 3 });
    expect(await box.flush()).toEqual({ sent: 1, left: 2 });
    expect(sent).toEqual(['to a itself']);
    expect((await box.list()).map((e) => e.attempts)).toEqual([1, 0]);
  });
});

describe('a host whose poll said something changed but could not be re-read', () => {
  const HOST = 'host00host@teamchat-test';
  const hostBoot = (name) => ({
    now: Date.now(),
    workspace: { id: 'host00host', name, channels: { hch: { id: 'hch', name: 'design', count: 3 } }, members: { 'u-me': { role: 'external', name: 'Me', username: 'me' } } },
    me: { role: 'external', channels: ['hch'], dms: {}, reads: {}, mentions: {}, notify: {}, threads: {} },
    activity: { c: {}, p: {} },
  });

  it('is asked again at the next poll rather than shown stale until something else changes there', async () => {
    openPlain();
    store.ws.channels.e1 = { id: 'e1', name: 'design-acme', shared: { ref: HOST, ch: 'hch', conn: 'conn000001', host: 'Acme' } };
    store.me.channels.push('e1');
    const link = {
      ref: HOST, ws: hostBoot('Acme').workspace, me: hostBoot('Acme').me, act: null, since: 0, w: 0, u: 0, convs: new Map([['hch', 'e1']]),
      loaded: true, loading: null, syncing: null, error: null, lost: false, failures: 0, retryAt: 0, lostConvs: new Map(), rejoinAt: {},
    };
    store.links.set(HOST, link);
    let down = true;
    let name = 'Acme';
    const calls = worker({
      '/api/ws/host00host': () => { if (down) throw new TypeError('fetch failed'); return json(hostBoot(name)); },
    });
    const reads = () => calls.filter((c) => c.endsWith('/api/ws/host00host')).length;
    // The host's poll says its document moved (stamp 3); the re-read does not get through.
    await store._applyLinked([{ link, data: { now: 1, c: {}, w: 3 } }]);
    expect(reads()).toBe(1);
    expect(link.ws.name).toBe('Acme');
    // The host is back, renamed meanwhile; its next poll says the same stamp.
    down = false;
    name = 'Acme Inc';
    await store._applyLinked([{ link, data: { now: 2, c: {}, w: 3 } }]);
    expect(reads()).toBe(2);
    expect(link.ws.name).toBe('Acme Inc');
    expect(store.ws.channels.e1.shared.host).toBe('Acme Inc');
  });
});

describe('drafts kept by two tabs at once', () => {
  it('writes its change into what is stored now rather than over it, and shows what the other tab saved when told', async () => {
    const mem = new Map();
    const listeners = {};
    const savedWindow = globalThis.window;
    const savedStorage = globalThis.localStorage;
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    globalThis.window = { dispatchEvent() {}, addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
    try {
      vi.resetModules();
      const drafts = await import('../src/lib/drafts.js');
      drafts.setDraft('ws1:general', { text: 'from this tab' });
      // The other tab saves a draft of its own: it lands in storage.
      const other = JSON.parse(mem.get('teamchat:drafts'));
      other['ws1:random'] = { text: 'from the other tab', attachments: [], ts: 5 };
      mem.set('teamchat:drafts', JSON.stringify(other));
      // This tab's next keystroke, before any word of that, must not write it away.
      drafts.setDraft('ws1:general', { text: 'from this tab, more' });
      expect(Object.keys(JSON.parse(mem.get('teamchat:drafts'))).sort()).toEqual(['ws1:general', 'ws1:random']);
      // And once the browser says storage changed under it, the other tab's draft shows here too.
      for (const fn of listeners.storage || []) fn({ key: 'teamchat:drafts' });
      expect(drafts.hasDraft('ws1:random')).toBe(true);
      expect(drafts.listDrafts('ws1').map((d) => d.conv).sort()).toEqual(['general', 'random']);
    } finally {
      if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
      if (savedStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = savedStorage;
    }
  });
});

describe('a huddle peer who serves anew after a network blip', () => {
  class FakeStream {
    id = 'st1';
    getAudioTracks() { return []; }
    getVideoTracks() { return []; }
    getTracks() { return []; }
    addTrack() {}
    removeTrack() {}
  }
  class FakeConn extends EventTarget {
    peerconnection = { signalingState: 'stable', connectionState: 'new', addEventListener() {}, removeEventListener() {}, addTrack() { return {}; }, removeTrack() {}, close() {} };
    connected = false;
    send() {}
    close() {}
  }
  class FakeServer extends EventTarget {
    constructor(code) { super(); this.inviteCode = code; }
    close() {}
  }
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  it('is dialled at the new code at once, not once the wait the old code earned has run out', async () => {
    globalThis.MediaStream = FakeStream;
    const dials = [];
    const api = {
      async serve() { return new FakeServer('ZED-1'); },
      async connect(invite) {
        dials.push(invite);
        if (invite === 'AMY-OLD') throw Object.assign(new Error('no_host'), { code: 'no_host' });
        return new FakeConn();
      },
    };
    // Zed's id is the greater: the dialling is his to do.
    const zed = new Huddle({ uuid: 'zed', name: 'Zed', isMember: () => true, peer: () => api, media: null });
    try {
      await zed.start();
      // Amy's connection dropped: her server is gone from the signaller, and a dial to it fails.
      zed.syncRoster({ amy: { at: 1, j: 1000, inv: 'AMY-OLD' } });
      await flush();
      expect(dials).toEqual(['AMY-OLD']);
      const amy = zed.peers.get('amy');
      expect(amy.attempts).toBe(1);
      expect(amy.retryAt).toBeGreaterThan(Date.now());
      // She is back and serves anew: the next poll names her new code, under the same seat.
      zed.syncRoster({ amy: { at: 2, j: 1000, inv: 'AMY-NEW' } });
      await flush();
      expect(dials).toEqual(['AMY-OLD', 'AMY-NEW']);
    } finally {
      zed.leave('test');
      delete globalThis.MediaStream;
    }
  });
});

describe('joining a huddle while the last one is still being left', () => {
  const T0 = 1_700_000_000_000;
  class FakeStream {
    id = 'st1';
    getAudioTracks() { return []; }
    getVideoTracks() { return []; }
    getTracks() { return []; }
    addTrack() {}
    removeTrack() {}
  }
  class FakeServer extends EventTarget {
    closed = false;
    constructor(code) { super(); this.inviteCode = code; }
    close() { this.closed = true; }
  }

  it('keeps one huddle live: the one asked for last, with the other released rather than left running unseen', async () => {
    globalThis.MediaStream = FakeStream;
    const servers = [];
    let releaseLeave;
    const leaving = new Promise((r) => { releaseLeave = r; });
    let leaves = 0;
    worker({
      '/huddle': async (q, init) => {
        if (init.method === 'DELETE') {
          if (++leaves === 1) await leaving; // giving up the first seat hangs at the worker
          return json({ ok: true, ended: true });
        }
        const inv = servers[servers.length - 1]?.inviteCode || 'X';
        return json({ huddle: { by: 'u-me', at: T0, m: { 'u-me': { at: T0, j: T0, inv } } }, started: true, now: T0 });
      },
    });
    openPlain();
    globalThis.puter.peer = {
      async serve() { const s = new FakeServer(`TAB-${servers.length + 1}`); servers.push(s); return s; },
      async connect() { throw new Error('nobody to dial'); },
    };
    store.me.dms = { d1: { members: ['u-me', 'u2'] }, d2: { members: ['u-me', 'u2'] }, d3: { members: ['u-me', 'u2'] } };
    try {
      await store.joinHuddle('d1');
      expect(store.huddleInfo.conv).toBe('d1');
      // "Leave and join" d2: the seat in d1 is given up at once, the worker slow to take the word.
      const joinB = store.joinHuddle('d2');
      await tick();
      expect(store.huddle).toBeNull();
      // With no huddle shown, d3's button is live too, and is pressed.
      await store.joinHuddle('d3');
      expect(store.huddleInfo.conv).toBe('d3');
      releaseLeave();
      await joinB;
      await tick(10);
      // The member is in the huddle asked for last, and every peer server but its own has been closed.
      expect(store.huddleInfo.conv).toBe('d3');
      const open = servers.filter((s) => !s.closed);
      expect(open.map((s) => s.inviteCode)).toEqual([store.huddle.inviteCode]);
    } finally {
      await store.leaveHuddle({ tell: false });
      delete globalThis.MediaStream;
    }
  });
});
