import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELLS } from '../src/engine/grid.js';
import { generate } from '../src/engine/generator.js';
import { createGame, setValue } from '../src/game/state.js';
import { encode } from '../src/game/serialize.js';
import { DEFAULT_SETTINGS } from '../src/game/settings.js';
import { emptyStats, recordSolved } from '../src/game/stats.js';
import {
  __keys,
  clearSaveEverywhere,
  clearSavedGame,
  loadSavedGame,
  loadSettings,
  loadStats,
  pushSavedGame,
  saveGame,
  saveSettings,
  saveStats,
  syncSavedGame,
  syncStats,
} from '../src/game/persistence.js';

/** A localStorage stand-in, since these tests run without a DOM. */
function fakeLocalStorage({ failWrites = false } = {}) {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      if (failWrites) throw new DOMException('quota', 'QuotaExceededError');
      map.set(key, String(value));
    },
    removeItem: (key) => map.delete(key),
  };
}

/**
 * A puter.js stand-in covering the surface this app uses: auth.isSignedIn and
 * a key-value store. `failReads` models the case the sync logic most has to get
 * right, a reachable-but-broken cloud whose empty answer must not be mistaken
 * for an empty account.
 */
function fakePuter({ signedIn = true, failReads = false, failWrites = false, store = new Map() } = {}) {
  return {
    env: 'web',
    store,
    auth: {
      isSignedIn: () => signedIn,
      getUser: async () => ({ username: 'tester' }),
      signIn: async () => {},
      signOut: async () => {},
    },
    kv: {
      MAX_VALUE_SIZE: 400_000,
      get: async (key) => {
        if (failReads) throw new Error('network');
        return store.has(key) ? store.get(key) : null;
      },
      set: async (key, value) => {
        if (failWrites) throw new Error('network');
        store.set(key, value);
      },
      del: async (key) => {
        store.delete(key);
      },
    },
  };
}

const { puzzle, solution } = generate({ difficulty: 'medium', seed: 'persistence-tests' });

function playedGame() {
  const game = createGame({ puzzle, solution, difficulty: 'medium', seed: 'persistence-tests' });
  const cell = [...Array(CELLS).keys()].find((i) => !game.puzzle[i]);
  setValue(game, cell, solution[cell]);
  game.elapsedMs = 12_000;
  return game;
}

let storage;

