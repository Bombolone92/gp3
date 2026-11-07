/**
 * The client side of a huddle: the Huddle class over a fake Puter Peer API,
 * with the links it dials and accepts driven by hand. What is covered here
 * is who keeps a link when the same account shows up on a second connection
 * (a seat that moved to another tab, or two sides dialling at once), and
 * what a goodbye means once the roster lists that account under another
 * server. Media is out of scope: the fake peer connection carries no tracks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Huddle, DIAL_TIMEOUT_MS, parseMessage } from '../src/lib/huddle.js';

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

const fakePc = () => ({
  signalingState: 'stable', connectionState: 'new',
  addEventListener() {}, removeEventListener() {}, removeTrack() {}, close() {},
  addTrack() { return { replaceTrack: () => Promise.resolve(), getParameters: () => ({}), setParameters: () => Promise.resolve() }; },
});

class FakeConn extends EventTarget {
  constructor({ owner = null } = {}) {
    super();
    this.peerconnection = fakePc();
    this.owner = owner;
    this.connected = false;
    this.closed = false;
    this.closeReason = null;
    this.sent = [];
  }
  send(frame) {
    if (!this.connected) throw new Error('not open');
    this.sent.push(JSON.parse(frame));
  }
  close(reason) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    this.closeReason = reason;
    this.dispatchEvent(Object.assign(new Event('close'), { reason }));
  }
  /** The far side answered: the link is up. */
  open() {
    this.connected = true;
    this.dispatchEvent(new Event('open'));
  }
  /** A frame from the far side. */
  receive(msg) {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify({ v: 1, ...msg }) }));
  }
}

class FakeServer extends EventTarget {
  constructor(code) {
    super();
    this.inviteCode = code;
    this.closed = false;
  }
  close() { this.closed = true; }
  /** Someone dialled this server: the signaller hands the connection over, naming them. */
  accept(conn, user) {
    this.dispatchEvent(Object.assign(new Event('connection'), { conn, user }));
  }
}

function fakePeer(code) {
  const api = {
    server: null,
    dials: [],
    async serve() {
      api.server = new FakeServer(code);
      return api.server;
    },
    async connect(invite) {
      const conn = new FakeConn();
      api.dials.push({ invite, conn });
      return conn;
    },
  };
  return api;
}

/** Let the dials the roster set off reach their connections (a microtask or two). */
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** Bob, served and with the roster showing alice under `inv`; bob dials her (his id is the greater). */
async function bobWithLinkTo(inv) {
  const api = fakePeer('BOB-1');
  const bob = new Huddle({ uuid: 'bob', name: 'Bob', isMember: () => true, peer: () => api, media: null });
  await bob.start();
  bob.syncRoster({ alice: { at: Date.now(), j: 1000, inv } });
  await flush();
  expect(api.dials.map((d) => d.invite)).toEqual([inv]);
  const conn = api.dials[0].conn;
  conn.owner = { uuid: 'alice' };
  conn.open();
  conn.receive({ t: 'hello', uuid: 'alice', name: 'Alice', inv });
  const alice = bob.peers.get('alice');
  expect(alice.open).toBe(true);
  expect(alice.conn).toBe(conn);
  expect(alice.inbound).toBe(false);
  expect(alice.linkInv).toBe(inv);
  return { api, bob, conn, alice };
}

