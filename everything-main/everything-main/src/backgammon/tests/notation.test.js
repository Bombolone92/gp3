import { describe, it, expect } from 'vitest';
import { Backgammon } from '../src/engine/backgammon.js';
import {
  buildMat,
  entryNotation,
  matDate,
  matFilename,
  movesNotation,
  rollNotation,
} from '../src/game/notation.js';

const move = (from, to, die, hit = false) => ({ from, to, die, hit });

describe('writing a turn down', () => {
  it('writes an ordinary move as from/to', () => {
    expect(movesNotation('w', [move(8, 5, 3), move(6, 5, 1)])).toBe('8/5 6/5');
  });

  it('counts two checkers doing the same thing', () => {
    expect(movesNotation('w', [move(8, 5, 3), move(8, 5, 3)])).toBe('8/5(2)');
  });

  it('marks a hit with a star', () => {
    expect(movesNotation('w', [move(13, 7, 6, true)])).toBe('13/7*');
  });

  it('names the bar and the tray rather than numbering them', () => {
    expect(movesNotation('w', [move(25, 20, 5)])).toBe('bar/20');
    expect(movesNotation('b', [move(0, 5, 5)])).toBe('bar/5');
    expect(movesNotation('w', [move(3, 0, 3)])).toBe('3/off');
    expect(movesNotation('b', [move(22, 25, 3)])).toBe('22/off');
  });

  it('writes one checker moved twice as a single move', () => {
    expect(movesNotation('w', [move(24, 18, 6), move(18, 13, 5)])).toBe('24/13');
  });

  it('keeps the middle point when something was hit on the way', () => {
    expect(movesNotation('w', [move(25, 22, 3, true), move(22, 17, 5)])).toBe('bar/22*/17');
  });

  it('does not run two bear-offs together', () => {
    expect(movesNotation('w', [move(3, 0, 3), move(3, 0, 3)])).toBe('3/off(2)');
  });

  it('puts the high die first, whichever order they came in', () => {
    expect(rollNotation([3, 1])).toBe('31');
    expect(rollNotation([1, 3])).toBe('31');
    expect(rollNotation([6, 6])).toBe('66');
  });
});

describe('history entries', () => {
  it('puts the dice in front of the moves', () => {
    const game = new Backgammon();
    game.setRoll(3, 1);
    const entry = game.play([move(8, 5, 3), move(6, 5, 1)]);
    expect(entryNotation(entry)).toBe('31: 8/5 6/5');
  });

  it('says so when a turn had no legal play', () => {
    expect(entryNotation({ kind: 'move', color: 'w', roll: [4, 3], moves: [] })).toBe(
      '43: (no play)',
    );
  });

  it('writes the cube actions', () => {
    expect(entryNotation({ kind: 'double', color: 'w', from: 2, to: 4 })).toBe(' Doubles => 4');
    expect(entryNotation({ kind: 'take', color: 'b' })).toBe(' Takes');
    expect(entryNotation({ kind: 'drop', color: 'b' })).toBe(' Drops');
  });
});

describe('the .mat transcript', () => {
  function sampleGame() {
    const game = new Backgammon();
    game.setRoll(3, 1); // White opens; Black travels the other way
    game.play([move(8, 5, 3), move(6, 5, 1)]);
    game.setRoll(6, 2);
    game.play([move(12, 18, 6), move(18, 20, 2)]);
    game.setRoll(5, 4);
    game.play([move(13, 8, 5), move(13, 9, 4)]);
    return game;
  }

  it('lays the two players out in columns, headed by their names', () => {
    const game = sampleGame();
    const mat = buildMat({
      history: game.history(),
      white: 'You',
      black: 'Computer',
      result: null,
      date: new Date(2026, 7, 13),
    });
    const lines = mat.split('\n');
    expect(lines).toContain('0 point match');
    expect(lines).toContain(' Game 1');
    expect(mat).toContain('You');
    expect(mat).toContain('Computer');
    expect(mat).toContain('31: 8/5 6/5');
    expect(mat).toContain('62: 12/20');
    expect(mat).toContain('54: 13/8 13/9');
  });

  it('numbers a row per round, White first', () => {
    const game = sampleGame();
    const mat = buildMat({
      history: game.history(),
      white: 'W',
      black: 'B',
      result: null,
      date: new Date(2026, 7, 13),
    });
    const rows = mat.split('\n').filter((l) => /^\s*\d+\)/.test(l));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^\s*1\)\s+31: 8\/5 6\/5\s+62: 12\/20$/);
    expect(rows[1]).toMatch(/^\s*2\)\s+54: 13\/8 13\/9$/);
  });

  it('leaves the first cell empty when Black opened', () => {
    const game = new Backgammon();
    game.setRoll(2, 4); // Black opens
    game.play([move(12, 16, 4), move(12, 14, 2)]);
    const mat = buildMat({
      history: game.history(),
      white: 'W',
      black: 'B',
      result: null,
      date: new Date(2026, 7, 13),
    });
    const row = mat.split('\n').find((l) => /^\s*1\)/.test(l));
    expect(row).toMatch(/^\s*1\)\s+42: 12\/16 12\/14$/);
    expect(row.indexOf('42:')).toBeGreaterThan(20);
  });

  it('records the size of the win', () => {
    const game = sampleGame();
    const mat = buildMat({
      history: game.history(),
      white: 'W',
      black: 'B',
      result: { winner: 'w', points: 2 },
      date: new Date(2026, 7, 13),
    });
    expect(mat).toContain('Wins 2 points');
  });

  it('says "1 point" in the singular', () => {
    const mat = buildMat({
      history: [],
      white: 'W',
      black: 'B',
      result: { winner: 'b', points: 1 },
      date: new Date(2026, 7, 13),
    });
    expect(mat).toContain('Wins 1 point');
  });

  it('strips quotes and newlines out of names off the wire', () => {
    const mat = buildMat({
      history: [],
      white: 'a"b\\c\nd',
      black: 'B',
      result: null,
      date: new Date(2026, 7, 13),
    });
    expect(mat).toContain('abc d');
    expect(mat.split('\n').filter((l) => l.includes('abc')).length).toBe(1);
  });

  it('names files and dates the way the format does', () => {
    expect(matDate(new Date(2026, 0, 5))).toBe('2026.01.05');
    expect(matFilename(new Date(2026, 0, 5, 9, 7))).toBe('backgammon-20260105-0907.mat');
  });
});