beforeEach(() => {
  storage = fakeLocalStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('puter', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings on this device', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips a change', () => {
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark', showTimer: false });
    const loaded = loadSettings();
    expect(loaded.theme).toBe('dark');
    expect(loaded.showTimer).toBe(false);
  });

  it('normalizes whatever it finds, including hand-edited storage', () => {
    storage.map.set(__keys.LS_SETTINGS, JSON.stringify({ theme: 'sepia', nonsense: 1 }));
    const loaded = loadSettings();
    expect(loaded.theme).toBe('system');
    expect(loaded).not.toHaveProperty('nonsense');
  });

  it('survives unparseable storage', () => {
    storage.map.set(__keys.LS_SETTINGS, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('survives storage being unavailable altogether', () => {
    // Private browsing modes throw on access rather than returning null.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {},
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });

  it('reports a failed write instead of throwing', () => {
    vi.stubGlobal('localStorage', fakeLocalStorage({ failWrites: true }));
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });
});

describe('records on this device', () => {
  it('starts empty and round-trips', () => {
    expect(loadStats()).toEqual(emptyStats());
    const stats = recordSolved(emptyStats(), { difficulty: 'easy', elapsedMs: 60_000 });
    saveStats(stats);
    expect(loadStats().byDifficulty.easy.bestMs).toBe(60_000);
  });

  it('discards a blob from an incompatible version', () => {
    storage.map.set(__keys.LS_STATS, JSON.stringify({ v: 99, byDifficulty: { easy: { solved: 5 } } }));
    expect(loadStats()).toEqual(emptyStats());
  });
});

describe('the game in progress', () => {
  it('round-trips through storage', () => {
    const game = playedGame();
    expect(saveGame(game)).toBe(true);
    const restored = loadSavedGame();
    expect([...restored.values]).toEqual([...game.values]);
    expect(restored.elapsedMs).toBe(12_000);
  });

  it('reports nothing to restore when the slot is empty', () => {
    expect(loadSavedGame()).toBeNull();
  });

  it('reports nothing rather than a broken board', () => {
    storage.map.set(__keys.LS_SAVE, JSON.stringify({ v: 2, values: 'junk' }));
    expect(loadSavedGame()).toBeNull();
  });

  it('clears the slot', () => {
    saveGame(playedGame());
    clearSavedGame();
    expect(loadSavedGame()).toBeNull();
  });
});

describe('syncStats', () => {
  it('merges the account and this device, then leaves both holding the result', async () => {
    const cloudStats = recordSolved(emptyStats(), { difficulty: 'easy', elapsedMs: 90_000 });
    const puter = fakePuter({ store: new Map([['sudoku:stats', JSON.stringify(cloudStats)]]) });
    vi.stubGlobal('puter', puter);

    const localStats = recordSolved(emptyStats(), { difficulty: 'hard', elapsedMs: 300_000 });
    const { stats, synced } = await syncStats(localStats);

    expect(synced).toBe(true);
    expect(stats.byDifficulty.easy.bestMs).toBe(90_000);
    expect(stats.byDifficulty.hard.bestMs).toBe(300_000);
    // Both copies now agree.
    expect(loadStats().byDifficulty.easy.bestMs).toBe(90_000);
    expect(JSON.parse(puter.store.get('sudoku:stats')).byDifficulty.hard.bestMs).toBe(300_000);
  });

  it('seeds an account that has never been written to', async () => {
    const puter = fakePuter();
    vi.stubGlobal('puter', puter);
    const localStats = recordSolved(emptyStats(), { difficulty: 'easy', elapsedMs: 60_000 });
    const { stats, synced } = await syncStats(localStats);
    expect(synced).toBe(true);
    expect(stats.byDifficulty.easy.bestMs).toBe(60_000);
    expect(puter.store.has('sudoku:stats')).toBe(true);
  });

  it('does not touch anything when the account cannot be read', async () => {
    // The failure this guards against: treating an unreachable store as an
    // empty one, merging against nothing, and pushing the result back over
    // perfectly good records.
    const cloudStats = recordSolved(emptyStats(), { difficulty: 'easy', elapsedMs: 45_000 });
    const store = new Map([['sudoku:stats', JSON.stringify(cloudStats)]]);
    vi.stubGlobal('puter', fakePuter({ failReads: true, store }));

    const localStats = recordSolved(emptyStats(), { difficulty: 'hard', elapsedMs: 300_000 });
    const { stats, synced } = await syncStats(localStats);

    expect(synced).toBe(false);
    expect(stats.byDifficulty.hard.bestMs).toBe(300_000);
    // The cloud copy is exactly as it was.
    expect(JSON.parse(store.get('sudoku:stats')).byDifficulty.easy.bestMs).toBe(45_000);
  });

  it('does nothing when signed out', async () => {
    vi.stubGlobal('puter', fakePuter({ signedIn: false }));
    const { synced } = await syncStats(emptyStats());
    expect(synced).toBe(false);
  });

  it('does nothing when puter.js never loaded', async () => {
    const { stats, synced } = await syncStats(emptyStats());
    expect(synced).toBe(false);
    expect(stats).toEqual(emptyStats());
  });
});

describe('syncSavedGame', () => {
  it('takes the account’s game when this device has none', async () => {
    const cloudGame = playedGame();
    vi.stubGlobal(
      'puter',
      fakePuter({ store: new Map([['sudoku:save', JSON.stringify(encode(cloudGame, 500))]]) }),
    );
    const { game, source } = await syncSavedGame(null);
    expect(source).toBe('cloud');
    expect([...game.values]).toEqual([...cloudGame.values]);
  });

  it('takes the more recent of the two', async () => {
    const local = playedGame();
    saveGame(local, 100);
    const cloudGame = playedGame();
    const cell = [...Array(CELLS).keys()].find((i) => !cloudGame.puzzle[i] && !cloudGame.values[i]);
    setValue(cloudGame, cell, solution[cell]);
    vi.stubGlobal(
      'puter',
      fakePuter({ store: new Map([['sudoku:save', JSON.stringify(encode(cloudGame, 900))]]) }),
    );

    const { game, source } = await syncSavedGame(local);
    expect(source).toBe('cloud');
    expect(game.values[cell]).toBe(solution[cell]);
    // The newer game is now this device's too, so a reload does not undo it.
    expect(loadSavedGame().values[cell]).toBe(solution[cell]);
  });

  it('keeps this device’s game when it is the newer one, and pushes it up', async () => {
    const local = playedGame();
    saveGame(local, 900);
    const puter = fakePuter({
      store: new Map([['sudoku:save', JSON.stringify(encode(playedGame(), 100))]]),
    });
    vi.stubGlobal('puter', puter);

    const { source } = await syncSavedGame(local);
    expect(source).toBe('local');
    expect(JSON.parse(puter.store.get('sudoku:save')).ts).toBe(900);
  });

  it('seeds an account with no saved game', async () => {
    const local = playedGame();
    saveGame(local, 100);
    const puter = fakePuter();
    vi.stubGlobal('puter', puter);
    const { source } = await syncSavedGame(local);
    expect(source).toBe('local');
    expect(puter.store.has('sudoku:save')).toBe(true);
  });

  it('ignores a corrupt game in the account rather than losing the local one', async () => {
    const local = playedGame();
    saveGame(local, 100);
    vi.stubGlobal('puter', fakePuter({ store: new Map([['sudoku:save', '{"v":2,"values":"junk"}']]) }));
    const { game, source } = await syncSavedGame(local);
    expect(source).toBe('local');
    expect([...game.values]).toEqual([...local.values]);
  });

  it('keeps the local game when the account cannot be read', async () => {
    const local = playedGame();
    saveGame(local, 100);
    vi.stubGlobal('puter', fakePuter({ failReads: true }));
    const { game, source } = await syncSavedGame(local);
    expect(source).toBe('local');
    expect(game).toBe(local);
  });

  it('reports having nothing when neither side does', async () => {
    vi.stubGlobal('puter', fakePuter());
    const { game, source } = await syncSavedGame(null);
    expect(game).toBeNull();
    expect(source).toBe('none');
  });
});

describe('writing to the account', () => {
  it('pushes the game in progress', async () => {
    const puter = fakePuter();
    vi.stubGlobal('puter', puter);
    expect(await pushSavedGame(playedGame(), 42)).toBe(true);
    expect(JSON.parse(puter.store.get('sudoku:save')).ts).toBe(42);
  });

  it('reports a failed write rather than throwing', async () => {
    vi.stubGlobal('puter', fakePuter({ failWrites: true }));
    expect(await pushSavedGame(playedGame())).toBe(false);
  });

  it('refuses a payload past the store’s size limit', async () => {
    const puter = fakePuter();
    puter.kv.MAX_VALUE_SIZE = 10;
    vi.stubGlobal('puter', puter);
    expect(await pushSavedGame(playedGame())).toBe(false);
    expect(puter.store.size).toBe(0);
  });

  it('clears a finished game from both places', async () => {
    const puter = fakePuter({ store: new Map([['sudoku:save', '{}']]) });
    vi.stubGlobal('puter', puter);
    saveGame(playedGame());
    await clearSaveEverywhere();
    expect(loadSavedGame()).toBeNull();
    expect(puter.store.has('sudoku:save')).toBe(false);
  });
});
