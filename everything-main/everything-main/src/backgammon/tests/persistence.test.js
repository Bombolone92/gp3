import { describe, it, expect } from 'vitest';
import { Backgammon } from '../src/engine/backgammon.js';
import { findBestPlay } from '../src/engine/ai.js';
import { rollDice } from '../src/engine/dice.js';
import {
  eventsFrom,
  parseSavedGame,
  replaySavedGame,
} from '../src/game/persistence.js';

const move = (from, to, die) => ({ from, to, die, hit: false });

/** A short game with a cube action in the middle of it. */
function sampleGame() {
  const game = new Backgammon();
  game.setRoll(3, 1);
  game.play([move(8, 5, 3), move(6, 5, 1)]);
  game.double(); // Black turns the cube before rolling
  game.take();
  game.setRoll(6, 2);
  game.play([move(12, 18, 6), move(18, 20, 2)]);
  return game;
}

function saveOf(game, extra = {}) {
  return {
    v: 2,
    mode: 'computer',
    myColor: 'w',
    time: 'unlimited',
    cubeless: game.cubeless(),
    events: eventsFrom(game.history()),
    roll: game.roll(),
    clock: null,
    clockStack: [],
    ...extra,
  };
}

describe('what gets written down', () => {
  it('records each turn as its dice and its moves', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    game.play([move(8, 5, 3), move(6, 5, 1)]);
    expect(eventsFrom(game.history())).toEqual([
      { k: 'm', r: [3, 1], m: [[8, 5, 3], [6, 5, 1]] },
    ]);
  });

  it('records the cube actions alongside them', () => {
    expect(eventsFrom(sampleGame().history()).map((e) => e.k)).toEqual(['m', 'd', 't', 'm']);
  });
});

describe('replaying a save', () => {
  it('rebuilds the position, the history and the cube', () => {
    const game = sampleGame();
    const saved = parseSavedGame(saveOf(game));
    expect(saved).not.toBe(null);
    const replayed = replaySavedGame(saved);
    expect(replayed.points()).toEqual(game.points());
    expect(replayed.turn()).toBe(game.turn());
    expect(replayed.cube()).toEqual({ value: 2, owner: 'w' });
    expect(replayed.history()).toHaveLength(4);
  });

  it('puts the dice back on the table', () => {
    const game = new Backgammon();
    game.setRoll(5, 3);
    const replayed = replaySavedGame(parseSavedGame(saveOf(game)));
    expect(replayed.phase()).toBe('move');
    expect(replayed.roll()).toEqual([5, 3]);
    expect(replayed.turn()).toBe('w');
  });

  it('keeps a save that is nothing but an opening roll', () => {
    const game = new Backgammon();
    game.setRoll(6, 4);
    const saved = parseSavedGame(saveOf(game));
    expect(saved.events).toEqual([]);
    expect(saved.roll).toEqual([6, 4]);
    expect(replaySavedGame(saved).roll()).toEqual([6, 4]);
  });

  it('keeps a double waiting for its answer', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    game.play([move(8, 5, 3), move(6, 5, 1)]);
    game.double();
    const replayed = replaySavedGame(parseSavedGame(saveOf(game)));
    expect(replayed.phase()).toBe('double');
    expect(replayed.doubledTo()).toBe('w');
  });

  it('refuses a save whose moves are not legal', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    const save = saveOf(game, {
      events: [{ k: 'm', r: [3, 1], m: [[8, 4, 3], [6, 5, 1]] }],
      roll: null,
    });
    const saved = parseSavedGame(save);
    expect(saved).not.toBe(null); // the shape is fine
    expect(replaySavedGame(saved)).toBe(null); // the moves are not
  });

  it('replays a game recorded without the cube, and keeps it out', () => {
    const game = new Backgammon();
    game.setCubeless(true);
    game.setRoll(3, 1);
    game.play([move(8, 5, 3), move(6, 5, 1)]);
    const replayed = replaySavedGame(parseSavedGame(saveOf(game)));
    expect(replayed.cubeless()).toBe(true);
    expect(replayed.canDouble('b')).toBe(false);
  });

  it('refuses a cubeless save that somebody added a double to', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    game.play([move(8, 5, 3), move(6, 5, 1)]);
    game.double(); // legal in this game — but not in the one the save claims
    const save = saveOf(game, { cubeless: true });
    expect(replaySavedGame(parseSavedGame(save))).toBe(null);
  });

  it('refuses a save whose dice were edited under a played turn', () => {
    const game = sampleGame();
    const save = saveOf(game);
    save.events[0].r = [6, 6];
    expect(replaySavedGame(parseSavedGame(save))).toBe(null);
  });

  // A whole game, played out and written down. It doubles as an end-to-end
  // check that every turn a real game produces survives the round trip.
  it('replays a full game move for move, then refuses it because it ended', () => {
    const rng = seeded(20260813);
    const game = new Backgammon();
    while (!game.setRoll(...rollDice(rng)));
    let guard = 0;
    while (!game.isGameOver() && guard++ < 500) {
      if (game.phase() === 'roll') {
        game.setRoll(...rollDice(rng));
        continue;
      }
      expect(game.play(findBestPlay(game, 'medium', rng))).not.toBe(null);
    }
    expect(game.isGameOver()).toBe(true);

    const events = eventsFrom(game.history());
    const upToLast = parseSavedGame(saveOf(game, { events: events.slice(0, -1), roll: null }));
    const replayed = replaySavedGame(upToLast);
    expect(replayed).not.toBe(null);
    expect(replayed.history()).toHaveLength(events.length - 1);

    const whole = parseSavedGame(saveOf(game, { events, roll: null }));
    expect(replaySavedGame(whole)).toBe(null);
  });
});