describe('huddle links (client)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('says which server it serves in its hello, and reads it from the other side\'s', async () => {
    const { conn } = await bobWithLinkTo('A1');
    expect(conn.sent[0]).toMatchObject({ t: 'hello', uuid: 'bob', inv: 'BOB-1' });
    expect(parseMessage(JSON.stringify({ v: 1, t: 'hello', uuid: 'a', inv: 'X-1' })).inv).toBe('X-1');
    expect(parseMessage(JSON.stringify({ v: 1, t: 'hello', uuid: 'a' })).inv).toBeNull();
    expect(parseMessage(JSON.stringify({ v: 1, t: 'hello', uuid: 'a', inv: 'x'.repeat(65) })).inv).toBeNull();
  });

  it('keeps the newer connection when the same account connects from another server, and ignores the old link after that', async () => {
    const { api, bob, conn: old, alice } = await bobWithLinkTo('A1');
    // Alice's seat moved to a second tab, which dials bob before his roster says so.
    const fresh = new FakeConn();
    api.server.accept(fresh, { uuid: 'alice' });
    fresh.open();
    // Not bound yet: which server this is from is what the hello says.
    expect(alice.conn).toBe(old);
    expect(fresh.closed).toBe(false);
    fresh.receive({ t: 'hello', uuid: 'alice', name: 'Alice', inv: 'A2' });
    expect(alice.conn).toBe(fresh);
    expect(alice.open).toBe(true);
    expect(alice.inbound).toBe(true);
    expect(alice.linkInv).toBe('A2');
    expect(old.closed).toBe(true);
    expect(old.closeReason).toBe('peer re-served');
    // The first tab's goodbye, and its close, come in on the link that was replaced: not alice's any more.
    old.receive({ t: 'bye' });
    expect(alice.gone).toBe(false);
    expect(alice.conn).toBe(fresh);
    expect(fresh.closed).toBe(false);
    expect(bob.visiblePeers().map((p) => p.uuid)).toEqual(['alice']);
    // The roster catching up changes nothing: the link up is to the server it lists.
    bob.syncRoster({ alice: { at: Date.now(), j: 1000, inv: 'A2' } });
    expect(alice.conn).toBe(fresh);
    expect(api.dials.length).toBe(1);
  });

  it('settles two sides dialling the same servers at once by id, as before', async () => {
    const { api, conn: mine, alice } = await bobWithLinkTo('A1');
    const theirs = new FakeConn();
    api.server.accept(theirs, { uuid: 'alice' });
    theirs.open();
    theirs.receive({ t: 'hello', uuid: 'alice', name: 'Alice', inv: 'A1' });
    // Bob's id is the greater: the connection he dialled stays.
    expect(theirs.closed).toBe(true);
    expect(theirs.closeReason).toBe('duplicate');
    expect(alice.conn).toBe(mine);
    expect(mine.closed).toBe(false);
  });

  it('dials again someone whose goodbye came from a server other than the one the roster lists', async () => {
    const { api, bob, conn, alice } = await bobWithLinkTo('A1');
    conn.receive({ t: 'bye' });
    expect(alice.gone).toBe(true);
    expect(alice.goneInv).toBe('A1');
    expect(bob.visiblePeers()).toEqual([]);
    // Still listed under the server that said goodbye (their leave has not landed): nothing to dial.
    bob.syncRoster({ alice: { at: Date.now(), j: 1000, inv: 'A1' } });
    expect(api.dials.length).toBe(1);
    expect(alice.gone).toBe(true);
    // Listed under another server, with the same join time: their seat moved; they are back.
    bob.syncRoster({ alice: { at: Date.now(), j: 1000, inv: 'A2' } });
    await flush();
    expect(alice.gone).toBe(false);
    expect(api.dials.map((d) => d.invite)).toEqual(['A1', 'A2']);
    expect(bob.visiblePeers().map((p) => p.uuid)).toEqual(['alice']);
  });

  it('serves again with a growing wait when the signaller lets go, and says so once per outage', async () => {
    const { api, bob } = await bobWithLinkTo('A1');
    const errors = [];
    const invites = [];
    bob.on('error', (e) => errors.push(e));
    bob.on('invite', (e) => invites.push(e.inviteCode));
    let serves = 0;
    const served = api.server;
    api.serve = async () => { serves++; throw new Error('Could not reach the signaller'); };
    served.dispatchEvent(new Event('close'));
    // A minute without the signaller: tries at 3, 9, 21, and 45 s; one word about it, not one per try.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(serves).toBe(4);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'server' });
    // Back: the next try lands, the code is announced, and the wait starts short again.
    api.serve = async () => { serves++; return new FakeServer('BOB-2'); };
    await vi.advanceTimersByTimeAsync(30_000);
    expect(serves).toBe(5);
    expect(invites).toEqual(['BOB-2']);
    expect(bob.inviteCode).toBe('BOB-2');
    expect(errors).toHaveLength(1);
  });

  it('gives up an inbound connection that opens and never says who it is', async () => {
    const { api, alice, conn } = await bobWithLinkTo('A1');
    const mute = new FakeConn();
    api.server.accept(mute, { uuid: 'alice' });
    mute.open();
    vi.advanceTimersByTime(DIAL_TIMEOUT_MS + 1);
    expect(mute.closed).toBe(true);
    expect(mute.closeReason).toBe('timeout');
    expect(alice.conn).toBe(conn);
  });
});
