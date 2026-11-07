/**
 * The store's side of a huddle: the seat it takes on the worker and what it
 * makes of the rosters the polls bring while the Huddle object carries the
 * media. Puter is faked at `puter.workers.exec` and `puter.peer`; the media
 * devices are absent, as in a browser that refused the microphone, which
 * the huddle takes as listen-only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { store } from '../src/lib/store.js';

const REF = 'abc123def0@teamchat-test';
const CONV = 'd1';
const T0 = 1_700_000_000_000;

let streamN = 0;
class FakeStream {
  constructor() {
    this.id = `st${++streamN}`;
  }
  getAudioTracks() { return []; }
  getVideoTracks() { return []; }
  getTracks() { return []; }
  addTrack() {}
  removeTrack() {}
}
globalThis.MediaStream = FakeStream;

class FakeConn extends EventTarget {
  peerconnection = { signalingState: 'stable', addEventListener() {}, removeEventListener() {}, addTrack() { return {}; }, removeTrack() {}, close() {} };
  connected = false;
  send() {}
  close() {}
}
class FakeServer extends EventTarget {
  constructor(code) {
    super();
    this.inviteCode = code;
  }
  close() {}
}

/** The roster as the worker would list it: alice's seat under `inv`, heard from at `at`, bob beside her. */
const roster = (inv, at) => ({ by: 'alice', at: T0, m: { alice: { at, j: T0, inv }, bob: { at: T0, j: T0, inv: 'BOB-1' } } });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

let calls;
let answer; // (method, path, body) -> Response, for the worker
let notices;

beforeEach(() => {
  calls = [];
  notices = [];
  globalThis.puter = {
    peer: {
      async serve() { return new FakeServer('TAB-B'); },
      async connect() { return new FakeConn(); },
    },
    workers: {
      exec: async (url, init = {}) => {
        const path = new URL(url).pathname + new URL(url).search;
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ method: init.method, path, body });
        return answer(init.method, path, body);
      },
    },
  };
  store.wsId = REF;
  store.profile = { uuid: 'alice', username: 'alice', name: 'Alice', color: 1 };
  store.ws = { id: 'abc123def0', name: 'Test', channels: {}, members: { alice: { username: 'alice', name: 'Alice', color: 1, role: 'owner' }, bob: { username: 'bob', name: 'Bob', color: 2, role: 'member' } } };
  store.me = { dms: { [CONV]: { members: ['alice', 'bob'] } }, channels: [], notify: {}, reads: {} };
  store.act = { c: {}, p: {}, ps: {}, w: 0, u: 0 };
  store.huddles = {};
  store.on('notice', (m) => notices.push(m));
});

afterEach(async () => {
  await store.leaveHuddle({ tell: false });
  store.stopPolling();
  store.huddles = {};
});

/** A poll's answer, as _applySync sees it. */
const poll = (h) => store._applySync({ now: T0, h });

describe('the seat and the rosters that name it', () => {
  it('moves the seat here from another tab without taking a roster that still lists that tab as news of a takeover', async () => {
    // Alice is in the huddle from tab A; this tab joins ("Join here").
    store.huddles = { [CONV]: roster('TAB-A', T0) };
    let resolvePost;
    answer = (method, path) => {
      if (method === 'POST' && path.endsWith('/huddle')) return new Promise((r) => { resolvePost = (data) => r(json(data)); });
      if (method === 'DELETE') return json({ ok: true, ended: false });
      throw new Error(`unexpected ${method} ${path}`);
    };
    const joining = store.joinHuddle(CONV);
    // The join is on its way (the server is up, the seat not yet taken).
    for (let i = 0; i < 50 && !calls.some((c) => c.method === 'POST'); i++) await new Promise((r) => setTimeout(r, 2));
    expect(calls.filter((c) => c.method === 'POST').length).toBe(1);
    expect(calls[calls.length - 1].body).toMatchObject({ invite: 'TAB-B', join: true });
    expect(store.huddle).not.toBeNull();

    // A poll answers meanwhile with the roster as it was: alice under tab A.
    // That is where the seat was, not where it is going.
    await poll({ [CONV]: roster('TAB-A', T0) });
    expect(store.huddle).not.toBeNull();
    expect(notices).toEqual([]);

    // The join lands: the seat is this tab's, heard from now.
    resolvePost({ huddle: roster('TAB-B', T0 + 500), started: false, now: T0 + 500 });
    await joining;
    expect(store.huddle).not.toBeNull();
    expect(store.inHuddle(CONV)).toBe(true);

    // A poll that read the roster before the join landed answers after it: stale, not a takeover.
    await poll({ [CONV]: roster('TAB-A', T0 + 200) });
    expect(store.huddle).not.toBeNull();
    expect(notices).toEqual([]);

    // A third tab takes the seat later: that is a takeover, and this tab leaves without giving the seat up.
    await poll({ [CONV]: roster('TAB-C', T0 + 9000) });
    expect(store.huddle).toBeNull();
    expect(notices).toEqual(['You joined this huddle from another tab, so this one left it']);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    // And the seat, the other tab's, still shows in this tab's view of the huddle.
    expect(store.huddleMembers(CONV)).toContain('alice');
  });
});