describe('validating a save before trusting it', () => {
  const base = {
    v: 2,
    mode: 'computer',
    myColor: 'w',
    time: 'unlimited',
    cubeless: false,
    events: [{ k: 'm', r: [3, 1], m: [[8, 5, 3], [6, 5, 1]] }],
    roll: null,
    clock: null,
    clockStack: [],
  };

  it('accepts a well-formed one', () => {
    expect(parseSavedGame(base)).not.toBe(null);
  });

  it('rejects another format version', () => {
    expect(parseSavedGame({ ...base, v: 1 })).toBe(null);
    expect(parseSavedGame({ ...base, v: 3 })).toBe(null);
  });

  it('insists on knowing whether the cube was in play', () => {
    const { cubeless, ...without } = base;
    expect(parseSavedGame(without)).toBe(null);
    expect(parseSavedGame({ ...base, cubeless: 'no' })).toBe(null);
  });

  it('rejects an online game, which cannot be resumed anyway', () => {
    expect(parseSavedGame({ ...base, mode: 'online' })).toBe(null);
  });

  it('rejects dice that are not dice', () => {
    expect(parseSavedGame({ ...base, events: [{ k: 'm', r: [0, 1], m: [] }] })).toBe(null);
    expect(parseSavedGame({ ...base, events: [{ k: 'm', r: [7, 1], m: [] }] })).toBe(null);
    expect(parseSavedGame({ ...base, roll: [3] })).toBe(null);
  });

  it('rejects slots that are not on the board', () => {
    expect(parseSavedGame({ ...base, events: [{ k: 'm', r: [3, 1], m: [[8, 26, 3]] }] })).toBe(
      null,
    );
    expect(parseSavedGame({ ...base, events: [{ k: 'm', r: [3, 1], m: [[-1, 5, 3]] }] })).toBe(
      null,
    );
  });

  it('rejects a turn of more than four moves', () => {
    const m = [[8, 5, 3], [8, 5, 3], [8, 5, 3], [8, 5, 3], [8, 5, 3]];
    expect(parseSavedGame({ ...base, events: [{ k: 'm', r: [3, 3], m }] })).toBe(null);
  });

  it('rejects an empty save with nothing on the table', () => {
    expect(parseSavedGame({ ...base, events: [], roll: null })).toBe(null);
  });

  it('rejects junk', () => {
    expect(parseSavedGame(null)).toBe(null);
    expect(parseSavedGame('nope')).toBe(null);
    expect(parseSavedGame({ ...base, events: 'nope' })).toBe(null);
    expect(parseSavedGame({ ...base, myColor: 'x' })).toBe(null);
  });

  it('drops a clock stack that does not line up, and keeps the rest', () => {
    const saved = parseSavedGame({ ...base, clockStack: [[1000, 2000], [3000, 4000]] });
    expect(saved.clockStack).toEqual([]);
    expect(saved.events).toHaveLength(1);
  });

  it('keeps a clock stack that does line up', () => {
    const saved = parseSavedGame({ ...base, clockStack: [[1000, 2000]] });
    expect(saved.clockStack).toEqual([{ w: 1000, b: 2000 }]);
  });
});

/** A repeatable generator, so the whole-game test plays the same game twice. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
