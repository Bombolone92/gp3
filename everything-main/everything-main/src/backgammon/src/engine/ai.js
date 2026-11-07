/**
 * The computer opponent: expectimax over the dice, on a hand-written
 * positional evaluation.
 *
 * Backgammon needs a different shape of search from chess or checkers. There
 * is no deep line to calculate — the dice cut every line off after one ply —
 * so depth buys almost nothing and *breadth over the dice* buys everything.
 * One ply here means "score every position I can reach with this roll"; two
 * plies means "and then average, over all 21 rolls the opponent might throw,
 * how well they answer" — the expectation, not the worst case, because the
 * opponent does not choose their dice.
 *
 * Everything below scores in **pips**: one unit is one pip of the race. That
 * keeps the weights readable — a blot worth "3" costs about as much as being
 * three pips behind — and it is what lets the cube decisions turn an
 * evaluation into a rough win probability without a second set of units.
 */

import {
  BAR,
  Backgammon,
  CHECKERS_PER_SIDE,
  HOME,
  ROLLS,
  opponent,
  pipsFrom,
} from './backgammon.js';

/**
 * How many of the 36 rolls can move a single checker exactly `d` pips,
 * counting combinations and doubles. Blocking is ignored, which overstates
 * the danger behind a wall and understates nothing — the right way round for
 * a term whose job is to make the computer wary of leaving blots.
 */
export const SHOTS = [
  0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1,
];

/**
 * Weights, in pips. These are judgement rather than measurement: the numbers
 * were chosen so the computer makes the plays a club player would recognise
 * (the 5-point over the 4-point, an anchor over a spare, a prime over a
 * stack) and then adjusted until it stopped doing anything embarrassing.
 */
const W = {
  /** Each checker borne off, on top of the pips it stops costing. */
  off: 3,
  /** Owning a point, before the by-point table below scales it. */
  point: 1,
  /** Consecutive owned points, squared — a prime is worth far more than its parts. */
  prime: 1.4,
  /** An anchor in the opponent's home board, while checkers are still back there. */
  anchor: 6,
  /** Per checker beyond three on one point: buried men do no work. */
  stack: 1.6,
  /** A checker on the bar, over and above its 25 pips. */
  bar: 4,
  /** Being on the roll is worth something in itself. */
  tempo: 2,
  /** How much of the opponent's blot exposure counts for us; they move next. */
  theirBlots: 0.6,
};

/**
 * What a made point is worth, indexed by its distance from the owner's own
 * end of the board — so 5 is always the golden point and 7 the bar point,
 * whichever colour is asking. The far end (19-24) is where anchors live.
 */
const POINT_VALUE = [
  0, 1.5, 2.5, 4, 5, 6, 4.5, 5, 3, 2, 1.5, 1, 1, 1, 1, 1, 1, 1.5, 2, 2.5, 3, 3, 2.5, 2, 1.5,
];

/**
 * The three levels, and what they actually play like.
 *
 * Measured over 200 games a side (this machine): expert takes about 60% of
 * games from intermediate and about 85% from beginner, at roughly 10ms a move
 * worst case. Widening the expert shortlist past ten bought nothing but time —
 * the second ply refines an ordering the evaluation has already mostly got
 * right, so most of the strength here is in `evaluate`, not in the search.
 */
export const LEVELS = {
  easy: { plies: 1, window: 14, label: 'Easy' },
  medium: { plies: 1, window: 3, label: 'Medium' },
  hard: { plies: 2, candidates: 10, window: 0, label: 'Hard' },
};

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

/** The point `color` counts as its own number `n` (1 = its own one-point). */
const own = (color, p) => (color === 'w' ? p : 25 - p);

function pips(points, color) {
  let total = 0;
  for (let p = 0; p <= 25; p++) {
    const n = points[p];
    if (!n) continue;
    if ((n > 0 ? 'w' : 'b') !== color) continue;
    total += Math.abs(n) * pipsFrom(color, p);
  }
  return total;
}

/**
 * The point furthest from home that still holds a checker of `color` — its
 * rearmost man, counted in that colour's own numbering. The bar counts as 25,
 * which is exactly what it is worth in pips.
 */
function rearmost(points, color) {
  let worst = 0;
  for (let p = 0; p <= 25; p++) {
    const n = points[p];
    if (!n || (n > 0 ? 'w' : 'b') !== color) continue;
    worst = Math.max(worst, own(color, p));
  }
  return worst;
}

/**
 * Are the two sides still able to hit each other? Once the rearmost checkers
 * have passed one another the game is a pure race, and every positional term
 * below stops meaning anything.
 */
