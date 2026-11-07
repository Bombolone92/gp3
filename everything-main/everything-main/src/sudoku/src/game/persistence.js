/**
 * Where the game's data lives.
 *
 * localStorage is the primary store and always writes first, because it is the
 * one that cannot fail for a reason outside the player's control. A Puter
 * account, when there is one, is a second copy that makes the same data
 * readable from another device.
 *
 * The sync is a merge, not a race. On sign-in, local and cloud stats are
 * combined field by field (see mergeStats) so neither device's progress is
 * dropped; the saved *game* cannot be merged that way, so the newer of the two
 * timestamps wins and the older is discarded. A read that failed is never
 * treated as an empty store, which is the mistake that would let a flaky
 * connection wipe a player's records.
 */

import { normalizeSettings } from './settings.js';
import { mergeStats, normalizeStats } from './stats.js';
import { decode, encode } from './serialize.js';
import * as cloud from '../net/puter.js';

const LS_SETTINGS = 'sudoku.settings.v1';
const LS_STATS = 'sudoku.stats.v1';
const LS_SAVE = 'sudoku.save.v2';

/* ------------------------------------------------------------------ */
/* Local storage                                                       */
/* ------------------------------------------------------------------ */

/**
 * localStorage is unavailable in some privacy modes and throws on write when a
 * quota is full. Neither is worth an exception reaching the game loop, so both
 * read and write swallow and carry on with defaults.
 */
function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function removeLocal(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to clean up */
  }
}

export const loadSettings = () => normalizeSettings(readLocal(LS_SETTINGS));
export const saveSettings = (settings) => writeLocal(LS_SETTINGS, settings);

export const loadStats = () => normalizeStats(readLocal(LS_STATS));
export const saveStats = (stats) => writeLocal(LS_STATS, stats);

/** The game in progress, or null when there is none worth restoring. */
export const loadSavedGame = () => decode(readLocal(LS_SAVE));

/** Snapshot the game in progress. */
export function saveGame(game, now = Date.now()) {
  return writeLocal(LS_SAVE, encode(game, now));
}

export function clearSavedGame() {
  removeLocal(LS_SAVE);
}

/* ------------------------------------------------------------------ */
/* Cloud sync                                                          */
/* ------------------------------------------------------------------ */

/**
 * Combine local and cloud stats and leave both holding the result.
 *
 * @param {object} localStats
 * @returns {Promise<{stats: object, synced: boolean}>} `synced` false means the
 *   cloud could not be read, and the returned stats are simply the local ones.
 */
export async function syncStats(localStats) {
  const { ok, value } = await cloud.pullStats();
  if (!ok) return { stats: normalizeStats(localStats), synced: false };

  const merged = mergeStats(localStats, value);
  saveStats(merged);
  await cloud.pushStats(merged);
  return { stats: merged, synced: true };
}

/** Push stats to the account, if there is one. Failure is not an error here. */
export async function pushStats(stats) {
  return cloud.pushStats(stats);
}

/**
 * Reconcile the saved game across devices.
 *
 * Unlike stats, two half-finished boards cannot be combined into one, so this
 * picks the more recent and says which it was, since the caller may want to tell
 * player their phone's game just arrived.
 *
 * @param {object|null} localGame The game restored from this device, if any.
 * @returns {Promise<{game: object|null, source: 'local'|'cloud'|'none'}>}
 */
export async function syncSavedGame(localGame) {
  const localRaw = readLocal(LS_SAVE);
  const { ok, value } = await cloud.pullSave();
  if (!ok) return { game: localGame, source: localGame ? 'local' : 'none' };

  const remote = decode(value);
  if (!remote) {
    // Nothing usable up there. Seed it from this device so the next one finds it.
    if (localRaw) await cloud.pushSave(localRaw);
    return { game: localGame, source: localGame ? 'local' : 'none' };
  }
  if (!localGame) return { game: remote, source: 'cloud' };

  const localTs = Number(localRaw?.ts) || 0;
  const remoteTs = Number(value?.ts) || 0;
  if (remoteTs > localTs) {
    writeLocal(LS_SAVE, value);
    return { game: remote, source: 'cloud' };
  }
  if (localRaw) await cloud.pushSave(localRaw);
  return { game: localGame, source: 'local' };
}

/** Mirror the current game to the account. */
export async function pushSavedGame(game, now = Date.now()) {
  return cloud.pushSave(encode(game, now));
}

/** Forget the saved game everywhere, once one is finished. */
export async function clearSaveEverywhere() {
  clearSavedGame();
  await cloud.clearCloudSave();
}

/** Storage keys, exported for the tests rather than for callers. */
export const __keys = { LS_SETTINGS, LS_STATS, LS_SAVE };
