import { describe, it, expect } from 'vitest';
import { parseSavedGame } from '../src/game/persistence.js';

const valid = {
  v: 1,
  mode: 'computer',
  myColor: 'b',
  time: 'unlimited',
  moves: [[11, 15], [23, 19], [15, 24, 31]],
  clock: null,
  clockStack: [],
};

describe('parseSavedGame', () => {
  it('accepts a well-formed save', () => {
    const parsed = parseSavedGame(valid);
    expect(parsed.moves).toEqual([[11, 15], [23, 19], [15, 24, 31]]);
    expect(parsed.myColor).toBe('b');
  });

  it('rejects a save from another format version', () => {
    expect(parseSavedGame({ ...valid, v: 2 })).toBe(null);
  });

  it('rejects squares outside 1-32', () => {
    expect(parseSavedGame({ ...valid, moves: [[0, 15]] })).toBe(null);
    expect(parseSavedGame({ ...valid, moves: [[11, 33]] })).toBe(null);
    expect(parseSavedGame({ ...valid, moves: [[11, 15.5]] })).toBe(null);
  });

  it('rejects a path too short or absurdly long', () => {
    expect(parseSavedGame({ ...valid, moves: [[11]] })).toBe(null);
    expect(parseSavedGame({ ...valid, moves: [new Array(20).fill(11)] })).toBe(null);
  });

  it('rejects an online save', () => {
    expect(parseSavedGame({ ...valid, mode: 'online' })).toBe(null);
  });

  it('drops a clock stack that does not match the move count', () => {
    const parsed = parseSavedGame({ ...valid, clockStack: [[1000, 1000]] });
    expect(parsed.clockStack).toEqual([]);
  });
});
