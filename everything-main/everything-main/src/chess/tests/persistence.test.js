import { describe, it, expect } from 'vitest';
import { parseSavedGame } from '../src/game/persistence.js';

/** The shape main.js writes, which everything here starts from. */
const valid = () => ({
  v: 1,
  mode: 'computer',
  myColor: 'b',
  time: '5+3',
  moves: [['e2', 'e4'], ['e7', 'e5'], ['g7', 'g8', 'q']],
  clock: [298000, 299500],
  clockStack: [[300000, 300000], [298000, 300000], [298000, 299500]],
});

const withSave = (patch) => parseSavedGame({ ...valid(), ...patch });

describe('reading a saved game', () => {
  it('accepts what the app writes', () => {
    const saved = parseSavedGame(valid());
    expect(saved).toMatchObject({ mode: 'computer', myColor: 'b', time: '5+3' });
    expect(saved.moves).toEqual([
      { from: 'e2', to: 'e4', promotion: null },
      { from: 'e7', to: 'e5', promotion: null },
      { from: 'g7', to: 'g8', promotion: 'q' },
    ]);
    expect(saved.clock).toEqual({ w: 298000, b: 299500 });
    expect(saved.clockStack).toHaveLength(3);
  });

  it('rejects a save from another format version', () => {
    expect(withSave({ v: 2 })).toBe(null);
    expect(withSave({ v: undefined })).toBe(null);
  });

  it('rejects anything that is not an object', () => {
    for (const junk of [null, undefined, 0, 'x', [], true]) {
      expect(parseSavedGame(junk)).toBe(null);
    }
  });

  it('refuses modes that cannot be resumed', () => {
    // An online game's connection cannot outlive the page, so a save claiming
    // to be one is not something to restore into.
    expect(withSave({ mode: 'online' })).toBe(null);
    expect(withSave({ mode: 'nonsense' })).toBe(null);
    expect(withSave({ mode: 'local' })).not.toBe(null);
  });

  it('refuses a bad side', () => {
    expect(withSave({ myColor: 'white' })).toBe(null);
    expect(withSave({ myColor: null })).toBe(null);
  });

  it('refuses an empty or oversized move list', () => {
    expect(withSave({ moves: [] })).toBe(null);
    expect(withSave({ moves: 'e2e4' })).toBe(null);
    const huge = Array.from({ length: 1001 }, () => ['e2', 'e4']);
    expect(withSave({ moves: huge })).toBe(null);
  });

  it('refuses moves that are not squares', () => {
    expect(withSave({ moves: [['e2', 'e9']] })).toBe(null);
    expect(withSave({ moves: [['j2', 'e4']] })).toBe(null);
    expect(withSave({ moves: [['e2']] })).toBe(null);
    expect(withSave({ moves: [[2, 4]] })).toBe(null);
    expect(withSave({ moves: [['e2', 'e4', 'k']] })).toBe(null);
  });

  it('refuses a time control id that could not be one', () => {
    expect(withSave({ time: 42 })).toBe(null);
    expect(withSave({ time: 'x'.repeat(17) })).toBe(null);
    // Unknown-but-plausible ids get through here and are resolved (to an
    // untimed game) by the caller, so a future control never voids a save.
    expect(withSave({ time: '90+30' })).not.toBe(null);
  });

  it('survives a missing or broken clock', () => {
    expect(withSave({ clock: null }).clock).toBe(null);
    expect(withSave({ clock: [1] }).clock).toBe(null);
    expect(withSave({ clock: ['a', 'b'] }).clock).toBe(null);
    expect(withSave({ clock: [-1, 5] }).clock).toBe(null);
    expect(withSave({ clock: [Infinity, 5] }).clock).toBe(null);
    // A broken clock costs the clock, not the game.
    expect(withSave({ clock: undefined }).moves).toHaveLength(3);
  });

  it('drops an undo stack that does not line up with the moves', () => {
    expect(withSave({ clockStack: [[1, 2]] }).clockStack).toEqual([]);
    expect(withSave({ clockStack: 'nope' }).clockStack).toEqual([]);
    expect(withSave({ clockStack: [[1, 2], [3, 'x'], [5, 6]] }).clockStack).toEqual([]);
    expect(withSave({ clockStack: undefined }).clockStack).toEqual([]);
  });
});
