/**
 * The rules engine for backgammon: position, dice, whole-turn play
 * generation, the doubling cube, and how a game ends.
 *
 * Two invariants shape this module.
 *
 * **The engine deals in whole turns.** One roll produces one play — a list of
 * two to four checker moves applied, recorded, and undone together. Building
 * a play up one checker at a time is a controller concern; the engine offers
 * `legalMoves(pending)` for that and never holds a half-finished turn itself.
 *
 * **The board is one signed array of 26 slots.** `points[1..24]` are the
 * points, positive counts meaning White and negative meaning Black. The two
 * ends belong to one colour each: `points[25]` is White's bar and
 * `points[0]` is Black's bar, which is exactly where each colour *enters
 * from* — White enters with die d onto 25-d, Black onto 0+d — so entry needs
 * no special arithmetic. Borne-off checkers are counted in `off` rather than
 * stored on the board, because the slot a colour bears off *to* is the slot
 * the other colour's bar already occupies (White bears off "to 0", Black "to
 * 25"). Every destination is therefore tested for bearing off before it is
 * used as an index.
 */

export const WHITE = 'w';
export const BLACK = 'b';

/** Direction of travel: White counts down toward 0, Black up toward 25. */
export const DIR = { w: -1, b: 1 };
/** The slot a colour's hit checkers wait on, and enter from. */
export const BAR = { w: 25, b: 0 };
/** The (virtual) slot a colour bears off to. Never used as a board index. */
export const OFF = { w: 0, b: 25 };
/** Each colour's home board, the six points it bears off from. */
export const HOME = { w: [1, 6], b: [19, 24] };

export const CHECKERS_PER_SIDE = 15;
/** The cube cannot be turned past 64 in ordinary play. */
export const MAX_CUBE = 64;

export const opponent = (color) => (color === WHITE ? BLACK : WHITE);

/** The opening arrangement, seen from White (who travels 24 → 1). */
export function startingPoints() {
  const points = new Array(26).fill(0);
  points[24] = 2;
  points[13] = 5;
  points[8] = 3;
  points[6] = 5;
  points[1] = -2;
  points[12] = -5;
  points[17] = -3;
  points[19] = -5;
  return points;
}

/** Signed count → the colour standing on a point, or null. */
export function ownerAt(points, p) {
  const n = points[p];
  return n === 0 ? null : n > 0 ? WHITE : BLACK;
}

export function inHome(color, p) {
  return p >= HOME[color][0] && p <= HOME[color][1];
}

/** Is `p` the slot `color` bears off to, rather than a point on the board? */
export function isOff(color, p) {
  return color === WHITE ? p <= 0 : p >= 25;
}

/** How far a checker of `color` standing on `p` still has to travel. */
export function pipsFrom(color, p) {
  return color === WHITE ? p : 25 - p;
}

export class Backgammon {
  constructor(state = null) {
    // Whether the cube is in play at all. Deliberately set before reset() and
    // left alone by it: it is a property of the game being played rather than
    // of the position, so starting a new game keeps it.
    this._cubeless = false;
    if (state) this.load(state);
    else this.reset();
  }

  reset() {
    this._points = startingPoints();
    this._off = { w: 0, b: 0 };
    this._turn = null; // nobody is on move until the opening roll decides
    this._roll = null; // the dice showing, [d1, d2]
    this._phase = 'opening';
    this._cube = { value: 1, owner: null }; // owner null = in the middle
    this._pendingDouble = null; // the colour waiting on a take/drop
    this._end = null; // {winner, multiplier, reason} once the game is over
    this._history = [];
    this._maxUsed = 0;
    this._memo = new Map();
  }

  /* ---------------------------------------------------------------- */
  /* Reading the position                                              */
  /* ---------------------------------------------------------------- */

  /** A copy of the 26-slot board. Callers must not mutate the engine's own. */
  points() {
    return this._points.slice();
  }

