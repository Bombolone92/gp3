/**
 * Saving a game in progress so that a reload, a crashed tab, or a phone
 * discarding the page in the background doesn't throw it away.
 *
 * What gets stored is the move list, not a position: replaying it rebuilds
 * the captured pieces, the move log, and the repetition counts a bare board
 * would lose. Clock readings are stored as of the last committed point, and
 * the clock does not run while the page is closed — a browser tab going away
 * is not a player leaving the board.
 *
 * Online games are never saved: the peer connection cannot outlive the page,
 * so there would be nothing to resume into.
 */

const KEY = 'checkers-game';
const FORMAT = 1;
/** Long enough for any real game; a guard against a pathological payload. */
const MAX_PLIES = 1000;

/** A jump can chain at most nine times on an 8x8 board; ten is generous. */
const MAX_PATH = 12;

/**
 * A saved move is the whole turn's path — every square visited, origin to
 * final landing square — as PDN square numbers, not a from/to/promotion
 * tuple: checkers has no promotion, and a jump chain can visit more than two
 * squares.
 */
function parsePath(entry) {
  if (!Array.isArray(entry) || entry.length < 2 || entry.length > MAX_PATH) return null;
  for (const square of entry) {
    if (!Number.isInteger(square) || square < 1 || square > 32) return null;
  }
  return entry.slice();
}

/** localStorage, or null where it is unavailable (private mode, denied). */
function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    // Reading the property itself throws when storage is blocked by policy.
    return null;
  }
}

function isFiniteMs(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseClockPair(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!isFiniteMs(value[0]) || !isFiniteMs(value[1])) return null;
  return { w: value[0], b: value[1] };
}

/**
 * Validate a decoded save. Returns a normalized game, or null for anything
 * unusable — a save written by another version, hand-edited storage, or a
 * shape that simply doesn't fit. Callers treat null as "no saved game".
 *
 * Move legality is not checked here (that takes an engine); the caller
 * replays the list and discards the save if a move doesn't apply.
 */
export function parseSavedGame(data) {
  if (!data || typeof data !== 'object' || data.v !== FORMAT) return null;
  if (data.mode !== 'computer' && data.mode !== 'local') return null;
  if (data.myColor !== 'w' && data.myColor !== 'b') return null;
  if (typeof data.time !== 'string' || data.time.length > 16) return null;
  if (!Array.isArray(data.moves) || data.moves.length === 0) return null;
  if (data.moves.length > MAX_PLIES) return null;

  const moves = [];
  for (const entry of data.moves) {
    const path = parsePath(entry);
    if (!path) return null;
    moves.push(path);
  }

  const clock = parseClockPair(data.clock);
  // The undo stack is a convenience, not a requirement: a save whose stack is
  // missing or malformed still restores, it just cannot rewind the clock.
  const stack = [];
  if (Array.isArray(data.clockStack)) {
    for (const pair of data.clockStack) {
      const parsed = parseClockPair(pair);
      if (!parsed) {
        stack.length = 0;
        break;
      }
      stack.push(parsed);
    }
  }

  return {
    mode: data.mode,
    myColor: data.myColor,
    time: data.time,
    moves,
    clock,
    clockStack: stack.length === moves.length ? stack : [],
  };
}

/** Read the saved game, or null when there is none (or it is unusable). */
export function loadGame() {
  const store = storage();
  if (!store) return null;
  let data;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = parseSavedGame(data);
  if (!parsed) clearGame(); // corrupt or stale: don't keep re-reading it
  return parsed;
}

/**
 * Store a game in progress.
 *
 * @param {{mode: string, myColor: string, time: string,
 *          moves: number[][],
 *          clock: {w: number, b: number}|null,
 *          clockStack: {w: number, b: number}[]}} game
 */
export function saveGame({ mode, myColor, time, moves, clock, clockStack }) {
  const store = storage();
  if (!store) return;
  const payload = {
    v: FORMAT,
    mode,
    myColor,
    time,
    moves: moves.map((path) => path.slice()),
    clock: clock ? [Math.round(clock.w), Math.round(clock.b)] : null,
    clockStack: (clockStack || []).map((c) => [Math.round(c.w), Math.round(c.b)]),
  };
  try {
    store.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Full or unavailable storage: the game still plays, it just won't survive
    // a reload. Never worth interrupting play over.
  }
}

export function clearGame() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    // Nothing else to try.
  }
}
