import { describe, it, expect } from 'vitest';
import { buildPdn, pdnDate, pdnFilename } from '../src/game/pdn.js';

const base = {
  moves: ['11-15', '23-19', '8-11'],
  result: '*',
  black: 'You',
  white: 'Computer (Medium)',
  date: new Date(2026, 7, 13, 14, 30),
};

describe('buildPdn', () => {
  it('lists Black before White', () => {
    const pdn = buildPdn(base);
    expect(pdn.indexOf('[Black ')).toBeLessThan(pdn.indexOf('[White '));
  });

  it('carries the roster and the game type', () => {
    const pdn = buildPdn(base);
    expect(pdn).toContain('[Site "checkers.puter.com"]');
    expect(pdn).toContain('[Date "2026.08.13"]');
    expect(pdn).toContain('[Black "You"]');
    expect(pdn).toContain('[White "Computer (Medium)"]');
    expect(pdn).toContain('[Result "*"]');
    expect(pdn).toContain('[GameType "21"]');
  });

  it('numbers move pairs and ends with the result', () => {
    expect(buildPdn(base)).toContain('1. 11-15 23-19 2. 8-11 *');
  });

  it('writes the time control in seconds plus increment', () => {
    const pdn = buildPdn({ ...base, control: { initial: 300000, increment: 3000 } });
    expect(pdn).toContain('[TimeControl "300+3"]');
    expect(buildPdn(base)).toContain('[TimeControl "-"]');
  });

  it('omits a normal termination and spells out any other', () => {
    expect(buildPdn(base)).not.toContain('[Termination');
    expect(buildPdn({ ...base, termination: 'time forfeit' })).toContain(
      '[Termination "time forfeit"]',
    );
  });

  it('escapes quotes and strips newlines from tag values', () => {
    const pdn = buildPdn({ ...base, black: 'a"b\nc' });
    expect(pdn).toContain('[Black "a\\"b c"]');
  });

  it('wraps movetext at 80 columns', () => {
    const moves = new Array(80).fill('11-15');
    for (const line of buildPdn({ ...base, moves }).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it('names a downloaded file', () => {
    expect(pdnDate(base.date)).toBe('2026.08.13');
    expect(pdnFilename(base.date)).toBe('checkers-20260813-1430.pdn');
  });
});