  /** How many checkers of `color` are waiting on the bar. */
  bar(color) {
    return Math.abs(this._points[BAR[color]]);
  }

  off(color) {
    return this._off[color];
  }

  /** The colour to move, or null before the opening roll. */
  turn() {
    return this._turn;
  }

  /** The dice showing, or null when nothing has been rolled yet. */
  roll() {
    return this._roll ? this._roll.slice() : null;
  }

  /**
   * 'opening' — the opening roll decides who starts
   * 'roll'    — the side to move may roll, or turn the cube
   * 'move'    — dice are showing and a play is owed
   * 'double'  — a double is on the table, awaiting a take or a drop
   * 'over'    — the game is finished
   */
  phase() {
    return this._phase;
  }

  cube() {
    return { ...this._cube };
  }

  /**
   * Is this a game without the cube? Backgammon is perfectly playable without
   * it — a great many people learned it that way — so it is a setting, and
   * this is what every path that could turn it consults.
   */
  cubeless() {
    return this._cubeless;
  }

  /** Take the cube out of the game, or put it back. */
  setCubeless(value) {
    this._cubeless = !!value;
  }

  /** The colour being offered the cube right now, or null. */
  doubledTo() {
    return this._pendingDouble ? opponent(this._pendingDouble) : null;
  }

  history() {
    return this._history.map((entry) => ({ ...entry }));
  }

  lastEntry() {
    return this._history.length ? { ...this._history[this._history.length - 1] } : null;
  }

  /** The last play made, or null — a cube action is not a play. */
  lastPlay() {
    for (let i = this._history.length - 1; i >= 0; i--) {
      if (this._history[i].kind === 'move') return { ...this._history[i] };
    }
    return null;
  }

  /** Total distance `color` still has to travel; the game's running score. */
  pipCount(color) {
    let pips = 0;
    for (let p = 0; p <= 25; p++) {
      const n = this._points[p];
      if (!n) continue;
      const owner = n > 0 ? WHITE : BLACK;
      if (owner !== color) continue;
      pips += Math.abs(n) * pipsFrom(color, p);
    }
    return pips;
  }

  /** Every checker home and none on the bar: the condition for bearing off. */
  canBearOff(color) {
    const [low, high] = HOME[color];
    let counted = this._off[color];
    for (let p = low; p <= high; p++) {
      const n = this._points[p];
      if (n && (n > 0 ? WHITE : BLACK) === color) counted += Math.abs(n);
    }
    return counted === CHECKERS_PER_SIDE;
  }

  isGameOver() {
    return this._phase === 'over';
  }

  /**
   * How the game stands. `multiplier` is 1 for a single game, 2 for a gammon
   * and 3 for a backgammon; `points` folds in the cube, which is what the
   * winner actually scores.
   */
  status() {
    const base = {
      phase: this._phase,
      turn: this._turn,
      cube: this.cube(),
      over: this._phase === 'over',
      winner: null,
      multiplier: 0,
      points: 0,
      reason: null,
    };
    if (!this._end) return base;
    return {
      ...base,
      winner: this._end.winner,
      multiplier: this._end.multiplier,
      points: this._end.multiplier * this._cube.value,
      reason: this._end.reason,
    };
  }

  /**
   * The size of a win for `winner` in the position as it stands: 1 normally,
   * 2 for a gammon (the loser has borne nothing off), 3 for a backgammon (a
   * gammon with a checker still on the bar or in the winner's home board).
   */
  winMultiplier(winner) {
    const loser = opponent(winner);
    if (this._off[loser] > 0) return 1;
    if (this.bar(loser) > 0) return 3;
    const [low, high] = HOME[winner];
    for (let p = low; p <= high; p++) {
      const n = this._points[p];
      if (n && (n > 0 ? WHITE : BLACK) === loser) return 3;
    }
    return 2;
  }

