/**
 * Saving a game in progress so that a reload, a crashed tab, or a phone
 * discarding the page in the background doesn't throw it away.
 *
 * What gets stored is the list of things that happened — each turn's dice and
 * checker moves, and every cube action — not a position. Replaying it rebuilds
 * the cube, the history, and the notation a bare board would lose.
 *
 * **The dice are part of the record, and that is the point.** A backgammon
 * save that stored only the position would let a player reload their way out
 * of a bad roll: close the tab, come back, roll again. Storing the roll that
 * is on the table means a game resumes owing exactly the play it owed before.
 *
 * Online games are never saved: the peer connection cannot outlive the page,
 * so there would be nothing to resume into.
 */

import { Backgammon } from '../engine/backgammon.js';

/**
 * One slot per mode. A game against the computer and a pass & play game are
 * two different games in progress, and looking in on the other mode — or on
 * online play, which never saves — must not throw either of them away.
 */
const KEY_PREFIX = 'backgammon-game:';
/** Where saves lived before they were kept per mode; read once, then retired. */
const LEGACY_KEY = 'backgammon-game';
const FORMAT = 2;
/** Long enough for any real game; a guard against a pathological payload. */
const MAX_EVENTS = 2000;

const keyFor = (mode) => `${KEY_PREFIX}${mode}`;

/** The localStorage key a mode's save lives under — for tools that seed one. */
export const storageKeyFor = keyFor;

/** localStorage, or null where it is unavailable (private mode, denied). */
function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    // Reading the property itself throws when storage is blocked by policy.
    return null;
  }
}

const isDie = (d) => Number.isInteger(d) && d >= 1 && d <= 6;
const isSlot = (p) => Number.isInteger(p) && p >= 0 && p <= 25;

function parseRoll(value) {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (!isDie(value[0]) || !isDie(value[1])) return null;
  return [value[0], value[1]];
}

/**
 * A saved move is `[from, to, die]`. Whether it hit is deliberately not
 * stored: the engine works that out from the position when the move is
 * replayed, and a stored flag could only ever disagree with it.
 */
function parseMove(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!isSlot(value[0]) || !isSlot(value[1]) || !isDie(value[2])) return null;
  return { from: value[0], to: value[1], die: value[2] };
}

function parseEvent(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.k === 'd' || value.k === 't') return { k: value.k };
  if (value.k !== 'm') return null;
  const roll = parseRoll(value.r);
  if (!roll) return null;
  if (!Array.isArray(value.m) || value.m.length > 4) return null;
  const moves = [];
  for (const entry of value.m) {
    const move = parseMove(entry);
    if (!move) return null;
    moves.push(move);
  }
  return { k: 'm', r: roll, m: moves };
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
 * Validate a decoded save. Returns a normalized record, or null for anything
 * unusable — a save written by another version, hand-edited storage, or a
 * shape that simply doesn't fit. Callers treat null as "no saved game".
 *
 * Legality is not checked here; `replaySavedGame` does that by replaying the
 * events through a real engine, which is the only check worth trusting.
 */
export function parseSavedGame(data) {
  if (!data || typeof data !== 'object' || data.v !== FORMAT) return null;
  if (data.mode !== 'computer' && data.mode !== 'local') return null;
  if (data.myColor !== 'w' && data.myColor !== 'b') return null;
  if (typeof data.time !== 'string' || data.time.length > 16) return null;
  if (typeof data.cubeless !== 'boolean') return null;
  if (!Array.isArray(data.events) || data.events.length > MAX_EVENTS) return null;

  const events = [];
  for (const entry of data.events) {
    const event = parseEvent(entry);
    if (!event) return null;
    events.push(event);
  }
  // The dice sitting on the table with no play made against them yet. A game
  // with nothing but this is still worth storing — the opening roll has been
  // thrown, and coming back to a board that re-rolls it is the reload-until-
  // you-like-your-dice hole this whole format exists to close.
  const pendingRoll = data.roll === null || data.roll === undefined ? null : parseRoll(data.roll);
  if (data.roll && !pendingRoll) return null;
  if (events.length === 0 && !pendingRoll) return null;

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
    cubeless: data.cubeless,
    events,
    roll: pendingRoll,
    clock,
    clockStack: stack.length === events.length ? stack : [],
  };
}

