import { describe, it, expect, afterEach } from 'vitest';
import { OnlineSession } from '../src/net/online.js';
import { hashNonce, randomNonce } from '../src/engine/dice.js';

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
    /** The last message of a given type, which is what most assertions want. */
    last(type) {
      return [...this.sent].reverse().find((m) => m.t === type);
    },
  };
}

function harness({ role, myColor = 'w', timeId = null, myName = 'Me', cubeless = true }) {
  const calls = [];
  const record = (name) => (arg) => calls.push([name, arg]);
  const session = new OnlineSession({
    onStart: record('start'),
    onDice: record('dice'),
    onPlay: record('play'),
    onDouble: record('double'),
    onTake: record('take'),
    onDrop: record('drop'),
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
  session.cubeless = cubeless;
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

/** A connected host, with the handshake traffic cleared away. */
function playing(options = {}) {
  const h = harness({ role: 'host', myColor: 'w', timeId: '3+2', ...options });
  h.conn.emit('open');
  h.conn.deliver({ t: 'joined', name: 'Bob' });
  h.conn.sent.length = 0;
  h.calls.length = 0;
  return h;
}

/** Let the promise chain inside the roll handlers settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the handshake', () => {
  it('a host offers its colour, its clock and its cube', () => {
    const { conn } = harness({ role: 'host', myColor: 'w', timeId: '3+2', cubeless: false });
    conn.emit('open');
    expect(conn.sent).toEqual([
      { t: 'start', v: 2, color: 'b', name: 'Me', time: '3+2', cube: true },
    ]);
  });

  it('a host playing without the cube says so', () => {
    const { conn } = harness({ role: 'host', myColor: 'w', timeId: '3+2', cubeless: true });
    conn.emit('open');
    expect(conn.sent[0].cube).toBe(false);
  });

  it('a host completes on "joined" and reports its own time control', () => {
    const { session, conn, calls } = harness({ role: 'host', myColor: 'b', timeId: '5+0' });
    conn.emit('open');
    conn.deliver({ t: 'joined', name: 'Bob' });
    expect(session.connected).toBe(true);
    expect(calls).toEqual([
      ['start', { myColor: 'b', opponentName: 'Bob', role: 'host', timeId: '5+0', cubeless: true }],
    ]);
  });

  it('a guest takes the colour, the clock and the cube it is dealt', () => {
    const { session, conn, calls } = harness({ role: 'guest', myName: 'Bob' });
    conn.deliver({ t: 'start', v: 2, color: 'b', name: 'Alice', time: '10+0', cube: true });
    expect(session.myColor).toBe('b');
    expect(session.timeId).toBe('10+0');
    expect(session.cubeless).toBe(false);
    expect(conn.sent).toEqual([{ t: 'joined', name: 'Bob' }]);
    expect(calls).toEqual([
      [
        'start',
        { myColor: 'b', opponentName: 'Alice', role: 'guest', timeId: '10+0', cubeless: false },
      ],
    ]);
  });

  it('gives a guest the cubeless game unless the host explicitly said otherwise', () => {
    // The more restrictive game is the safe default: a guest that assumed a
    // cube its host is not playing would offer a double the host must refuse.
    for (const cube of [undefined, null, false, 'yes', 1]) {
      const { session, conn } = harness({ role: 'guest' });
      conn.deliver({ t: 'start', v: 2, color: 'w', name: 'A', time: '5+0', cube });
      expect(session.cubeless).toBe(true);
    }
  });

  it('turns away a peer on a different protocol version', () => {
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
});

describe('rolling the dice between two peers', () => {
  /**
   * Two sessions wired to each other, so a whole commit-reveal round can run
   * end to end. This is the only way to test the protocol honestly: the
   * property being checked — that neither side can pick the numbers — is a
   * property of the exchange, not of either half of it.
   */
  function pair() {
    const a = playing({ myName: 'Alice' });
    const b = harness({ role: 'guest', myName: 'Bob' });
    b.conn.deliver({ t: 'start', v: 2, color: 'b', name: 'Alice', time: '3+2', cube: true });
    b.conn.sent.length = 0;
    b.calls.length = 0;
    // Each side's outgoing messages become the other's incoming ones.
    const relay = (from, to) => {
      const seen = new Set();
      return async () => {
        for (let pass = 0; pass < 6; pass++) {
          for (const msg of [...from.conn.sent]) {
            if (seen.has(msg)) continue;
            seen.add(msg);
            to.conn.deliver(msg);
          }
          await settle();
        }
      };
    };
    return { a, b, aToB: relay(a, b), bToA: relay(b, a) };
  }

  it('settles on the same two dice for both players', async () => {
    const { a, b, aToB, bToA } = pair();
    await a.session.startRoll();
    // commit -> entropy -> reveal, chased back and forth until both settle.
    for (let i = 0; i < 4; i++) {
      await aToB();
      await bToA();
    }
    const diceA = a.calls.filter(([n]) => n === 'dice').map(([, d]) => d);
    const diceB = b.calls.filter(([n]) => n === 'dice').map(([, d]) => d);
    expect(diceA).toHaveLength(1);
    expect(diceB).toEqual(diceA);
    expect(diceA[0].every((d) => d >= 1 && d <= 6)).toBe(true);
  });

  it('tells each side whether it was the one that opened the round', async () => {
    // The dice are the same for both, but who threw them is not: the game
    // uses this to refuse a round the wrong side opened on this side's turn.
    const { a, b, aToB, bToA } = pair();
    const opened = {};
    a.session.handlers.onDice = (dice, rolledHere) => (opened.a = rolledHere);
    b.session.handlers.onDice = (dice, rolledHere) => (opened.b = rolledHere);
    await a.session.startRoll();
    for (let i = 0; i < 4; i++) {
      await aToB();
      await bToA();
    }
    expect(opened).toEqual({ a: true, b: false });
  });

  it('gives a different answer every round', async () => {
    const seen = new Set();
    for (let round = 0; round < 12; round++) {
      const { a, b, aToB, bToA } = pair();
      await a.session.startRoll();
      for (let i = 0; i < 4; i++) {
        await aToB();
        await bToA();
      }
      seen.add(a.calls.find(([n]) => n === 'dice')[1].join(''));
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('a peer that will not play fairly', () => {
  it('ends the game when the reveal does not match the commitment', async () => {
    const { conn, calls } = playing();
    const hash = await hashNonce(randomNonce()); // committed to one secret…
    conn.deliver({ t: 'commit', h: hash, i: 0 });
    await settle();
    conn.deliver({ t: 'reveal', n: randomNonce(), i: 0 }); // …revealed another
    await settle();
    expect(calls.some(([n, m]) => n === 'error' && /changed the dice/.test(m))).toBe(true);
    expect(calls.some(([n]) => n === 'close')).toBe(true);
    expect(calls.some(([n]) => n === 'dice')).toBe(false);
  });

  it('refuses a roll that repeats a round already settled', async () => {
    const { session, conn, calls } = playing();
    session._rounds = 3;
    conn.deliver({ t: 'commit', h: await hashNonce(randomNonce()), i: 2 });
    await settle();
    expect(calls.some(([n, m]) => n === 'error' && /out-of-order/.test(m))).toBe(true);
  });

  it('refuses a second roll while one is already in flight', async () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'commit', h: await hashNonce(randomNonce()), i: 0 });
    await settle();
    conn.deliver({ t: 'commit', h: await hashNonce(randomNonce()), i: 0 });
    await settle();
    expect(calls.some(([n, m]) => n === 'error' && /out of turn/.test(m))).toBe(true);
  });

  it('refuses a commitment that is not a hash', async () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'commit', h: 'nope', i: 0 });
    await settle();
    expect(calls.some(([n, m]) => n === 'error' && /malformed/.test(m))).toBe(true);
  });

  it('ignores a reveal nobody asked for', async () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'reveal', n: randomNonce(), i: 0 });
    await settle();
    expect(calls).toEqual([]);
  });
});