export function inContact(points) {
  let whiteRear = -1;
  let blackRear = 26;
  for (let p = 0; p <= 25; p++) {
    const n = points[p];
    if (n > 0) whiteRear = Math.max(whiteRear, p);
    else if (n < 0) blackRear = Math.min(blackRear, p);
  }
  return whiteRear > blackRear;
}

/** The longest run of consecutive points `color` owns, anywhere on the board. */
function longestPrime(points, color) {
  let best = 0;
  let run = 0;
  for (let p = 1; p <= 24; p++) {
    const n = points[p];
    const mine = n !== 0 && (n > 0 ? 'w' : 'b') === color && Math.abs(n) >= 2;
    run = mine ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * The pips `color` expects to lose to being hit, summed over its blots.
 *
 * Per blot: the chance of being hit, times what a hit costs — the distance
 * the checker would have to travel again. Only the closest attacker is
 * counted, rather than adding up every checker that could reach: two shots at
 * the same blot overlap heavily, and adding them makes the computer flee
 * positions that are barely worse than one shot.
 */
function blotExposure(points, color) {
  const other = opponent(color);
  let risk = 0;
  for (let p = 1; p <= 24; p++) {
    const n = points[p];
    if (!n || (n > 0 ? 'w' : 'b') !== color || Math.abs(n) !== 1) continue;
    let shots = 0;
    // The opponent travels the other way, so its attackers sit on the far
    // side of the blot — and its bar, if occupied, attacks from the very end.
    const barSlot = BAR[other];
    if (Math.abs(points[barSlot]) > 0) {
      shots = Math.max(shots, SHOTS[Math.abs(p - barSlot)] || 0);
    } else {
      for (let q = 1; q <= 24; q++) {
        const m = points[q];
        if (!m || (m > 0 ? 'w' : 'b') !== other) continue;
        // Attackers must be behind the blot in their own direction of travel.
        if (other === 'w' ? q <= p : q >= p) continue;
        shots = Math.max(shots, SHOTS[Math.abs(q - p)] || 0);
      }
    }
    if (!shots) continue;
    // What it costs: the checker goes back to the bar and starts again.
    const lost = 25 - pipsFrom(color, p);
    risk += (shots / 36) * (lost + W.tempo);
  }
  return risk;
}

/**
 * Static evaluation of a position from `color`'s point of view, in pips.
 * Positive means `color` stands better.
 */
export function evaluate(points, off, color) {
  const other = opponent(color);
  const race = pips(points, other) - pips(points, color);
  let score = race + W.off * (off[color] - off[other]);
  score -= W.bar * Math.abs(points[BAR[color]]);
  score += W.bar * Math.abs(points[BAR[other]]);

  if (!inContact(points)) {
    // A pure race: nothing is left to do but run, and the only structure that
    // still matters is not burying checkers on the low points.
    return score - wastage(points, color) + wastage(points, other);
  }

  const myRear = rearmost(points, color);
  const theirRear = rearmost(points, other);
  for (let p = 1; p <= 24; p++) {
    const n = points[p];
    if (!n) continue;
    const owner = n > 0 ? 'w' : 'b';
    const count = Math.abs(n);
    const sign = owner === color ? 1 : -1;
    const rear = owner === color ? myRear : theirRear;
    if (count >= 2) {
      const idx = own(owner, p);
      score += sign * W.point * POINT_VALUE[idx];
      // An anchor is only an anchor while there is something to anchor for.
      if (idx >= 19 && rear >= idx) score += sign * W.anchor;
    }
    if (count > 3) score -= sign * W.stack * (count - 3);
  }
  const myPrime = longestPrime(points, color);
  const theirPrime = longestPrime(points, other);
  score += W.prime * (myPrime * myPrime - theirPrime * theirPrime);
  score -= blotExposure(points, color);
  score += W.theirBlots * blotExposure(points, other);
  return score;
}

/**
 * Pips that can no longer be spent usefully: checkers stacked on the low
 * points at the end of a race have to come off one die at a time whatever
 * they roll. A crude stand-in for a bear-off database, and enough to stop the
 * computer piling its last checkers onto the ace point.
 */
function wastage(points, color) {
  let waste = 0;
  const [low, high] = HOME[color];
  for (let p = low; p <= high; p++) {
    const n = points[p];
    if (!n || (n > 0 ? 'w' : 'b') !== color) continue;
    const count = Math.abs(n);
    if (count > 2) waste += (count - 2) * (7 - pipsFrom(color, p)) * 0.4;
  }
  return waste;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/**
 * What a position is worth to `viewer` once `mover` has answered from it,
 * averaged over every roll `mover` might throw. This is the whole of the
 * second ply: 21 rolls, weighted 1 or 2 out of 36.
 *
 * The reply is chosen by *the mover's* reading of the board and then scored
 * by the viewer's. Scoring it once and negating would be a shortcut through
 * an evaluation that is not quite antisymmetric — the side to move counts an
 * opponent's blots at a discount, since it is the one who gets to shoot.
 */
function replyValue(points, off, mover, viewer) {
  const scratch = new Backgammon();
  const state = {
    points,
    off,
    turn: mover,
    roll: null,
    phase: 'roll',
    cube: { value: 1, owner: null },
  };
  let total = 0;
  for (const { dice, weight } of ROLLS) {
    scratch.load(state);
    scratch.setRoll(dice[0], dice[1]);
    let bestForMover = -Infinity;
    let chosen = null;
    for (const play of scratch.distinctPlays()) {
      const value = evaluate(play.points, play.off, mover);
      if (value > bestForMover) {
        bestForMover = value;
        chosen = play;
      }
    }
    total += weight * evaluate(chosen.points, chosen.off, viewer);
  }
  return total / 36;
}

/**
 * Choose a play for the side on move.
 *
 * @param {Backgammon} game a game in the 'move' phase
 * @param {string|object} level a key of LEVELS, or a config object
 * @param {() => number} rng injectable, so the tests get a fixed choice
 * @returns {object[]|null} the move list to play, or null if there is none
 */
export function findBestPlay(game, level = 'medium', rng = Math.random) {
  const cfg = typeof level === 'string' ? LEVELS[level] : level;
  if (!cfg) throw new Error(`Unknown difficulty level: ${level}`);
  const color = game.turn();
  const plays = game.distinctPlays();
  if (plays.length === 0) return null;
  if (plays.length === 1) return plays[0].moves;

  const scored = plays.map((play) => ({
    play,
    score: evaluate(play.points, play.off, color),
  }));
  scored.sort((a, b) => b.score - a.score);

  if (cfg.plies >= 2) {
    // Only the plays that already look best are worth a second ply: the
    // ranking from one ply is good enough to throw away the bottom of the
    // list, and the cost of the second ply is entirely per-candidate.
    const shortlist = scored.slice(0, cfg.candidates || 6);
    for (const entry of shortlist) {
      entry.score = replyValue(entry.play.points, entry.play.off, opponent(color), color);
    }
    shortlist.sort((a, b) => b.score - a.score);
    return shortlist[0].play.moves;
  }

  // A randomness window, exactly as in the chess and checkers engines: pick
  // uniformly among the plays within `window` pips of the best, so the lower
  // levels play plausibly rather than perfectly.
  const best = scored[0].score;
  const candidates = scored.filter((entry) => entry.score >= best - (cfg.window || 0));
  return candidates[Math.floor(rng() * candidates.length)].play.moves;
}

/**
 * Async wrapper: yields to the event loop so the UI can paint a "thinking"
 * state, and holds a minimum think time so replies feel deliberate rather
 * than instant.
 */
export function choosePlay(game, level, { minThinkMs = 500 } = {}) {
  return new Promise((resolve) => {
    setTimeout(() => {
      const started = performance.now();
      const moves = findBestPlay(game, level);
      const elapsed = performance.now() - started;
      setTimeout(() => resolve(moves), Math.max(0, minThinkMs - elapsed));
    }, 30);
  });
}

/* ------------------------------------------------------------------ */
/* The cube                                                            */
/* ------------------------------------------------------------------ */

/**
 * A rough win probability for `color`, from the evaluation.
 *
 * The logistic below is a fit by eye, not by rollout: a 10-pip advantage
 * early reads as roughly 60%, and about 35 pips as near-certain. That is
 * enough to make the computer's cube handling reasonable — it doubles when
 * clearly ahead and takes when it still has real chances — and nowhere near
 * enough to make it a cube expert. It is deliberately conservative at both
 * ends, since a bad take costs more than a missed double.
 */
export function winProbability(game, color) {
  const points = game.points();
  const off = { w: game.off('w'), b: game.off('b') };
  const equity = evaluate(points, off, color);
  // Late in the game the same pip lead is worth far more, because there are
  // fewer rolls left to lose it in.
  const left = CHECKERS_PER_SIDE * 2 - off.w - off.b;
  const steepness = 0.055 + 0.05 * (1 - left / (CHECKERS_PER_SIDE * 2));
  return 1 / (1 + Math.exp(-steepness * equity));
}

/**
 * Should `color` turn the cube? The window matters as much as the threshold:
 * a position good enough to play for a gammon is one the opponent will simply
 * drop, so doubling it throws away the gammon for a single point.
 */
export function shouldDouble(game, color) {
  if (!game.canDouble(color)) return false;
  const p = winProbability(game, color);
  return p >= 0.68 && p <= 0.87;
}

/** Should `color` accept a double? The classic take point is around 25%. */
export function shouldTake(game, color) {
  return winProbability(game, color) >= 0.24;
}
