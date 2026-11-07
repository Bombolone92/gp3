import { describe, it, expect, afterEach } from 'vitest';
import { OnlineSession } from '../src/net/online.js';

/**
 * The protocol layer, driven without a network. host()/join() are what need
 * the Puter SDK; everything after the connection exists is message handling,
 * so these tests hand a session a fake connection and talk to it directly.
 */
function fakeConn() {
  const listeners = new Map();
  return {
    sent: [],
    closedWith: undefined,
    addEventListener(type, fn) {
      listeners.set(type, [...(listeners.get(type) || []), fn]);
    },
    send(data) {
      this.sent.push(JSON.parse(data));
    },
    close(reason) {
      this.closedWith = reason;
    },
    emit(type, event) {
      for (const fn of listeners.get(type) || []) fn(event);
    },
    deliver(msg) {
      this.emit('message', { data: JSON.stringify(msg) });
    },
  };
}

function harness({ role, myColor = 'w', timeId = null, myName = 'Me' }) {
  const calls = [];
  const record = (name) => (arg) => calls.push([name, arg]);
  const session = new OnlineSession({
    onStart: record('start'),
    onMove: record('move'),
    onFlag: record('flag'),
    onResign: record('resign'),
    onRematchOffer: record('rematch'),
    onRematchAccept: record('rematch-yes'),
    onRematchDecline: record('rematch-no'),
    onClose: record('close'),
    onError: record('error'),
  });
  session.role = role;
  session.myColor = role === 'host' ? myColor : null;
  session.timeId = timeId;
  session._myName = myName;
  const conn = fakeConn();
  session._adopt(conn);
  open.push(session);
  return { session, conn, calls };
}

const open = [];
afterEach(() => {
  // Every _adopt arms an open timeout; leave() clears it.
  while (open.length) open.pop().leave();
});

describe('the handshake', () => {
  it('a host offers its color and its time control', () => {
    const { conn } = harness({ role: 'host', myColor: 'w', timeId: '3+2' });
    conn.emit('open');
    expect(conn.sent).toEqual([
      { t: 'start', v: 2, color: 'b', name: 'Me', time: '3+2' },
    ]);
  });

  it('a host completes on "joined" and reports its own time control', () => {
    const { session, conn, calls } = harness({ role: 'host', myColor: 'b', timeId: '5+0' });
    conn.emit('open');
    conn.deliver({ t: 'joined', name: 'Bob' });
    expect(session.connected).toBe(true);
    expect(calls).toEqual([
      ['start', { myColor: 'b', opponentName: 'Bob', role: 'host', timeId: '5+0' }],
    ]);
  });

  it('a guest takes the color and the clock it is dealt', () => {
    const { session, conn, calls } = harness({ role: 'guest', myName: 'Bob' });
    conn.deliver({ t: 'start', v: 2, color: 'b', name: 'Alice', time: '10+0' });
    expect(session.myColor).toBe('b');
    expect(session.timeId).toBe('10+0');
    expect(conn.sent).toEqual([{ t: 'joined', name: 'Bob' }]);
    expect(calls).toEqual([
      ['start', { myColor: 'b', opponentName: 'Alice', role: 'guest', timeId: '10+0' }],
    ]);
  });

  it('turns away a peer on the version before clocks existed', () => {
    // A version-1 peer would play the same moves with no clock and disagree
    // about the result, so the mismatch has to end the session.
    const { conn, calls } = harness({ role: 'guest' });
    conn.deliver({ t: 'start', v: 1, color: 'w', name: 'Alice' });
    expect(conn.sent).toEqual([{ t: 'bye' }]);
    expect(calls[0][0]).toBe('close');
    expect(calls[0][1].reason).toMatch(/different version/);
  });

  it('reads a missing or unusable time control as none at all', () => {
    for (const time of [undefined, null, 42, '', '   ', 'x'.repeat(17)]) {
      const { session, conn } = harness({ role: 'guest' });
      conn.deliver({ t: 'start', v: 2, color: 'w', name: 'A', time });
      expect(session.timeId).toBe(null);
    }
  });

  it('trims a usable id but keeps it opaque', () => {
    // This module relays the host's choice without knowing what it means.
    const { session, conn } = harness({ role: 'guest' });
    conn.deliver({ t: 'start', v: 2, color: 'w', name: 'A', time: ' 15+10 ' });
    expect(session.timeId).toBe('15+10');
  });
});

describe('moves and clocks', () => {
  const playing = () => {
    const h = harness({ role: 'host', myColor: 'w', timeId: '3+2' });
    h.conn.emit('open');
    h.conn.deliver({ t: 'joined', name: 'Bob' });
    h.conn.sent.length = 0;
    h.calls.length = 0;
    return h;
  };

  it('passes on the mover’s own clock reading', () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'move', from: 'e7', to: 'e5', clock: 178500 });
    expect(calls).toEqual([
      ['move', { from: 'e7', to: 'e5', promotion: null, clock: 178500 }],
    ]);
  });

  it('drops a clock reading that could not be one', () => {
    const { conn, calls } = playing();
    for (const clock of [undefined, null, 'lots', -1, NaN, Infinity, {}]) {
      conn.deliver({ t: 'move', from: 'e7', to: 'e5', clock });
    }
    expect(calls.map(([, m]) => m.clock)).toEqual([null, null, null, null, null, null, null]);
  });

  it('sends our own remaining time with a move', () => {
    const { session, conn } = playing();
    session.sendMove({ from: 'e2', to: 'e4', promotion: null }, 176000);
    session.sendMove({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(conn.sent).toEqual([
      { t: 'move', from: 'e2', to: 'e4', promotion: null, clock: 176000 },
      { t: 'move', from: 'a7', to: 'a8', promotion: 'q', clock: null },
    ]);
  });

  it('accepts a flag fall for either color', () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'flag', color: 'w' });
    conn.deliver({ t: 'flag', color: 'b' });
    expect(calls).toEqual([['flag', 'w'], ['flag', 'b']]);
  });

  it('ignores a flag fall that names no real color', () => {
    const { conn, calls } = playing();
    for (const color of ['x', undefined, null, 1, 'white']) {
      conn.deliver({ t: 'flag', color });
    }
    expect(calls).toEqual([]);
  });

  it('sends a flag fall', () => {
    const { session, conn } = playing();
    session.sendFlag('b');
    expect(conn.sent).toEqual([{ t: 'flag', color: 'b' }]);
  });

  it('ignores game messages before the handshake', () => {
    const { conn, calls } = harness({ role: 'host', myColor: 'w' });
    conn.deliver({ t: 'move', from: 'e7', to: 'e5', clock: 1000 });
    conn.deliver({ t: 'flag', color: 'w' });
    conn.deliver({ t: 'resign' });
    expect(calls).toEqual([]);
  });

  it('ignores malformed and unknown traffic', () => {
    const { conn, calls } = playing();
    conn.emit('message', { data: 'not json' });
    conn.emit('message', { data: '"a string"' });
    conn.emit('message', { data: JSON.stringify({ t: 'from-the-future' }) });
    conn.emit('message', { data: 42 });
    expect(calls).toEqual([]);
  });
});