  /* ---------------------------------------------------------------- */
  /* Rolling                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Put a roll on the board.
   *
   * In the opening the two dice belong to the two players — `d1` is White's
   * and `d2` is Black's — and the higher one wins the right to move first,
   * using both dice as the opening play. A tie decides nothing: this returns
   * false and the caller rolls again.
   */
  setRoll(d1, d2) {
    if (this._phase !== 'roll' && this._phase !== 'opening') return false;
    if (!isDie(d1) || !isDie(d2)) return false;
    if (this._phase === 'opening') {
      if (d1 === d2) return false;
      this._turn = d1 > d2 ? WHITE : BLACK;
    }
    this._roll = [d1, d2];
    this._phase = 'move';
    this._memo.clear();
    this._maxUsed = this._computeMaxUsed();
    return true;
  }

  /** The dice as a list of moves owed: doubles are worth four, not two. */
  diceSequence() {
    if (!this._roll) return [];
    const [d1, d2] = this._roll;
    return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
  }

  /** How many dice the side to move is obliged to use this turn. */
  maxUsed() {
    return this._phase === 'move' ? this._maxUsed : 0;
  }

  /* ---------------------------------------------------------------- */
  /* Moves                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * The single checker moves that may legally be played next, given the moves
   * already chosen this turn.
   *
   * "Legally" here carries backgammon's two awkward obligations, which is why
   * this cannot simply be "any move that fits a remaining die":
   *
   *  - **Use as many dice as you can.** A move that fits but strands a die
   *    another order would have played is not legal. Each candidate is
   *    therefore measured by how far the turn can still go after it, and only
   *    the ones that keep the turn at its full length survive.
   *  - **If only one die can be played, play the larger.** Checked only when
   *    the turn is one move long in total, which is the only case where the
   *    rule can bite.
   *
   * @param {{from:number,to:number,die:number}[]} pending moves chosen so far
   * @returns {{from:number,to:number,die:number,hit:boolean}[]}
   */
  legalMoves(pending = []) {
    if (this._phase !== 'move' || !this._turn) return [];
    const state = this._stateAfter(pending);
    if (!state) return [];
    const { points, off, dice } = state;
    const remaining = this._maxUsed - pending.length;
    if (remaining <= 0) return [];

    const color = this._turn;
    const seen = new Set();
    const out = [];
    for (let i = 0; i < dice.length; i++) {
      const die = dice[i];
      if (seen.has(die)) continue;
      seen.add(die);
      const rest = dice.slice(0, i).concat(dice.slice(i + 1));
      for (const move of singleMoves(points, off, color, die)) {
        applyMove(points, off, color, move);
        const reach = 1 + this._maxPlays(points, off, color, rest);
        revertMove(points, off, color, move);
        if (reach === remaining) out.push(move);
      }
    }
    // The larger-die rule only has anything to say when the whole turn is a
    // single move: with both dice playable there is nothing to choose.
    if (pending.length === 0 && this._maxUsed === 1 && this._roll[0] !== this._roll[1]) {
      const larger = Math.max(this._roll[0], this._roll[1]);
      const withLarger = out.filter((m) => m.die === larger);
      if (withLarger.length) return withLarger;
    }
    return out;
  }

  /** Is `pending` a complete turn — every die that could be played, played? */
  isPlayComplete(pending) {
    return this._phase === 'move' && pending.length === this._maxUsed;
  }

  /**
   * The board as it would look partway through a turn. Read-only, and used for
   * drawing alone: the engine's own position does not advance until the whole
   * turn is applied, so a caller building one a checker at a time needs this
   * to see what it is building. An unplayable list simply returns the position
   * as it stands.
   */
  preview(pending) {
    const state = this._stateAfter(pending || []);
    if (!state) return { points: this._points.slice(), off: { ...this._off } };
    return { points: state.points, off: state.off };
  }

