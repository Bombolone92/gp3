import { Backgammon } from '../src/engine/backgammon.js';

/**
 * Build a game from a sketch of a position.
 *
 * Points are given per colour as `{ point: checkers }`, with 25 meaning
 * White's bar and 0 meaning Black's bar — the same slots the engine uses.
 * Checkers not placed and not listed in `off` are simply absent, which is
 * what most rules tests want; `strict` re-checks the fifteen-a-side count for
 * the ones that care (bearing off in particular is only legal with a full
 * complement accounted for).
 */
export function position({ white = {}, black = {}, off = {}, turn = 'w', roll = null } = {}) {
  const points = new Array(26).fill(0);
  for (const [p, n] of Object.entries(white)) points[Number(p)] += n;
  for (const [p, n] of Object.entries(black)) points[Number(p)] -= n;
  const game = new Backgammon({
    points,
    off: { w: off.w || 0, b: off.b || 0 },
    turn,
    roll: null,
    phase: 'roll',
    cube: { value: 1, owner: null },
  });
  if (roll) game.setRoll(roll[0], roll[1]);
  return game;
}

/** Play notation for a move list, so assertions read like a game score. */
export function describeMoves(moves) {
  return moves
    .map((m) => `${m.from === 25 || m.from === 0 ? 'bar' : m.from}/${
      m.to === 0 || m.to === 25 ? 'off' : m.to
    }${m.hit ? '*' : ''}`)
    .join(' ');
}

/** The set of plays as notation strings, for order-insensitive assertions. */
export function playSet(game) {
  return new Set(game.distinctPlays().map((p) => describeMoves(p.moves)));
}
