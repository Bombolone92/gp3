import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clearGame, loadGame, saveGame } from '../src/game/persistence.js';

/**
 * The storage layer, against a stand-in for localStorage. What matters here
 * is that each mode has a save of its own: a game against the computer and a
 * pass & play game are two games in progress, and leaving one to look at the
 * other must not throw either away.
 */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    keys: () => [...map.keys()],
  };
}

const opening = (mode) => ({
  mode,
  myColor: 'w',
  time: 'unlimited',
  cubeless: true,
  events: [],
  roll: mode === 'computer' ? [3, 1] : [6, 2],
  clock: null,
  clockStack: [],
});

let store;
beforeEach(() => {
  store = fakeStorage();
  globalThis.localStorage = store;
});
afterEach(() => {
  delete globalThis.localStorage;
});

describe('one save per mode', () => {
  it('keeps a computer game and a pass & play game side by side', () => {
    saveGame(opening('computer'));
    saveGame(opening('local'));
    expect(loadGame('computer')?.roll).toEqual([3, 1]);
    expect(loadGame('local')?.roll).toEqual([6, 2]);
  });

  it('clears only the mode it is asked to', () => {
    saveGame(opening('computer'));
    saveGame(opening('local'));
    clearGame('local');
    expect(loadGame('local')).toBeNull();
    expect(loadGame('computer')?.roll).toEqual([3, 1]);
  });

  it('has nothing for a mode that never saved', () => {
    saveGame(opening('computer'));
    expect(loadGame('local')).toBeNull();
    expect(loadGame('computer')).not.toBeNull();
  });

  it('forgets a corrupt save rather than tripping over it every visit', () => {
    store.setItem('backgammon-game:computer', '{not json');
    expect(loadGame('computer')).toBeNull();
    expect(store.keys()).toEqual([]);
  });
});

describe('saves from before there was one per mode', () => {
  const legacy = (mode) => JSON.stringify({ v: 2, ...opening(mode), roll: [5, 2] });

  it('are picked up by the mode they belong to, and the old key retired', () => {
    store.setItem('backgammon-game', legacy('computer'));
    expect(loadGame('computer')?.roll).toEqual([5, 2]);
    expect(store.getItem('backgammon-game')).toBeNull();
  });

  it('are left waiting for their own mode when another asks', () => {
    store.setItem('backgammon-game', legacy('local'));
    expect(loadGame('computer')).toBeNull();
    expect(store.getItem('backgammon-game')).not.toBeNull();
    expect(loadGame('local')?.roll).toEqual([5, 2]);
  });

  it('are dropped when they no longer parse', () => {
    store.setItem('backgammon-game', 'junk');
    expect(loadGame('computer')).toBeNull();
    expect(store.getItem('backgammon-game')).toBeNull();
  });

  it('yield to a save already kept for the mode', () => {
    store.setItem('backgammon-game', legacy('computer'));
    saveGame(opening('computer'));
    expect(loadGame('computer')?.roll).toEqual([3, 1]);
  });
});