describe('turns, the cube and the clock', () => {
  it('sends a whole turn as one message', () => {
    const { session, conn } = playing();
    session.sendPlay(
      [
        { from: 8, to: 5, die: 3, hit: false },
        { from: 6, to: 5, die: 1, hit: true },
      ],
      42000,
    );
    // The hit flag stays at home: the receiver's own engine works it out.
    expect(conn.sent).toEqual([
      { t: 'play', m: [[8, 5, 3], [6, 5, 1]], clock: 42000 },
    ]);
  });

  it('passes on the whole turn and the mover’s own clock reading', () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'play', m: [[8, 5, 3], [6, 5, 1]], clock: 178500 });
    expect(calls).toEqual([
      [
        'play',
        {
          moves: [
            { from: 8, to: 5, die: 3 },
            { from: 6, to: 5, die: 1 },
          ],
          clock: 178500,
        },
      ],
    ]);
  });

  it('accepts a turn with no legal play in it', () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'play', m: [], clock: null });
    expect(calls).toEqual([['play', { moves: [], clock: null }]]);
  });

  it('rejects a malformed turn from a peer, loudly', () => {
    const { conn, calls } = playing();
    const turns = [
      [[8, 26, 3]], // off the board
      [[8, 5, 0]], // not a die
      [[8, 5, 7]], // not a die
      [[8, 5]], // not a move
      [[8.5, 5, 3]], // not an integer
      'nope', // not an array
      [[1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3]], // five moves
    ];
    for (const m of turns) conn.deliver({ t: 'play', m, clock: 1000 });
    expect(calls).toEqual(
      turns.map(() => ['error', 'Received an invalid move from your opponent.']),
    );
  });

  it('drops a clock reading that could not be one', () => {
    const { conn, calls } = playing();
    for (const clock of [undefined, null, 'lots', -1, NaN, Infinity, {}]) {
      conn.deliver({ t: 'play', m: [[8, 5, 3]], clock });
    }
    expect(calls.map(([, m]) => m.clock)).toEqual([null, null, null, null, null, null, null]);
  });

  it('carries the cube in both directions', () => {
    const { session, conn, calls } = playing();
    session.sendDouble();
    session.sendTake();
    session.sendDrop();
    expect(conn.sent).toEqual([{ t: 'double' }, { t: 'take' }, { t: 'drop' }]);
    conn.deliver({ t: 'double' });
    conn.deliver({ t: 'take' });
    conn.deliver({ t: 'drop' });
    expect(calls.map(([n]) => n)).toEqual(['double', 'take', 'drop']);
  });

  it('accepts a flag fall for either colour and ignores anything else', () => {
    const { conn, calls } = playing();
    conn.deliver({ t: 'flag', color: 'w' });
    conn.deliver({ t: 'flag', color: 'b' });
    for (const color of ['x', undefined, null, 1, 'white']) {
      conn.deliver({ t: 'flag', color });
    }
    expect(calls).toEqual([['flag', 'w'], ['flag', 'b']]);
  });

  it('ignores game messages before the handshake', () => {
    const { conn, calls } = harness({ role: 'host', myColor: 'w' });
    conn.deliver({ t: 'play', m: [[8, 5, 3]], clock: 1000 });
    conn.deliver({ t: 'double' });
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

  it('clears a roll in flight when the colours swap for a rematch', async () => {
    const { session } = playing();
    await session.startRoll();
    expect(session.rolling).toBe(true);
    session.swapColors();
    expect(session.myColor).toBe('b');
    expect(session.rolling).toBe(false);
  });
});