  /**
   * Every distinct position the side to move can reach with this roll, one
   * representative play each.
   *
   * Deduplicating by resulting position rather than by move order is what
   * makes this usable by the search: the same four checkers shuffled into the
   * same places in a different order is one choice, not twenty-four. The
   * controller does not use this — a player builds a turn a checker at a time
   * through `legalMoves`, where the order genuinely matters.
   *
   * Each level expands through `legalMoves` rather than re-deriving what is
   * legal from the dice, so the two can never drift apart. They did once:
   * this walked the dice itself, missed the larger-die rule, and handed the
   * computer plays that `play()` then refused as illegal.
   *
   * @returns {{moves: object[], points: number[], off: {w:number,b:number}}[]}
   */
  distinctPlays() {
    if (this._phase !== 'move' || !this._turn) return [];
    const color = this._turn;
    const start = {
      points: this._points.slice(),
      off: { ...this._off },
      dice: this.diceSequence(),
      moves: [],
    };
    let level = new Map([[stateKey(start.points, start.dice), start]]);
    for (let depth = 0; depth < this._maxUsed; depth++) {
      const next = new Map();
      for (const node of level.values()) {
        for (const move of this.legalMoves(node.moves)) {
          const points = node.points.slice();
          const off = { ...node.off };
          applyMove(points, off, color, move);
          const i = node.dice.indexOf(move.die);
          const rest = node.dice.slice(0, i).concat(node.dice.slice(i + 1));
          // Two orders that land the same checkers on the same points with
          // the same dice left are one choice from here on.
          const key = stateKey(points, rest);
          if (next.has(key)) continue;
          next.set(key, { points, off, dice: rest, moves: [...node.moves, move] });
        }
      }
      level = next;
    }
    // A turn with no legal move at all is still a turn — the player passes —
    // and falls out of this as the single zero-move play the loop never left.
    return [...level.values()].map(({ moves, points, off }) => ({ moves, points, off }));
  }

  /**
   * Apply a whole turn. `moves` is validated one move at a time against
   * `legalMoves`, so a play off the wire or out of storage gets exactly the
   * same scrutiny as one built by hand — including the obligation to use
   * every die that could be used.
   *
   * @returns the recorded entry, or null if the play is not legal
   */
  play(moves) {
    if (this._phase !== 'move' || !Array.isArray(moves)) return null;
    const checked = [];
    for (const move of moves) {
      const legal = this.legalMoves(checked).find(
        (m) => m.from === move.from && m.to === move.to && m.die === move.die,
      );
      if (!legal) return null;
      checked.push(legal);
    }
    if (!this.isPlayComplete(checked)) return null;

    const color = this._turn;
    for (const move of checked) applyMove(this._points, this._off, color, move);
    const entry = {
      kind: 'move',
      color,
      roll: this._roll.slice(),
      opening: this._history.length === 0,
      moves: checked.map((m) => ({ ...m })),
    };
    this._history.push(entry);
    if (this._off[color] === CHECKERS_PER_SIDE) {
      this._finish(color, this.winMultiplier(color), 'borne off');
    } else {
      this._turn = opponent(color);
      this._roll = null;
      this._phase = 'roll';
      this._maxUsed = 0;
      this._memo.clear();
    }
    return { ...entry };
  }

  /* ---------------------------------------------------------------- */
  /* The doubling cube                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * May `color` turn the cube? Only at the start of their own turn, before
   * the dice are rolled, and only if they own the cube or it is still in the
   * middle. The opening roll is not a turn anyone owns, so it is excluded.
   */
  canDouble(color) {
    return (
      !this._cubeless &&
      this._phase === 'roll' &&
      this._turn === color &&
      this._cube.value < MAX_CUBE &&
      (this._cube.owner === null || this._cube.owner === color)
    );
  }

  double() {
    // canDouble covers the cubeless case, so a double cannot be smuggled in
    // from a peer, a save, or a stale UI.
    if (!this._turn || !this.canDouble(this._turn)) return null;
    const color = this._turn;
    this._pendingDouble = color;
    this._phase = 'double';
    const entry = { kind: 'double', color, from: this._cube.value, to: this._cube.value * 2 };
    this._history.push(entry);
    return { ...entry };
  }

