/**
 * The three boards the store screenshots are taken on.
 *
 * They are not hand-placed positions and they are not screenshots of a game
 * somebody happened to be playing: each one is a real game, played out through
 * the real engine by the real computer opponent against itself, off a seeded
 * generator so the same board comes back every time this runs. A store asset
 * that shows an impossible position is the kind of thing a backgammon player
 * notices immediately.
 *
 * What comes out is the exact shape `saveGame` writes to localStorage, so the
 * capture seeds a save and the app restores it as an ordinary game in progress.
 */
import { Backgammon } from '../../src/engine/backgammon.js';
import { findBestPlay } from '../../src/engine/ai.js';
import { eventsFrom } from '../../src/game/persistence.js';

/** Small, fast, and stable across runs, which Math.random is not. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const throwDice = (rng) => [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];

/**
 * Play `turns` complete turns with both sides searching.
 *
 * `stopBeforeRoll` leaves the game in the "roll" phase with nothing on the
 * table, which is the only moment the cube may be turned.
 */
function playGame(seed, turns, { stopBeforeRoll = false, level = 'medium' } = {}) {
  const rng = mulberry32(seed);
  const game = new Backgammon();
  game.setCubeless(true);
  for (;;) {
    const [a, b] = throwDice(rng);
    if (a !== b && game.setRoll(a, b)) break; // a tie decides nothing
  }
  for (let i = 0; i < turns && !game.isGameOver(); i++) {
    game.play(findBestPlay(game, level, rng) || []);
    if (game.isGameOver() || (stopBeforeRoll && i === turns - 1)) break;
    const [a, b] = throwDice(rng);
    game.setRoll(a, b);
  }
  return game;
}

/** How many points a colour has made, as a proxy for a developed position. */
function pointsMade(points, color) {
  let n = 0;
  for (let i = 1; i <= 24; i++) {
    if (color === 'w' ? points[i] >= 2 : points[i] <= -2) n++;
  }
  return n;
}

/** Search seeds and lengths for the best-scoring board a filter accepts. */
function search({ seeds, lengths, options, accept, score }) {
  let best = null;
  for (let seed = 1; seed < seeds; seed++) {
    for (const turns of lengths) {
      const game = playGame(seed, turns, options);
      if (game.isGameOver() || !accept(game)) continue;
      const value = score(game);
      if (!best || value > best.value) best = { value, game };
    }
  }
  if (!best) throw new Error('no position matched');
  return best.game;
}

function save(game, fields) {
  const roll = game.roll();
  return {
    v: 2,
    ...fields,
    events: eventsFrom(game.history()),
    roll: roll ? [roll[0], roll[1]] : null,
    clock: fields.clock ?? null,
    clockStack: [],
  };
}

export function positions() {
  /* A game against the computer, well under way: both sides developed, the
     race close, nothing borne off yet, and a plain roll on the table. */
  const midGame = search({
    seeds: 90,
    lengths: [14, 16, 18, 20],
    accept: (g) => {
      if (g.turn() !== 'w' || g.phase() !== 'move') return false;
      if (g.off('w') || g.off('b')) return false;
      const [d1, d2] = g.roll();
      if (d1 === d2) return false; // a plain roll reads clearer than doubles
      const p = g.points();
      if (pointsMade(p, 'w') < 5 || pointsMade(p, 'b') < 5) return false;
      return Math.abs(g.pipCount('w') - g.pipCount('b')) <= 14;
    },
    score: (g) => {
      const p = g.points();
      return Math.min(pointsMade(p, 'w'), pointsMade(p, 'b')) * 10 -
        Math.abs(g.pipCount('w') - g.pipCount('b'));
    },
  });

  /* A cube position: White at the start of a turn, far enough ahead that
     turning the cube is the natural thing to be doing. */
  const cube = search({
    seeds: 220,
    lengths: [12, 14, 16, 18, 20],
    options: { stopBeforeRoll: true },
    accept: (g) => {
      if (g.turn() !== 'w' || g.phase() !== 'roll') return false;
      if (g.off('w') || g.off('b')) return false;
      const lead = g.pipCount('b') - g.pipCount('w');
      if (lead < 6 || lead > 26) return false;
      const p = g.points();
      return pointsMade(p, 'w') >= 5 && pointsMade(p, 'b') >= 4;
    },
    score: (g) => g.pipCount('b') - g.pipCount('w') + pointsMade(g.points(), 'w') * 4,
  });

  /* A long game worth reviewing: a deep move list, checkers coming off, and a
     board that still has something on it. */
  const late = search({
    seeds: 220,
    lengths: [30, 33, 36, 39],
    accept: (g) => {
      if (g.phase() !== 'move') return false;
      if (g.off('w') < 2 || g.off('w') > 9 || g.off('b') > 6) return false;
      const p = g.points();
      let occupied = 0;
      for (let i = 1; i <= 24; i++) if (p[i]) occupied++;
      return occupied >= 8;
    },
    score: (g) => g.history().length,
  });

  return {
    // Both clocks a few minutes into a 5 + 3 game.
    midGame: save(midGame, {
      mode: 'computer',
      myColor: 'w',
      time: '5+3',
      cubeless: true,
      clock: [231400, 198900],
    }),
    cube: save(cube, { mode: 'local', myColor: 'w', time: 'unlimited', cubeless: false }),
    late: save(late, { mode: 'local', myColor: 'w', time: 'unlimited', cubeless: true }),
  };
}
