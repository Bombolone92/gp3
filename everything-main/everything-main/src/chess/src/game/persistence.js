/**
 * Saving a game in progress so that a reload, a crashed tab, or a phone
 * discarding the page in the background doesn't throw it away.
 *
 * What gets stored is the move list, not a position: replaying it rebuilds the
 * captured pieces, the move log in algebraic notation, and the repetition
 * counts that a bare FEN would lose. Clock readings are stored as of the last
 * committed point, and the clock does not run while the page is closed — a
 * browser tab going away is not a player leaving the board.
 *
 * Online games are never saved: the peer connection cannot outlive the page,
 * so there would be nothing to resume into.
 */

const KEY = 'chess-game';
const FORMAT = 1;
/** Long enough for any real game; a guard against a pathological payload. */
const MAX_PLIES = 1000;

const SQUARE = /^[a-h][1-8]$/;
const PROMOTIONS = ['q', 'r', 'b', 'n'];

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
 * Move legality is not checked here (that takes an engine); the caller replays
 * the list and discards the save if a move doesn't apply.
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
    if (!Array.isArray(entry) || entry.length < 2) return null;
    const [from, to, promotion] = entry;
    if (typeof from !== 'string' || !SQUARE.test(from)) return null;
    if (typeof to !== 'string' || !SQUARE.test(to)) return null;
    if (promotion != null && !PROMOTIONS.includes(promotion)) return null;
    moves.push({ from, to, promotion: promotion || null });
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
 *          moves: {from: string, to: string, promotion: string|null}[],
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
    // Positional tuples rather than objects: a long game is stored many times
    // over, and this is a third of the size.
    moves: moves.map((m) => [m.from, m.to, m.promotion || null]),
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
