import { describe/**
 * What this device changed against a document that predates the change:
 * the store keeps a read's cleared badge, a notification setting, the
 * Activity badge and a mark-unread over a bootstrap or a host refetch built
 * before the write landed, on this workspace and on a shared channel's host
 * alike. Drives the store in node with a fake puter.workers.exec whose
 * answers can be held back.
 */
, it, expect, beforeEach, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';

const REF = 'abc123def0@teamchat-test';
const HOST = 'hhhhhhhhhh@host-test';
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let meFromServer;
let hostMe;
let gate = null; // when set, the local bootstrap answer waits on it
let readGate = null; // when set, a forward read (not back) waits on it
const calls = [];

beforeEach(() => {
  gate = null;
  readGate = null;
  calls.length = 0;
  globalThis.puter = {
    workers: {
      exec: async (url, init = {}) => {
        const u = new URL(url);
        const path = u.pathname;
        calls.push(`${init.method || 'GET'} ${u.host}${path}${init.body ? ' ' + init.body : ''}`);
        if (u.host === 'teamchat-test.puter.work' && path === '/api/ws/abc123def0') {
          if (gate) await gate;
          return json({
            workspace: store.ws,
            me: meFromServer,
            activity: { c: { general: { s: 5, t: 1 } }, w: 1, u: {} },
            now: Date.now(),
          });
        }
        if (u.host === 'host-test.puter.work' && path === '/api/ws/hhhhhhhhhh') {
          return json({
            workspace: { id: 'hhhhhhhhhh', name: 'Host', channels: { hch: { id: 'hch', name: 'hch', count: 2 } }, members: { alice: { username: 'alice', name: 'Alice', color: 1, role: 'external' }, bob: { username: 'bob', name: 'Bob', color: 2, role: 'owner' } } },
            me: hostMe,
            activity: { c: { hch: { s: 5, t: 1 } }, w: 1, u: {} },
            now: Date.now(),
          });
        }
        if (path.endsWith('/read')) {
          const body = init.body ? JSON.parse(init.body) : {};
          if (!body.back && readGate) await readGate;
          return json({ ok: true });
        }
        if (path.endsWith('/inbox/read') || path.endsWith('/notify')) return json({ ok: true });
        return json({ code: 'not_found', message: 'nope' }, 404);
      },
    },
  };
  store.wsId = REF;
  store.profile = { uuid: 'alice', username: 'alice', name: 'Alice', color: 1, prefs: {} };
  store.identity = { uuid: 'alice', username: 'alice' };
  store.ws = {
    id: 'abc123def0', name: 'Test',
    channels: {
      general: { id: 'general', name: 'general' },
      sh1: { id: 'sh1', name: 'sh', shared: { ref: HOST, ch: 'hch', conn: 'c1', host: 'Host' } },
    },
    members: { alice: { username: 'alice', name: 'Alice', color: 1, role: 'owner' } },
  };
  store.me = { dms: {}, channels: ['general', 'sh1'], notify: {}, reads: { general: 5 }, mentions: {}, threads: {}, inbox: 0, role: 'owner' };
  store.act = { c: { general: { s: 5, t: 1 } }, p: {}, w: 0, u: 0 };
  store.huddles = {};
  store.links = new Map();
  store.convs.clear();
  store._localSeen.clear();
  store._seenAt.clear();
  store._notifyPending.clear();
  store._inboxRead.clear();
  store._unreadAt.clear();
});

afterEach(() => {
  for (const t of store._readTimers.values()) clearTimeout(t);
  store._readTimers.clear();
});

describe('shared channel: a host document refetched while a read is in flight', () => {
  it('local channel (control): refreshWorkspace keeps the badge cleared', async () => {
    store.me.mentions = { general: 1 };
    meFromServer = { dms: {}, channels: ['general', 'sh1'], notify: {}, reads: { general: 5 }, mentions: { general: 1 }, threads: {} };
    store._localSeen.set('general', 5);
    store.markRead('general', 5);
    await store.refreshWorkspace();
    expect(store.mentionCount('general')).toBe(0);
  });

  it('shared channel: _refreshLink brings the badge back', async () => {
    hostMe = { role: 'external', channels: ['hch'], dms: {}, reads: { hch: 4 }, mentions: { hch: 1 }, notify: {}, threads: {} };
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    expect(link.loaded).toBe(true);
    expect(store.mentionCount('sh1')).toBe(1);
    // The list reaches the end: the badge clears, the read is debounced.
    store._localSeen.set('sh1', 5);
    store.markRead('sh1', 5);
    expect(store.mentionCount('sh1')).toBe(0);
    expect(link.me.mentions.hch).toBe(0);
    // A host refetch (its u stamp moved for some other reason) whose answer predates the read.
    await store._refreshLink(link);
    expect(store.mentionCount('sh1')).toBe(0);
  });

  it('shared channel: a mute set while _refreshLink is in flight is undone', async () => {
    hostMe = { role: 'external', channels: ['hch'], dms: {}, reads: { hch: 5 }, mentions: {}, notify: {}, threads: {} };
    store._syncLinks();
    const link = store.links.get(HOST);
    await link.loading;
    const refresh = store._refreshLink(link);
    await store.setNotify('sh1', { mute: true });
    expect(store.isMuted('sh1')).toBe(true);
    await refresh;
    expect(store.isMuted('sh1')).toBe(true);
  });
});

describe('optimistic writes that bump no stamp against a refresh in flight', () => {
  it('readInbox: the badge comes back', async () => {
    store.me.inbox = 3;
    meFromServer = { dms: {}, channels: ['general', 'sh1'], notify: {}, reads: { general: 5 }, mentions: {}, threads: {}, inbox: 3 };
    let release;
    gate = new Promise((r) => { release = r; });
    const refresh = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 5));
    await store.readInbox();
    expect(store.inboxUnread()).toBe(0);
    release();
    await refresh;
    expect(store.inboxUnread()).toBe(0);
  });

  it('markUnread: the row reads as read again', async () => {
    meFromServer = { dms: {}, channels: ['general', 'sh1'], notify: {}, reads: { general: 5 }, mentions: {}, threads: {} };
    let release;
    gate = new Promise((r) => { release = r; });
    const refresh = store.refreshWorkspace();
    await new Promise((r) => setTimeout(r, 5));
    await store.markUnread('general', 3);
    expect(store.unreadCount('general')).toBe(3);
    release();
    await refresh;
    expect(store.unreadCount('general')).toBe(3);
  });

  it('markUnread while the debounced markRead is in flight: the read response undoes it', async () => {
    store.me.reads.general = 0;
    store._localSeen.set('general', 0);
    let release;
    readGate = new Promise((r) => { release = r; });
    store.markRead('general', 5);
    await new Promise((r) => setTimeout(r, 650)); // the timer fired; the request waits on the gate
    await store.markUnread('general', 3);
    expect(store.unreadCount('general')).toBe(3);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.unreadCount('general')).toBe(3);
  });
});