describe('leaving while a heartbeat is on its way', () => {
  it('lets the beat land before giving the seat up, so the worker cannot re-seat a tab that left', async () => {
    let pending = null;
    let posts = 0;
    answer = (method, path) => {
      if (method === 'POST' && path.endsWith('/huddle')) {
        posts += 1;
        if (posts === 1) return json({ huddle: roster('TAB-B', T0), started: true, now: T0 });
        return new Promise((r) => { pending = (data) => r(json(data)); });
      }
      if (method === 'DELETE') return json({ ok: true, ended: true });
      throw new Error(`unexpected ${method} ${path}`);
    };
    await store.joinHuddle(CONV);
    expect(store.huddle).not.toBeNull();
    // A heartbeat goes out and hangs at the worker.
    store._beatHuddle();
    for (let i = 0; i < 50 && !pending; i++) await new Promise((r) => setTimeout(r, 2));
    expect(pending).not.toBeNull();
    // Leave: this tab is out at once, but the DELETE waits for the beat.
    const leaving = store.leaveHuddle();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.huddle).toBeNull();
    expect(store.inHuddle(CONV)).toBe(false);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    pending({ huddle: roster('TAB-B', T0 + 15000), started: false, now: T0 + 15000 });
    await leaving;
    const methods = calls.map((c) => c.method);
    expect(methods.filter((m) => m === 'DELETE')).toHaveLength(1);
    expect(methods.lastIndexOf('POST')).toBeLessThan(methods.lastIndexOf('DELETE'));
  });
});

describe('who may connect to a private channel\'s huddle', () => {
  it('is its member list, read at each connection, not the whole workspace', async () => {
    store.ws.channels = { c1: { id: 'c1', name: 'c1', private: true, members: ['alice', 'bob'] } };
    store.ws.members.carol = { username: 'carol', name: 'Carol', color: 3, role: 'member' };
    store.me.channels = ['c1'];
    store.me.dms = {};
    let server = null;
    globalThis.puter.peer.serve = async () => { server = new FakeServer('TAB-B'); return server; };
    answer = (method, path) => {
      if (method === 'POST' && path.endsWith('/huddle')) return json({ huddle: { by: 'alice', at: T0, m: { alice: { at: T0, j: T0, inv: 'TAB-B' } } }, started: true, now: T0 });
      if (method === 'DELETE') return json({ ok: true, ended: true });
      throw new Error(`unexpected ${method} ${path}`);
    };
    await store.joinHuddle('c1');
    expect(server).not.toBeNull();
    const knock = (uuid) => {
      const conn = new FakeConn();
      let closed = false;
      conn.close = () => { closed = true; };
      server.dispatchEvent(Object.assign(new Event('connection'), { conn, user: { uuid } }));
      return closed;
    };
    expect(knock('carol')).toBe(true); // in the workspace, not in the channel
    expect(knock('bob')).toBe(false); // listed
    store.ws.channels.c1.members = ['alice']; // bob removed mid-call
    expect(knock('bob')).toBe(true);
  });
});