  /** Accept the cube: it doubles and passes to the taker, who now owns it. */
  take() {
    if (this._phase !== 'double') return null;
    const doubler = this._pendingDouble;
    const taker = opponent(doubler);
    this._cube = { value: this._cube.value * 2, owner: taker };
    this._pendingDouble = null;
    this._phase = 'roll';
    const entry = { kind: 'take', color: taker, value: this._cube.value };
    this._history.push(entry);
    return { ...entry };
  }

  /** Refuse the cube: the game ends at once, at the cube's *old* value. */
  drop() {
    if (this._phase !== 'double') return null;
    const doubler = this._pendingDouble;
    const dropper = opponent(doubler);
    this._pendingDouble = null;
    const entry = { kind: 'drop', color: dropper, value: this._cube.value };
    this._history.push(entry);
    this._finish(doubler, 1, 'dropped');
    return { ...entry };
  }

  /** End the game for a reason the rules cannot see: a resignation. */
  resign(color, multiplier = 1) {
    if (this._phase === 'over') return null;
    const winner = opponent(color);
    const entry = {
      kind: 'resign',
      color,
      multiplier,
      // Enough to put the game back exactly as it stood, since a resignation
      // can arrive in any phase — including with a double still on the table.
      phase: this._phase,
      roll: this._roll ? this._roll.slice() : null,
      turn: this._turn,
      pendingDouble: this._pendingDouble,
    };
    this._history.push(entry);
    this._finish(winner, multiplier, 'resigned');
    return { ...entry };
  }

