import { describe, it, expect } from 'vitest';
import { SPACING_PRESETS, parseSpacingPt, letterSpacingPt, applyLetterSpacing, spacingAtSelection } from '../src/lib/charspacing.js';

describe('character spacing', () => {
  it('parses points within range', () => {
    expect(SPACING_PRESETS.map((p) => p.pt)).toEqual([-0.5, 0, 1, 3]);
    expect(parseSpacingPt('1.5')).toBe(1.5);
    expect(parseSpacingPt(' -0,5 ')).toBe(-0.5);
    expect(parseSpacingPt('0')).toBe(0);
    expect(parseSpacingPt('')).toBeNull();
    expect(parseSpacingPt('abc')).toBeNull();
    expect(parseSpacingPt('51')).toBeNull();
    expect(parseSpacingPt('-21')).toBeNull();
  });

  it('reads painted letter-spacing back in points', () => {
    expect(letterSpacingPt('')).toBe(0);
    expect(letterSpacingPt('normal')).toBe(0);
    expect(letterSpacingPt('2.6667px')).toBe(2);
    expect(letterSpacingPt('-0.6667px')).toBe(-0.5);
  });

  it('applies through format.apply and clears with zero', async () => {
    const calls = [];
    const api = { format: { apply: async (i) => { calls.push(i); return { success: true }; } } };
    const target = { kind: 'selection', start: { kind: 'text', blockId: 'b', offset: 0 }, end: { kind: 'text', blockId: 'b', offset: 3 } };
    await applyLetterSpacing(api, target, 1.5);
    await applyLetterSpacing(api, target, 0);
    expect(calls).toEqual([{ target, inline: { letterSpacing: 1.5 } }, { target, inline: { letterSpacing: null } }]);
    await expect(applyLetterSpacing(api, null, 1)).rejects.toThrow('Select some text');
    await expect(applyLetterSpacing({ format: { apply: async () => ({ success: false, failure: { message: 'no' } }) } }, target, 1)).rejects.toThrow('no');
  });

  it('reports null when the selection cannot be inspected and 0 for plain text', () => {
    expect(spacingAtSelection({ selection: { getRects: () => { throw new Error('gone'); } } }, null)).toBeNull();
    expect(spacingAtSelection({ selection: { getRects: () => [] } }, null)).toBe(0);
  });
});