/**
 * Replay a validated save into a fresh game. Returns the game, or null if the
 * events do not apply — which is the check that a hand-edited save cannot get
 * past, since every play goes through the engine's own legality test.
 */
export function replaySavedGame(saved) {
  const game = new Backgammon();
  // Before anything is replayed: a game recorded without the cube must refuse
  // a doubling event rather than quietly accept one.
  game.setCubeless(saved.cubeless);
  try {
    for (const event of saved.events) {
      if (event.k === 'd') {
        if (!game.double()) return null;
        continue;
      }
      if (event.k === 't') {
        if (!game.take()) return null;
        continue;
      }
      if (!game.setRoll(event.r[0], event.r[1])) return null;
      if (!game.play(event.m)) return null;
    }
    if (saved.roll && !game.setRoll(saved.roll[0], saved.roll[1])) return null;
  } catch {
    return null; // a malformed slot throws inside the engine
  }
  // A finished game is never stored, so one turning up here means the save
  // came from somewhere else; don't trust the rest of it either.
  if (game.isGameOver()) return null;
  return game;
}

/**
 * Read the game saved for `mode`, or null when there is none (or it is
 * unusable). A save from before games were kept per mode is picked up from
 * its old key if it belongs to this mode, and the old key is retired either
 * way once it has been looked at.
 */
export function loadGame(mode) {
  const store = storage();
  if (!store) return null;
  const own = readKey(store, keyFor(mode));
  if (own.raw) {
    if (!own.parsed) clearGame(mode); // corrupt or stale: don't keep re-reading it
    return own.parsed;
  }
  const legacy = readKey(store, LEGACY_KEY);
  if (!legacy.raw) return null;
  if (!legacy.parsed || legacy.parsed.mode === mode) removeKey(store, LEGACY_KEY);
  return legacy.parsed && legacy.parsed.mode === mode ? legacy.parsed : null;
}

/** One key's contents: the raw string (if any) and what it parsed to. */
function readKey(store, key) {
  let raw = null;
  try {
    raw = store.getItem(key);
  } catch {
    return { raw: null, parsed: null };
  }
  if (!raw) return { raw: null, parsed: null };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { raw, parsed: null };
  }
  return { raw, parsed: parseSavedGame(data) };
}

function removeKey(store, key) {
  try {
    store.removeItem(key);
  } catch {
    // Nothing else to try.
  }
}

/** Turn the engine's own history into the compact form that gets stored. */
export function eventsFrom(history) {
  const events = [];
  for (const entry of history) {
    if (entry.kind === 'move') {
      events.push({ k: 'm', r: entry.roll, m: entry.moves.map((m) => [m.from, m.to, m.die]) });
    } else if (entry.kind === 'double') {
      events.push({ k: 'd' });
    } else if (entry.kind === 'take') {
      events.push({ k: 't' });
    }
    // A drop or a resignation ends the game, and finished games are not saved.
  }
  return events;
}

/**
 * Store a game in progress.
 *
 * @param {{mode: string, myColor: string, time: string, cubeless: boolean,
 *          events: object[], roll: number[]|null,
 *          clock: {w: number, b: number}|null,
 *          clockStack: {w: number, b: number}[]}} game
 */
export function saveGame({ mode, myColor, time, cubeless, events, roll, clock, clockStack }) {
  const store = storage();
  if (!store) return;
  const payload = {
    v: FORMAT,
    mode,
    myColor,
    time,
    cubeless: !!cubeless,
    events,
    roll: roll ? [roll[0], roll[1]] : null,
    clock: clock ? [Math.round(clock.w), Math.round(clock.b)] : null,
    clockStack: (clockStack || []).map((c) => [Math.round(c.w), Math.round(c.b)]),
  };
  try {
    store.setItem(keyFor(mode), JSON.stringify(payload));
  } catch {
    // Full or unavailable storage: the game still plays, it just won't survive
    // a reload. Never worth interrupting play over.
  }
}

/** Forget the game saved for `mode`; the other modes' saves are left alone. */
export function clearGame(mode) {
  const store = storage();
  if (!store) return;
  removeKey(store, keyFor(mode));
}