  _finish(winner, multiplier, reason) {
    this._end = { winner, multiplier, reason };
    this._phase = 'over';
    this._roll = null;
    this._maxUsed = 0;
    this._pendingDouble = null;
    this._memo.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Undo                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * Take back the last history entry.
   *
   * Taking back a play returns the board *and its dice*: the roll is put back
   * on the table exactly as it was. That is what makes undo safe in a game
   * with dice — a player who could undo their way into a fresh roll would be
   * choosing their own numbers, which is the one thing the online protocol
   * goes to some length to prevent.
   */
  undo() {
    const entry = this._history.pop();
    if (!entry) return null;
    this._end = null;
    this._memo.clear();
    switch (entry.kind) {
      case 'move': {
        for (let i = entry.moves.length - 1; i >= 0; i--) {
          revertMove(this._points, this._off, entry.color, entry.moves[i]);
        }
        this._turn = entry.color;
        this._roll = entry.roll.slice();
        this._phase = 'move';
        this._maxUsed = this._computeMaxUsed();
        break;
      }
      case 'double': {
        this._pendingDouble = null;
        this._turn = entry.color;
        this._roll = null;
        this._phase = 'roll';
        break;
      }
      case 'take': {
        this._cube = { value: entry.value / 2, owner: this._cubeOwnerBefore() };
        this._pendingDouble = opponent(entry.color);
        this._turn = this._pendingDouble;
        this._phase = 'double';
        break;
      }
      case 'drop': {
        this._pendingDouble = opponent(entry.color);
        this._turn = this._pendingDouble;
        this._phase = 'double';
        break;
      }
      case 'resign': {
        this._phase = entry.phase;
        this._roll = entry.roll ? entry.roll.slice() : null;
        this._turn = entry.turn;
        this._pendingDouble = entry.pendingDouble ?? null;
        this._maxUsed = this._phase === 'move' ? this._computeMaxUsed() : 0;
        break;
      }
      default:
        break;
    }
    return { ...entry };
  }

  /** Who owned the cube before the take now being undone. */
  _cubeOwnerBefore() {
    for (let i = this._history.length - 1; i >= 0; i--) {
      const entry = this._history[i];
      if (entry.kind === 'take') return entry.color;
    }
    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Position keys, saving and loading                                 */
  /* ---------------------------------------------------------------- */

  /** A compact key for the position, used to spot transpositions. */
  positionKey() {
    return `${this._turn || '-'}|${this._points.join(',')}|${this._off.w},${this._off.b}`;
  }

  /** Everything needed to rebuild this game object, as plain data. */
  snapshot() {
    return {
      points: this._points.slice(),
      off: { ...this._off },
      turn: this._turn,
      roll: this._roll ? this._roll.slice() : null,
      phase: this._phase,
      cube: { ...this._cube },
      cubeless: this._cubeless,
      pendingDouble: this._pendingDouble,
      end: this._end ? { ...this._end } : null,
    };
  }

  /**
   * Rebuild from a snapshot. Used by tests and by the search to start from a
   * position rather than from the opening; history is not carried, so the
   * result can be played forward but not undone past its starting point.
   */
  load(state) {
    this._points = state.points.slice();
    this._off = { ...state.off };
    this._turn = state.turn ?? null;
    this._roll = state.roll ? state.roll.slice() : null;
    this._phase = state.phase || (this._roll ? 'move' : 'roll');
    this._cube = state.cube ? { ...state.cube } : { value: 1, owner: null };
    this._cubeless = !!state.cubeless;
    this._pendingDouble = state.pendingDouble ?? null;
    this._end = state.end ? { ...state.end } : null;
    this._history = [];
    this._memo = new Map();
    this._maxUsed = this._phase === 'move' ? this._computeMaxUsed() : 0;
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  /** The board and dice left after `pending`, or null if it does not apply. */
  _stateAfter(pending) {
    const points = this._points.slice();
    const off = { ...this._off };
    const dice = this.diceSequence();
    for (const move of pending) {
      const i = dice.indexOf(move.die);
      if (i === -1) return null;
      dice.splice(i, 1);
      applyMove(points, off, this._turn, move);
    }
    return { points, off, dice };
  }

  _computeMaxUsed() {
    if (!this._turn || !this._roll) return 0;
    return this._maxPlays(
      this._points.slice(),
      { ...this._off },
      this._turn,
      this.diceSequence(),
    );
  }

  /**
   * How many of `dice` can be played from this position, at most.
   *
   * The search stops as soon as it finds a line that uses every die, which is
   * the overwhelmingly common case and the reason this is cheap. That cutoff
   * is deliberately `dice.length` and never a caller-supplied bound: the
   * memo below is keyed on the position and the dice alone, so a value
   * shortened by a tighter cap would be handed back later as if it were the
   * real answer.
   *
   * `points`/`off` are mutated in place and restored before returning.
   */
  _maxPlays(points, off, color, dice) {
    const cap = dice.length;
    if (cap === 0) return 0;
    const key = `${color}|${points.join(',')}|${off[color]}|${dice.join('')}`;
    const cached = this._memo.get(key);
    if (cached !== undefined) return cached;
    let best = 0;
    const seen = new Set();
    for (let i = 0; i < dice.length && best < cap; i++) {
      const die = dice[i];
      if (seen.has(die)) continue;
      seen.add(die);
      const rest = dice.slice(0, i).concat(dice.slice(i + 1));
      for (const move of singleMoves(points, off, color, die)) {
        applyMove(points, off, color, move);
        const score = 1 + this._maxPlays(points, off, color, rest);
        revertMove(points, off, color, move);
        if (score > best) best = score;
        if (best >= cap) break;
      }
    }
    this._memo.set(key, best);
    return best;
  }
}

/* ------------------------------------------------------------------ */
/* Position-level helpers, shared with the search                      */
/* ------------------------------------------------------------------ */

const isDie = (d) => Number.isInteger(d) && d >= 1 && d <= 6;

function stateKey(points, dice) {
  return `${points.join(',')}|${dice.slice().sort().join('')}`;
}

/**
 * Every move of one checker `color` can make with one die, ignoring what the
 * rest of the turn then looks like — the obligation to use both dice is
 * applied a level up, in `legalMoves`/`distinctPlays`.
 *
 * The order of the three cases is the rule: a checker on the bar must come
 * in before anything else moves, and bearing off is only offered once the
 * whole side is home.
 */
export function singleMoves(points, off, color, die) {
  const dir = DIR[color];
  const bar = BAR[color];
  const out = [];

  if (Math.abs(points[bar]) > 0) {
    const to = bar + dir * die;
    if (canLand(points, color, to)) {
      out.push({ from: bar, to, die, hit: isBlot(points, color, to) });
    }
    return out;
  }

  const bearing = canBearOffFrom(points, off, color);
  const [low, high] = HOME[color];
  // Farthest-from-home first, so a play list reads the way a player would
  // describe it and the search sees the "big" move before the shuffle.
  const from = color === WHITE ? 24 : 1;
  const step = color === WHITE ? -1 : 1;
  for (let p = from; p >= 1 && p <= 24; p += step) {
    const n = points[p];
    if (!n || (n > 0 ? WHITE : BLACK) !== color) continue;
    const to = p + dir * die;
    if (isOff(color, to)) {
      if (!bearing) continue;
      // An exact roll always bears off. A larger one may only be spent when
      // nothing is left further from home to use it on.
      const distance = pipsFrom(color, p);
      if (die > distance && hasCheckerBehind(points, color, p, low, high)) continue;
      out.push({ from: p, to: OFF[color], die, hit: false });
      continue;
    }
    if (canLand(points, color, to)) {
      out.push({ from: p, to, die, hit: isBlot(points, color, to) });
    }
  }
  return out;
}

/** A point is open unless the opponent holds it with two or more checkers. */
function canLand(points, color, to) {
  if (to < 1 || to > 24) return false;
  const n = points[to];
  if (n === 0) return true;
  const owner = n > 0 ? WHITE : BLACK;
  return owner === color || Math.abs(n) === 1;
}

function isBlot(points, color, to) {
  const n = points[to];
  return n !== 0 && (n > 0 ? WHITE : BLACK) !== color && Math.abs(n) === 1;
}

/** Every checker home and none on the bar. */
export function canBearOffFrom(points, off, color) {
  const [low, high] = HOME[color];
  let counted = off[color];
  for (let p = low; p <= high; p++) {
    const n = points[p];
    if (n && (n > 0 ? WHITE : BLACK) === color) counted += Math.abs(n);
  }
  return counted === CHECKERS_PER_SIDE;
}

/** Is there a checker of `color` further from home than `p`, inside home? */
function hasCheckerBehind(points, color, p, low, high) {
  if (color === WHITE) {
    for (let q = p + 1; q <= high; q++) {
      const n = points[q];
      if (n > 0) return true;
    }
    return false;
  }
  for (let q = p - 1; q >= low; q--) {
    const n = points[q];
    if (n < 0) return true;
  }
  return false;
}

/**
 * Apply one checker move in place. A hit is not looked up here: the move
 * carries its own `hit` flag from the generator, and `revertMove` reads the
 * same flag, so the two stay symmetrical without a captured-piece stack.
 */
export function applyMove(points, off, color, move) {
  const sign = color === WHITE ? 1 : -1;
  points[move.from] -= sign;
  if (isOff(color, move.to)) {
    off[color] += 1;
    return;
  }
  if (move.hit) {
    points[move.to] = 0;
    points[BAR[opponent(color)]] -= sign;
  }
  points[move.to] += sign;
}

/** Put a single checker move back. */
export function revertMove(points, off, color, move) {
  const sign = color === WHITE ? 1 : -1;
  if (isOff(color, move.to)) {
    off[color] -= 1;
  } else {
    points[move.to] -= sign;
    if (move.hit) {
      points[move.to] = -sign;
      points[BAR[opponent(color)]] += sign;
    }
  }
  points[move.from] += sign;
}

/** The 21 distinct dice rolls, each with its probability out of 36. */
export const ROLLS = (() => {
  const out = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      out.push({ dice: [a, b], weight: a === b ? 1 : 2 });
    }
  }
  return out;
})();
